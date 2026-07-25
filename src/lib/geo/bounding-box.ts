import type { LatLng } from "@/lib/geo/commute";

export function boundingBox(origin: LatLng, radiusMeters: number) {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  return {
    minLat: origin.lat - dLat,
    maxLat: origin.lat + dLat,
    minLng: origin.lng - dLng,
    maxLng: origin.lng + dLng,
  };
}
