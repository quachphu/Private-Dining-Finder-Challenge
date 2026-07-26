"use client";

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [origin.lng, origin.lat],
      zoom: 15,
      pitch: 55,
      bearing: -20,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

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
      map.remove();
      mapRef.current = null;
    };
  }, [origin, venues]);

  return <div ref={containerRef} className={className} />;
}
