"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Box, Map as MapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MapVenue } from "@/components/map-view";

// Both map libraries touch `window` on import, so neither can be server
// rendered. Splitting them into separate dynamic imports also means a planner
// who never opens the 3D view never downloads MapLibre.
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-xl" />,
});

const MapView3D = dynamic(() => import("@/components/map-view-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-xl" />,
});

/**
 * 2D stays the default: it always frames every result, works at any zoom, and
 * is the view you want when comparing distances. 3D is opt-in for reading a
 * specific block.
 */
export function MapPanel({
  origin,
  venues,
  className,
}: {
  origin: { lat: number; lng: number; label: string };
  venues: MapVenue[];
  className?: string;
}) {
  const [is3D, setIs3D] = useState(false);

  return (
    <div className={cn("relative", className)}>
      {is3D ? (
        <MapView3D origin={origin} venues={venues} className="h-full w-full overflow-hidden rounded-xl" />
      ) : (
        <MapView origin={origin} venues={venues} className="h-full w-full" />
      )}

      {/* Bottom-left is the one corner both libraries leave empty: Leaflet puts
          its zoom control top-left, MapLibre's navigation control sits
          top-right, and both render attribution bottom-right. The z-index has
          to clear Leaflet's own controls, which sit at 800. */}
      <div className="absolute bottom-3 left-3 z-[900] flex overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur">
        <ToggleButton active={!is3D} onClick={() => setIs3D(false)} icon={MapIcon} label="2D" />
        <ToggleButton active={is3D} onClick={() => setIs3D(true)} icon={Box} label="3D" />
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
