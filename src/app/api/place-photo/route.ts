import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies Google Places photo bytes.
 *
 * Places API (New) serves photo media from an authenticated URL, so the naive
 * approach is to store `.../media?key=API_KEY` directly on the venue row —
 * which leaks the key into the database and into page HTML. Instead we store
 * only the opaque photo resource name and attach the key here, server-side.
 *
 * Photos are immutable once published, so responses are cached aggressively.
 */

// The resource name always looks like `places/{placeId}/photos/{photoId}` —
// validated so this can't be used as an open proxy to arbitrary Google
// endpoints.
const PLACE_PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const MAX_WIDTH_PX = 1200;

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing photo name" }, { status: 400 });
  if (!PLACE_PHOTO_NAME_PATTERN.test(name)) return NextResponse.json({ error: "Invalid photo name" }, { status: 400 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });

  const url = new URL(`https://places.googleapis.com/v1/${name}/media`);
  url.searchParams.set("maxWidthPx", String(MAX_WIDTH_PX));
  url.searchParams.set("key", apiKey);

  const upstream = await fetch(url, { redirect: "follow" }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
