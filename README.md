# Private Dining Finder

A research and comparison tool for event planners: enter an address, headcount, and max commute time, and get a ranked shortlist of private dining venues — each with room capacities, commute time, and a trust label (verified / likely / unverified) on every capacity and price figure.

Built for the Nowadays "Private Dining Finder" take-home challenge.

## How it actually finds venues

This is the part worth understanding before poking at the code: there's no clean public API for "restaurant with a private room that seats 40." So the app runs a small discovery pipeline instead of querying a single API:

1. **Geocode** the planner's address (OpenStreetMap Nominatim — free, no API key).
2. **Discover** candidate venues near that point (Google Places if `GOOGLE_PLACES_API_KEY` is set, otherwise the free OpenStreetMap Overpass API).
3. **Scrape** each candidate's own website for a private-dining/events page and extract room names, capacity numbers, minimum-spend figures, menus, dietary notes, and contact info via pattern matching (`src/lib/discovery/scraper.ts`).
4. **Render, if the static pass came back empty** — a JS-rendered fallback via Firecrawl (`src/lib/discovery/render.ts`), so a venue isn't labeled unverified purely because its content is client-rendered.
5. **Read with an LLM, if a private-dining page exists but states no number** — a schema-constrained xAI Grok pass (`src/lib/discovery/llm-extract.ts`) for capacities written in prose.
6. **Label trust** based on what was actually found, and cross-reference the pattern-matched read against the LLM read where both exist: agreement upgrades confidence, disagreement surfaces both figures rather than silently picking one (`src/lib/discovery/trust.ts`).
7. **Cache** the result in Supabase (`src/lib/discovery/ensure-coverage.ts`) so a second search near the same area reuses what was already discovered instead of re-scraping every time (30-day TTL).

Steps 4 and 5 are the only paid tiers, they run **only** when the free pass found nothing, and they're capped per run (`MAX_ENRICHMENT_BUDGET`) so one search in Manhattan can't consume a credit balance.

### The five trust tiers

Every capacity and price figure carries one of these, and the price signal carries **its own** label rather than inheriting capacity's:

| Tier | Means |
|---|---|
| `confirmed_by_planner` | A human phoned the venue and reported the answer back into the shared catalog |
| `verified` | Printed on the venue's own private-dining page |
| `likely` | The venue confirms private events but publishes no number |
| `ai_extracted` | Read from the venue's own wording by an LLM, not matched verbatim |
| `unverified` | Not confirmed anywhere — needs a call |

Ranking treats these as load-bearing, not decorative: capacity-fit credit is scaled by the tier, so a venue's *estimated* capacity can't outrank a *published* one just because the guess happens to sit closer to the headcount.

A hand-curated set of real venues (`src/data/seed-venues.ts`) — researched from each venue's own private-events pages — is seeded separately as a permanent floor, so the three required scenarios always have solid, verified data even before the live pipeline has crawled an area.

## What a planner can do

- **Search** by address, headcount, max commute, mode (walk/drive), and room style, with a ranked "best overall fit" result list and a map.
- **Describe the event in plain English** instead, e.g. *"40 for a standing reception near Salesforce Tower, 10 minute walk max"*. This fills the structured form in and hands it back for review — it never searches on values the planner hasn't seen.
- **Watch the pipeline work.** During a search, a live readout reports what's actually happening (sites fetched, how many results ended up venue-confirmed) rather than a spinner.
- **Confirm a figure after calling a venue**, pushing it into the shared catalog as `confirmed_by_planner` — this is how "needs a call" stops being a dead end.
- **Draft an outreach email** pre-filled with headcount, date, and the specific room. Handed to the planner's own mail client or clipboard; the app never sends anything.
- **Compare** two or three shortlisted venues side by side at `/compare`.
- **Forward a read-only summary** to a decision-maker at `/summary/[workspace-code]`.
- **Toggle a 3D map** for reading which building a venue is actually in.

This is a research and recommendation tool only. Nothing in it books, holds, queues, or takes payment.

## Company workspaces

Rather than re-typing an address every search, a company gets a shareable code (e.g. `NOWADAYS-4F2A`) on first use. Anyone with the code sees the same saved office addresses, search history, and shortlist — no accounts or passwords, the code works like a shared link. See `src/lib/workspace.ts`.

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions) + **React 19**
- **Tailwind CSS 4** + **shadcn/ui**
- **Supabase** (Postgres, accessed via the service-role key server-side)
- Geocoding: **OpenStreetMap Nominatim** (free, keyless)
- Commute routing: **OpenRouteService** Matrix API (free tier) with an automatic straight-line fallback
- Venue discovery: **Google Places (New)** (optional, paid) or **OpenStreetMap Overpass API** (free, keyless fallback)
- JS-rendered scrape fallback: **Firecrawl** (optional, paid, budget-capped)
- Prose capacity extraction + free-text query parsing: **xAI Grok** structured outputs (optional, paid, budget-capped)
- Maps: **Leaflet** (2D) and **MapLibre GL JS** with **OpenFreeMap** vector tiles (3D — keyless, no registration)
- Tests: **Vitest**

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), then apply every migration in `supabase/migrations/` **in filename order** (`0001_init.sql` through `0007_shortlist_messages.sql` — the later ones add the `ai_extracted` and `confirmed_by_planner` trust tiers, menu/dietary trust columns, the confirmations table, and the per-venue shortlist chat). Either:

- Paste each file into the Supabase Studio SQL editor and run them in order, **or**
- Use the Supabase CLI: `npx supabase link --project-ref <your-project-ref>` then `npx supabase db push`

(You can also run everything against a local Supabase instance instead — see "Local development" below.)

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your Supabase project's URL, anon key, and service-role key (found under Project Settings → API).

