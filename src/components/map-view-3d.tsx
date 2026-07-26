"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 dropped the default export in favour of named ones.
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapVenue } from "@/components/map-view";

type MapView3DProps = {
  origin: { lat: number; lng: number; label: string };
  venues: MapVenue[];
  className?: string;
};

/**
 * Tilted 3D view of the same results, as an alternative to the flat 2D map.
 *
 * Why it earns its place rather than being decoration: "a 6 minute walk" is an
 * abstraction, and in a dense downtown the thing a planner actually pictures is
 * which building it's in and what's between here and there. Extruded buildings
 * make the walk legible in a way a flat pin doesn't.
 *
 * Tiles: OpenFreeMap's `liberty` style — genuinely keyless (no registration, no
 * API key, no quota) which keeps the project's "runs with zero paid keys"
 * property intact. Attribution is carried by the style itself and rendered by
 * MapLibre automatically.
 *
 * The style already ships a `building-3d` fill-extrusion layer driven by
 * OpenMapTiles' `render_height` / `render_min_height`, active from zoom 14, so
 * there's nothing to hand-roll here. Adding a second extrusion layer would just
 * double-draw the same geometry.
 */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Below this the style stops extruding buildings, so a very spread-out result
// set would tilt into a flat map. Clamping the fit keeps the 3D view actually 3D
// (at the cost of not always framing every pin at once, which is why 2D remains
// the default).
const MIN_3D_ZOOM = 14.2;

const PIN_COLOR = "#18181b";
const ORIGIN_COLOR = "#059669";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * MapLibre doesn't reliably throw when WebGL2 is missing (disabled hardware
 * acceleration, an old browser, a locked-down corporate device, a headless
 * preview pane): it logs a `GPUInitializationError` and limps on with an
 * internally half-initialized map, which then throws a confusing
 * `Cannot read properties of undefined` the moment a marker is added.
 * Checking up front turns that crash into a plain, honest message.
 */
function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

function pinElement(content: string, color: string, size: number): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid white;display:flex;align-items:center;justify-content:center;cursor:pointer`;

  const label = document.createElement("span");
  label.style.cssText =
    "transform:rotate(45deg);color:white;font-size:12px;font-weight:600;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1";
  label.textContent = content;

  el.appendChild(label);
  return el;
}

export default function MapView3D({ origin, venues, className }: MapView3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Computed once, in the initializer rather than as a setState call inside
  // the effect below: this is genuinely part of the initial render (a static
  // capability of the browser, not a subscription to anything), so deriving
  // it during render is the correct pattern, not just a lint workaround.
  const [unsupported, setUnsupported] = useState(() => !supportsWebGL2());

  useEffect(() => {
    if (unsupported || !containerRef.current) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: STYLE_URL,
        center: [origin.lng, origin.lat],
        zoom: 15,
        pitch: 55,
        bearing: -20,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // Belt-and-suspenders: some environments fail the feature check above
      // but still throw synchronously here rather than during marker setup.
      // This can only be discovered by attempting construction, so it's
      // necessarily reactive rather than derivable during render.
      console.error("MapLibre failed to initialize:", err);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a real synchronous constructor failure, not derivable up front
      setUnsupported(true);
      return;
    }
    mapRef.current = map;

    // Belt-and-suspenders, part two: `canvas.getContext('webgl2')` can return
    // a context object even when the browser's GPU process itself is broken
    // (seen in practice on a Safari session with hardware acceleration
    // unavailable) — MapLibre then logs a `GPUInitializationError` and quietly
    // leaves the canvas blank rather than throwing where the try/catch above
    // could see it. Markers are plain DOM elements positioned by CSS, so they
    // still render on top of that blank canvas, which looks like a broken map
    // rather than an honest fallback. Watching the map's own error event is
    // the only way to catch this after the fact.
    map.on("error", (e) => {
      const message = e.error?.message ?? "";
      if (/webgl|gpu/i.test(message)) {
        console.error("MapLibre reported a GPU/WebGL error after init:", message);
        map.remove();
        mapRef.current = null;
        setUnsupported(true);
      }
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    new Marker({ element: pinElement("\u2022", ORIGIN_COLOR, 26), anchor: "bottom" })
      .setLngLat([origin.lng, origin.lat])
      .setPopup(
        new Popup({ offset: 28 }).setHTML(
          `<div style="font-weight:600;font-size:13px">${escapeHtml(origin.label)}</div><div style="font-size:12px;opacity:.7">Your search origin</div>`
        )
      )
      .addTo(map);

    for (const venue of venues) {
      new Marker({ element: pinElement(String(venue.rank), PIN_COLOR, 30), anchor: "bottom" })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(
          new Popup({ offset: 32 }).setHTML(
            `<a href="/venue/${encodeURIComponent(venue.id)}" style="font-weight:600;font-size:13px;text-decoration:none;color:inherit">${escapeHtml(venue.name)}</a>` +
              `<div style="font-size:12px;opacity:.7">${Math.round(venue.commuteMinutes)} min &middot; fits up to ${venue.capacity}</div>`
          )
        )
        .addTo(map);
    }

    // Frame the results first, then tilt: fitBounds has no pitch option, and
    // easing into the tilt afterwards also reads better than starting tilted.
    map.once("load", () => {
      const points: [number, number][] = [[origin.lng, origin.lat], ...venues.map((v): [number, number] => [v.lng, v.lat])];
      if (points.length > 1) {
        const bounds = points.reduce((acc, p) => acc.extend(p), new LngLatBounds(points[0], points[0]));
        map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 0 });
      }
      map.easeTo({
        zoom: Math.max(map.getZoom(), MIN_3D_ZOOM),
        pitch: 55,
        bearing: -20,
        duration: 900,
      });
    });

    return () => {
      // The error handler above may have already torn the map down (setting
      // mapRef.current to null) before this cleanup ever runs.
      if (mapRef.current) map.remove();
      mapRef.current = null;
    };
  }, [origin, venues, unsupported]);

  if (unsupported) {
    return (
      <div className={className}>
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border bg-muted/40 p-6 text-center">
          <p className="text-sm font-medium">3D view isn&apos;t available here</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            This browser doesn&apos;t support WebGL2, which the tilted map needs. Switch back to 2D — every result is still
            there.
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}
