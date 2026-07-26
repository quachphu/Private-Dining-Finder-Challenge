export type HighlightReelSource = { url: string; type: "image" | "video" };

// Kept short and capped deliberately: this runs synchronously in the
// visitor's tab (no server-side render farm behind it), so the ceiling here
// is "stays responsive on an ordinary laptop", not "handles an unbounded
// shortlist thread".
const IMAGE_HOLD_MS = 2200;
const MAX_CLIP_MS = 6000;
const MAX_SOURCES = 10;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
// This reel gets posted straight back into the chat as an attachment (see
// ShortlistHighlightReel), so its output has to clear the same upload cap
// as any other video message — bound the encoding bitrate rather than
// discovering the file is too big only after recording finishes.
const VIDEO_BITS_PER_SECOND = 2_000_000;
const AUDIO_BITS_PER_SECOND = 96_000;

export const HIGHLIGHT_REEL_SUPPORTED =
  typeof window !== "undefined" &&
  typeof HTMLCanvasElement !== "undefined" &&
  "captureStream" in HTMLCanvasElement.prototype &&
  typeof MediaRecorder !== "undefined";

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
}

// Draws `source` into the canvas the same way CSS object-fit: cover would —
// filling the frame completely and cropping whichever axis overflows —
// rather than the ugly letterboxing you'd get from a naive fit.
function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
) {
  const sourceRatio = sourceWidth / sourceHeight;
  const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
  let drawWidth: number;
  let drawHeight: number;
  if (sourceRatio > canvasRatio) {
    drawHeight = CANVAS_HEIGHT;
    drawWidth = CANVAS_HEIGHT * sourceRatio;
  } else {
    drawWidth = CANVAS_WIDTH;
    drawHeight = CANVAS_WIDTH / sourceRatio;
  }
  const dx = (CANVAS_WIDTH - drawWidth) / 2;
  const dy = (CANVAS_HEIGHT - drawHeight) / 2;
  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Required for drawImage() from a different origin (Supabase Storage) to
    // leave the canvas "origin-clean" — without it, captureStream() silently
    // emits black frames for this source instead of throwing.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drawImageFor(
  ctx: CanvasRenderingContext2D,
  url: string,
  durationMs: number
): Promise<void> {
  const img = await loadImage(url);
  drawCover(ctx, img, img.naturalWidth, img.naturalHeight);
  await sleep(durationMs);
}

async function playVideoInto(
  ctx: CanvasRenderingContext2D,
  audioCtx: AudioContext,
  audioDestination: MediaStreamAudioDestinationNode,
  url: string
): Promise<void> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.src = url;
  video.muted = false;
  video.playsInline = true;
  video.preload = "auto";

  // A <video> that's never part of the document can decode and paint its
  // first frame and then silently stall — browsers deprioritize rendering
  // work for detached media elements, which is exactly why the reel's still
  // photos (a one-time drawImage) worked fine but a video source froze after
  // frame one. Hidden-but-attached keeps decoding running for its full
  // duration; it's removed again in the caller's cleanup.
  video.style.cssText = "position:fixed; top:-9999px; left:-9999px; width:2px; height:2px; opacity:0; pointer-events:none;";
  document.body.appendChild(video);

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video"));
  });

  // Routing through Web Audio (rather than leaving the element's own output
  // connected) is what lets MediaRecorder pick the audio up on the combined
  // stream at all — a plain <video> element's sound never reaches a
  // MediaStream on its own.
  try {
    const source = audioCtx.createMediaElementSource(video);
    source.connect(audioDestination);
  } catch {
    // Some browsers refuse to create a MediaElementSource for a
    // cross-origin, CORS-clean-but-unusual response; the reel still works,
    // just silently for this clip.
  }

  let stopped = false;
  let rafId = 0;
  const draw = () => {
    if (stopped || video.ended || video.paused) return;
    drawCover(ctx, video, video.videoWidth || CANVAS_WIDTH, video.videoHeight || CANVAS_HEIGHT);
    rafId = requestAnimationFrame(draw);
  };

  try {
    await video.play();
    draw();

    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      video.addEventListener("ended", finish, { once: true });
      setTimeout(finish, MAX_CLIP_MS);
    });
  } finally {
    stopped = true;
    cancelAnimationFrame(rafId);
    video.pause();
    video.remove();
  }
}

/**
 * Compiles a shortlist thread's posted photos and videos into a single
 * downloadable/shareable clip, entirely client-side: a canvas is painted
 * frame-by-frame (each photo held, each video played through and drawn live)
 * while MediaRecorder captures the canvas + a routed audio track. No server
 * component, no new dependency — just the browser's own capture APIs.
 */
export async function buildHighlightReel(
  sources: HighlightReelSource[],
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  if (!HIGHLIGHT_REEL_SUPPORTED) {
    throw new Error("This browser can't generate video here — try a recent Chrome, Firefox, or Edge.");
  }

  const clipped = sources.slice(0, MAX_SOURCES);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported here.");

  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextCtor();
  await audioCtx.resume();
  const audioDestination = audioCtx.createMediaStreamDestination();

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();

  try {
    for (let i = 0; i < clipped.length; i++) {
      const item = clipped[i];
      try {
        if (item.type === "image") {
          await drawImageFor(ctx, item.url, IMAGE_HOLD_MS);
        } else {
          await playVideoInto(ctx, audioCtx, audioDestination, item.url);
        }
      } catch {
        // Skip whatever failed to load (e.g. a since-deleted object) rather
        // than aborting the whole reel over one bad source.
      }
      onProgress?.(i + 1, clipped.length);
    }
  } finally {
    recorder.stop();
    await stopped;
    await audioCtx.close();
  }

  // Deliberately re-labeled to a bare "video/webm" rather than the
  // codec-qualified string MediaRecorder was given: that string's
  // `codecs=vp9,opus` parameter (unquoted, containing a comma) round-trips
  // badly through the multipart encoding used to upload this Blob as a
  // File — servers that fail to parse it fall back to defaulting the
  // reconstructed file's type to "text/plain". Playback is unaffected: the
  // browser sniffs the real codec from the file's bytes, not this label.
  return new Blob(chunks, { type: "video/webm" });
}
