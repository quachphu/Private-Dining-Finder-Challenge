"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { TrustBadge } from "@/components/trust-badge";
import type { TrustLevel } from "@/lib/supabase/types";

export type MapVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rank: number;
  commuteMinutes: number;
  capacity: number;
  trustLevel: TrustLevel;
};

type MapViewProps = {
  origin: { lat: number; lng: number; label: string };
  venues: MapVenue[];
  className?: string;
};

const PIN_COLOR = "#18181b"; // zinc-900, matches the app's primary
const ORIGIN_COLOR = "#059669"; // emerald-600

function pinIcon(content: string, color: string, size = 30) {
  return L.divIcon({
    className: "pdf-map-pin",
    html: `
      <div style="
        width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
        background:${color};transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid white;
        display:flex;align-items:center;justify-content:center;
      ">
        <span style="
          transform:rotate(45deg);color:white;font-size:12px;font-weight:600;
          font-family:ui-sans-serif,system-ui,sans-serif;line-height:1;
        ">${content}</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export default function MapView({ origin, venues, className }: MapViewProps) {
  const originIcon = useMemo(() => pinIcon("&#8226;", ORIGIN_COLOR, 26), []);
  const venueIcons = useMemo(() => venues.map((v) => pinIcon(String(v.rank), PIN_COLOR)), [venues]);
  const boundsPoints = useMemo<[number, number][]>(
    () => [[origin.lat, origin.lng], ...venues.map((v): [number, number] => [v.lat, v.lng])],
    [origin, venues]
  );
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className={className}>
      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={14}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        className="rounded-xl"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={boundsPoints} />

        <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
          <Popup>
            <div className="text-sm font-medium">{origin.label}</div>
            <div className="text-xs text-muted-foreground">Your search origin</div>
          </Popup>
        </Marker>

        {venues.map((venue, i) => (
          <Marker key={venue.id} position={[venue.lat, venue.lng]} icon={venueIcons[i]}>
            <Popup>
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <Link href={`/venue/${venue.id}`} className="text-sm font-medium hover:underline">
                  {venue.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {Math.round(venue.commuteMinutes)} min &middot; fits up to {venue.capacity}
                </div>
                <TrustBadge level={venue.trustLevel} className="w-fit" />
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
