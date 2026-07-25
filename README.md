# Private Dining Finder

A research and comparison tool for event planners: enter an address, headcount, and max commute time, and get a ranked shortlist of private dining venues — each with room capacities, commute time, and a trust label (verified / likely / unverified) on every capacity and price figure.

Built for the Nowadays "Private Dining Finder" take-home challenge.

## How it actually finds venues

This is the part worth understanding before poking at the code: there's no clean public API for "restaurant with a private room that seats 40." So the app runs a small discovery pipeline instead of querying a single API:

1. **Geocode** the planner's address (OpenStreetMap Nominatim — free, no API key).
2. **Discover** candidate venues near that point (Google Places if `GOOGLE_PLACES_API_KEY` is set, otherwise the free OpenStreetMap Overpass API).
3. **Scrape** each candidate's own website for a private-dining/events page and extract room names, capacity numbers, minimum-spend figures, and contact info via pattern matching (`src/lib/discovery/scraper.ts`).
4. **Label trust** based on what was actually found — an explicit capacity number on a dedicated private-dining page is `verified`; a private-events page with no specific number is `likely`; no private-dining page at all is `unverified` (`src/lib/discovery/trust.ts`).
5. **Cache** the result in Supabase (`src/lib/discovery/ensure-coverage.ts`) so a second search near the same area reuses what was already discovered instead of re-scraping every time (30-day TTL).

A hand-curated set of real venues (`src/data/seed-venues.ts`) — researched from each venue's own private-events pages — is seeded separately as a permanent floor, so the three required scenarios always have solid, verified data even before the live pipeline has crawled an area.

## Company workspaces

Rather than re-typing an address every search, a company gets a shareable code (e.g. `NOWADAYS-4F2A`) on first use. Anyone with the code sees the same saved office addresses, search history, and shortlist — no accounts or passwords, the code works like a shared link. See `src/lib/workspace.ts`.

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions) + **React 19**
- **Tailwind CSS 4** + **shadcn/ui**
- **Supabase** (Postgres, accessed via the service-role key server-side)
- Geocoding: **OpenStreetMap Nominatim** (free, keyless)
- Commute routing: **OpenRouteService** Matrix API (free tier) with an automatic straight-line fallback
- Venue discovery: **Google Places** (optional, paid) or **OpenStreetMap Overpass API** (free, keyless fallback)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), then apply the schema in `supabase/migrations/0001_init.sql`. Either:

- Paste the file into the Supabase Studio SQL editor and run it, **or**
- Use the Supabase CLI: `npx supabase link --project-ref <your-project-ref>` then `npx supabase db push`

(You can also run everything against a local Supabase instance instead — see "Local development" below.)

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your Supabase project's URL, anon key, and service-role key (found under Project Settings → API).

```bash
cp .env.example .env.local
```

`ORS_API_KEY` and `GOOGLE_PLACES_API_KEY` are optional — see "Optional API keys" below.

### 4. Seed the fallback venues

```bash
npm run seed
```

This geocodes and loads the curated venues (Carmine's, Dos Caminos, Perbacco, Hilton Hawaiian Village, etc.) that guarantee the 3 required scenarios have real data.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create a workspace, and search.

## Local development (no hosted Supabase project needed)

The app was built and tested against a **local** Supabase instance via the Supabase CLI + Docker, which is the fastest way to develop without waiting on a hosted project:

```bash
npx supabase init          # first time only
npx supabase start         # spins up Postgres + API locally via Docker, applies migrations
npm run seed                # seed against the local instance
npm run dev
```

`supabase start` prints local API URL + anon/service-role keys — copy those into `.env.local`. `npx supabase db reset` re-applies migrations from scratch.

## Optional API keys

The app runs with **zero paid API keys** — every external call has a free fallback — but accuracy improves with them:

| Variable | Without it | With it |
|---|---|---|
| `ORS_API_KEY` | Commute time/distance is a straight-line (haversine) estimate with a route-factor correction and mode-specific average speed, clearly labeled "estimated" in the UI | Real walking/driving routes via [OpenRouteService](https://openrouteservice.org/dev/#/signup) (free tier, no credit card) |
| `GOOGLE_PLACES_API_KEY` | Venue discovery uses the free OpenStreetMap Overpass API — fewer venues, thinner metadata, spottier website coverage | Richer discovery via Google Places Nearby Search + Place Details |

## Testing the 3 required scenarios

With the dev server running, search:

1. **50 people, Times Square, NYC, under 20 min** — try `Times Square, New York, NY`
2. **30 people, Salesforce Tower, SF, under 15 min** — try `415 Mission St, San Francisco, CA 94105`
3. **200 people, reception style, Hilton Hawaiian Village, Waikiki, under 15 min walk** — try `Hilton Hawaiian Village, Honolulu, HI` and set style to "Reception / happy hour"

There's also a scripted smoke test that exercises all 3 scenarios directly against the search/ranking logic and prints the results to the terminal (useful for verifying the backend without clicking through the UI):

```bash
npm run test:scenarios
```

## Known trade-offs / what I'd improve with more time

- **Photos are placeholders.** Real venue photography requires either a licensed Places Photos API integration (cost) or per-venue manual sourcing. `venue_photos.url` is deterministic placeholder imagery today — the schema and UI are ready to swap in real photo URLs.
- **The scraper is static-HTML only.** It doesn't execute JavaScript, so sites that render their private-dining content client-side won't be read correctly. This fails safe: those venues just come back `unverified` ("needs a call") rather than silently missing data.
- **No Supabase Auth.** The company-code model trades real authentication for zero-friction sharing, appropriate for a research tool with no sensitive data. A production version would add Supabase Auth (e.g. magic link matched to email domain) and scope RLS policies to `auth.uid()` instead of trusting the client-supplied company id.
- **Discovery radius is a heuristic**, not the real routable isochrone — it's sized generously off the max-commute-minutes input so real routing doesn't miss borderline venues, then the actual per-venue commute is what's filtered on.

## Project structure

```
src/lib/geo/          geocoding + commute time (Nominatim, OpenRouteService, haversine fallback)
src/lib/discovery/    live venue discovery, scraping, trust-labeling, Supabase caching
src/lib/ranking.ts    "best overall fit" scoring (commute, capacity, trust, style match)
src/lib/workspace.ts  company-code workspace (create/join, cookie-based)
src/lib/search.ts     orchestrates a search end-to-end
src/data/              curated fallback venue data
supabase/migrations/  database schema
scripts/               seed script + scenario smoke test
```
