import { NextRequest, NextResponse } from "next/server";

// Photon (photon.komoot.io) is a free, keyless geocoder purpose-built for
// search-as-you-type autocomplete — unlike Nominatim, whose usage policy
// discourages exactly this per-keystroke query pattern. Used here only for
// live suggestions while typing; the actual search still geocodes the
// final address via Nominatim (src/lib/geo/geocode.ts) for consistency
// with the rest of the app.
type PhotonFeature = {
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  geometry?: { coordinates?: [number, number] };
};
type PhotonResponse = { features?: PhotonFeature[] };

export type AddressSuggestion = { label: string; lat: number; lng: number };

// Street address leads the label, not the POI name — Photon sometimes
// attaches an unrelated business name to a shared address (e.g. a
// different tenant in the same office building), which reads as flat-out
// wrong if shown first. The address itself is what's actually geocoded
// and used, so it's the trustworthy part; the POI name (when present and
// distinct) is kept only as a secondary hint in parentheses.
function formatLabel(props: PhotonFeature["properties"]): string {
  const streetPart = props.housenumber && props.street ? `${props.housenumber} ${props.street}` : props.street;
  const namePart = props.name && props.name !== streetPart ? props.name : null;
  const line1 = streetPart ? `${streetPart}${namePart ? ` (${namePart})` : ""}` : namePart ?? "";
  const line2 = [props.city, props.state, props.country].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(", ") || props.name || "";
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) return NextResponse.json([]);

  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "en");

    const res = await fetch(url, {
      headers: { "User-Agent": "private-dining-finder/0.1 (event-planning research tool)" },
    });
    if (!res.ok) return NextResponse.json([]);

    const data = (await res.json()) as PhotonResponse;
    const suggestions: AddressSuggestion[] = (data.features ?? [])
      .map((f) => {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        return { label: formatLabel(f.properties), lat: lat as number, lng: lng as number };
      })
      .filter((s) => s.label && Number.isFinite(s.lat) && Number.isFinite(s.lng));

    return NextResponse.json(suggestions);
  } catch {
    return NextResponse.json([]);
  }
}