```bash
cp .env.example .env.local
```

Every other key (`ORS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `FIRECRAWL_API_KEY`, `XAI_API_KEY`) is optional — see "Optional API keys" below. `.env`, `.env.local`, and `.env*.local` are gitignored; only `.env.example` is tracked.

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
| `GOOGLE_PLACES_API_KEY` | Venue discovery uses the free OpenStreetMap Overpass API — fewer venues, thinner metadata, spottier website coverage | Richer discovery via Google Places (New) `searchNearby` |
| `FIRECRAWL_API_KEY` | A venue whose private-dining content is rendered client-side comes back `unverified` ("needs a call") | Those pages are rendered and read, so real data isn't mislabeled because of a tooling gap |
| `XAI_API_KEY` | Capacities written in prose ("our upstairs room comfortably hosts thirty") aren't captured, and the free-text search box is disabled with a note saying so | Adds the `ai_extracted` tier, cross-source confidence checking, and natural-language query parsing |

Both paid tiers only run when the free path found nothing, and both are capped per discovery run.

## Testing the 3 required scenarios

With the dev server running, search:

1. **50 people, Times Square, NYC, under 20 min** — try `Times Square, New York, NY`
2. **30 people, Salesforce Tower, SF, under 15 min** — try `415 Mission St, San Francisco, CA 94105`
3. **200 people, reception style, Hilton Hawaiian Village, Waikiki, under 15 min walk** — try `Hilton Hawaiian Village, Honolulu, HI` and set style to "Reception / happy hour"

There's also a scripted smoke test that exercises all 3 scenarios directly against the search/ranking logic and prints the results to the terminal (useful for verifying the backend without clicking through the UI):

```bash
npm run test:scenarios
```

## Tests

```bash
npm test          # unit tests (Vitest) — trust derivation, ranking, price signal, scraper helpers, query parsing, personas
npm run test:watch
```

The unit suite covers the logic that has to be right: which evidence earns which trust tier, that the smallest fitting room wins, that a planner-confirmed figure outranks a scraped one, that an estimated capacity can't outrank a published one, and that free-text parsing never invents a value it wasn't given.

Unit tests can't prove an external API still behaves as documented, so there are separate scripts that hit the real services. These make live network calls and cost API credits where a key is configured:

```bash
npx tsx scripts/verify-enrichment.ts   # Firecrawl + Grok tiers against real venue sites
npx tsx scripts/verify-nl-query.ts     # free-text parsing, including sentences that omit fields
node --conditions=react-server --import tsx scripts/verify-flywheel.ts     # confirmation round-trip through search + ranking
node --conditions=react-server --import tsx scripts/loadtest-density.ts    # forces live discovery in dense areas, bypassing the cache
```

Both defects described at the end of `DECISIONS.md` were found by these scripts, not by the unit suite.

## Known trade-offs / what I'd improve with more time

`DECISIONS.md` is the full log of choices and trade-offs made while building this, including two real defects the load-test scripts caught. The short version:

- **Photos are partial.** Four venues in the required NYC scenario have genuine photographs; the other 10 curated seed venues (SF, Waikiki) show an explicit "no photo found" rather than a stock placeholder, once one was tried and found more misleading than helpful (see `DECISIONS.md`). Auto-discovered venues pull a real Google Places photo automatically — this was blocked by a project billing/SKU restriction earlier on, since re-verified and confirmed resolved. The auto-crossfade photo tour is still not built: only the first photo per venue is currently stored, and widening that for an unproven payoff felt like speculative code rather than a real improvement.
- **Capacity is estimated when a venue publishes none.** Those rooms are named "Capacity unconfirmed", labeled `unverified`, and annotated as estimated from venue category. It's honest on the card, but the guess still decides whether an unknown venue appears in a 200-person search at all. Kept because excluding them would drop real candidates worth calling; ranking no longer lets a guess outrank a published figure.
- **No Supabase Auth.** The company-code model trades real authentication for zero-friction sharing, appropriate for a research tool with no sensitive data. A production version would add Supabase Auth (e.g. magic link matched to email domain) and scope RLS policies to `auth.uid()` instead of trusting the client-supplied company id.
- **Discovery radius is a heuristic**, not the real routable isochrone — it's sized generously off the max-commute-minutes input so real routing doesn't miss borderline venues, then the actual per-venue commute is what's filtered on.
- **Confirmations are trusted on sight.** Anyone with a workspace code can push a `confirmed_by_planner` figure into the shared catalog. Fine for a demo, and provenance is recorded, but a production version needs corroboration (or at least moderation) before one workspace's claim outranks a venue's own published number.
- **The landing-page preview is cached for 6 hours**, so it reflects a real run from up to 6 hours ago rather than that instant. The timestamp is shown.

## Project structure

```
src/lib/geo/               geocoding + commute time (Nominatim, OpenRouteService, haversine fallback)
src/lib/discovery/         live discovery, scraping, JS-render + LLM tiers, trust-labeling, caching
src/lib/ranking.ts         "best overall fit" scoring (commute, capacity, trust, style match)
src/lib/trust-labels.ts    the single source of planner-facing wording for every trust tier
src/lib/search.ts          a search end-to-end, as three composable stages
src/lib/search-stages.ts   the same search as streamed stages, for the live progress readout
src/lib/nl-query.ts        free-text query -> structured form parameters
src/lib/personas.ts        persona-aware form defaults
src/lib/price-signal.ts    price signal + cost-per-person, with their own trust labels
src/lib/workspace.ts       company-code workspace (create/join, cookie-based)
src/data/                  curated fallback venue data
supabase/migrations/       database schema (apply in filename order)
scripts/                   seed, scenario smoke test, and live-service verification scripts
```
