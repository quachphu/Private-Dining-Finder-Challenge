"use client";

import { useEffect, useRef, useState } from "react";

const FADE_SECONDS = 0.5;
const RESTART_DELAY_MS = 100;
// If nothing has started playing by now, reveal the element anyway. Without
// this the hero can sit permanently blank: the fade-in is driven by
// currentTime, which stays at 0 forever when a browser defers autoplay
// (battery saver, media-engagement heuristics, a per-site autoplay block),
// so "invisible" would otherwise be indistinguishable from "still loading".
const REVEAL_TIMEOUT_MS = 2500;

/**
 * Ambient looping video behind the landing hero's headline. Deliberately
 * doesn't use the native `loop` attribute: looping that way hard-cuts back
 * to frame one, which reads as a jump-cut. Instead this drives its own
 * loop — a rAF tick fades opacity in/out around `currentTime`, and on
 * `ended` it waits briefly at opacity 0 before seeking back and replaying —
 * so every loop is a soft crossfade rather than a cut.
 *
 * Opacity is written straight to the DOM node rather than through React
 * state so a ~60fps tick doesn't re-render the tree every frame.
 *
 * The fade is treated as an enhancement, never a gate: if playback is
 * blocked, stalled, or the visitor prefers reduced motion, the element is
 * revealed at full opacity as a still frame instead.
 */
export function HeroVideoBackground({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reveal = () => {
      if (videoRef.current) videoRef.current.style.opacity = "1";
    };

    // Autoplay is only permitted for muted playback, and React sets `muted`
    // as a property rather than a reflected attribute — setting it here too
    // means the element is reliably muted before play() is ever attempted.
    video.muted = true;

    // Set up the timeout backstop and the load/stall listeners before
    // branching on reduced motion: with preload="metadata" and no play()
    // call, a reduced-motion visitor's browser has no reason to ever fire
    // `loadeddata` on its own, and that used to be this branch's *only*
    // path to visibility — a visitor with the OS-level setting on (common
    // on macOS) could get a permanently blank hero. The timeout now covers
    // both branches, so nothing can stay invisible past REVEAL_TIMEOUT_MS.
    const revealTimeout = setTimeout(reveal, REVEAL_TIMEOUT_MS);
    video.addEventListener("loadeddata", reveal, { once: true });
    video.addEventListener("stalled", reveal);
    video.addEventListener("error", reveal);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      // A single held frame honours the preference while still giving the
      // hero its imagery, rather than dropping the visual entirely.
      if (video.readyState >= 2) reveal();
      return () => {
        clearTimeout(revealTimeout);
        video.removeEventListener("loadeddata", reveal);
        video.removeEventListener("stalled", reveal);
        video.removeEventListener("error", reveal);
      };
    }

    function tick() {
      const el = videoRef.current;
      // Fade only while actually playing. A paused or stalled element gets
      // left fully visible: dimming it toward 0 there is what made a
      // deferred autoplay look like a broken hero.
      if (el && !el.paused && el.duration) {
        const remaining = el.duration - el.currentTime;
        let opacity = 1;
        if (el.currentTime < FADE_SECONDS) {
          opacity = el.currentTime / FADE_SECONDS;
        } else if (remaining < FADE_SECONDS) {
          opacity = remaining / FADE_SECONDS;
        }
        el.style.opacity = String(Math.min(Math.max(opacity, 0), 1));
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function handleEnded() {
      const el = videoRef.current;
      if (!el) return;
      el.style.opacity = "0";
      setTimeout(() => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = 0;
        void videoRef.current.play().catch(reveal);
      }, RESTART_DELAY_MS);
    }

    video.addEventListener("ended", handleEnded);
    rafRef.current = requestAnimationFrame(tick);

    // `autoPlay` alone is enough in most browsers, but calling play()
    // explicitly surfaces a rejected promise, which is the only reliable
    // signal that playback was blocked and the still frame should be shown.
    void video.play().catch(reveal);

    return () => {
      clearTimeout(revealTimeout);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("stalled", reveal);
      video.removeEventListener("loadeddata", reveal);
      video.removeEventListener("error", reveal);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // A failed/unreachable source falls back to the plain background colour
  // underneath rather than showing a broken-media icon.
  if (failed) return null;

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      playsInline
      // Not "auto": this asset is ~30MB, and eagerly pulling all of it
      // competes with the page's own resources on first paint. Metadata is
      // enough to start, and play() drives buffering from there.
      preload="metadata"
      onError={() => setFailed(true)}
      aria-hidden
      className="absolute inset-0 object-cover"
      style={{ opacity: 0 }}
    />
  );
}
