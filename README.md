# Private Dining Finder

**Find a private dining room that actually fits your group — backed by evidence, not guesses.**

Enter an address, a headcount, and a max commute time. Get back a ranked shortlist of private dining venues — each one labeled with *how confident you should be* in its room capacity and price, not just what the capacity and price are.

📹 **Demo video:** _add link here_
📊 **Pitch deck:** _add link here_
🏗️ **[Architecture](./ARCHITECTURE.md)**

---

## The problem

Booking a private dining room for a group of 30–200 people is a research problem disguised as a search problem. There is no API for "restaurant with a private room that seats 50." The real answer lives scattered across a dozen open browser tabs — a venue's own events page, a Yelp photo from three years ago, a phone call nobody's made yet — and every planner ends up rebuilding the same spreadsheet from scratch, with numbers of wildly different reliability sitting side by side with no way to tell them apart.

The failure mode that actually hurts isn't "wrong restaurant." It's showing up with 60 people to a room that was never confirmed to hold more than 40.

## The solution

Private Dining Finder runs a small discovery-and-verification pipeline instead of a single search box, and it never lets a guess look as trustworthy as a fact. Every capacity and price figure on the page is stamped with one of five trust tiers, and ranking is built so a confirmed number can never lose to a fabricated one just because the fabrication happens to fit better.

- **Search** by address, headcount, commute time, mode, and room style — or just describe the event in plain English and let it fill the form in for review.
- **Rank by real fit**, not proximity alone: commute, capacity fit, evidence quality, and style all factor into one score, and a venue that hasn't published a number can't outrank one that has.
- **See the pipeline work.** A live readout shows what's actually happening during a search — sites fetched, results venue-confirmed — instead of a spinner.
- **Close the loop on "needs a call."** Confirm a figure after actually calling a venue, and it flows straight into the shared catalog for every future search near that venue.
- **Move from comparison to commitment.** Shortlist candidates, compare them side by side, pick one — then open a live event page where everyone attending states their allergies and dietary needs, and the host gets an AI-built roster to hand the kitchen.

This is a research and coordination tool. **It never books, holds, or pays for anything** — every irreversible step (calling the venue, sending the order) stays a deliberate human action.

## The trust tiers

The core idea, made visible everywhere a number appears:

| Tier | What it means |
|---|---|
| `confirmed_by_planner` | A human phoned the venue and reported the answer back into the shared catalog |
| `verified` | Printed on the venue's own private-dining page |
| `likely` | The venue confirms private events but publishes no number |
| `ai_extracted` | Read from the venue's own wording by an LLM, not matched verbatim |
| `unverified` | Not confirmed anywhere — needs a call |

Ranking treats these as **load-bearing, not decorative**: capacity-fit credit is scaled by the tier, so an estimated capacity can never outrank a published one just because the guess sits closer to the headcount. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#trust-tiers--ranking) for how the pipeline actually derives each tier.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) + React 19 |
| UI | Tailwind CSS 4 + shadcn/ui |
| Database | Supabase (Postgres), accessed server-side via the service-role key |
| Realtime | Supabase Realtime (event chat) |
| Geocoding | OpenStreetMap Nominatim (free, keyless) |
| Commute routing | OpenRouteService Matrix API (free tier), haversine fallback |
| Venue discovery | Google Places API (New) (optional, paid) or OpenStreetMap Overpass (free fallback) |
| JS-render fallback | Firecrawl (optional, paid, budget-capped) |
| AI extraction / NL parsing | xAI Grok, structured outputs (optional, paid, budget-capped) |
| Maps | Leaflet (2D) + MapLibre GL JS / OpenFreeMap (3D, keyless) |
| Tests | Vitest |

The app runs end-to-end with **zero paid API keys** — every external call degrades to a free, clearly-labeled fallback. See "Optional API keys" below.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), then apply every migration in `supabase/migrations/` **in filename order** (`0001_init.sql` through `0010_event_dietary_flow.sql`). Either:

- Paste each file into the Supabase Studio SQL editor and run them in order, **or**
- Use the Supabase CLI: `npx supabase link --project-ref <your-project-ref>` then `npx supabase db push`

(You can also run everything against a local Supabase instance instead — see "Local development" below.)

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your Supabase project's URL, anon key, and service-role key (Project Settings → API). Every other key is optional — see "Optional API keys" below. `.env*` files are gitignored; only `.env.example` is tracked.

### 4. Seed the fallback venues

```bash
npm run seed
```

Loads the curated venues (Carmine's, Dos Caminos, Perbacco, Hilton Hawaiian Village, etc.) that guarantee the 3 required scenarios have real, verified data before the live pipeline ever runs.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create a workspace, and search.

## Local development (no hosted Supabase project needed)

```bash
npx supabase init          # first time only
npx supabase start         # spins up Postgres + API locally via Docker, applies migrations
npm run seed                # seed against the local instance
npm run dev
```

`supabase start` prints local API URL + anon/service-role keys — copy those into `.env.local`. `npx supabase db reset` re-applies migrations from scratch.

## Optional API keys

| Variable | Without it | With it |
|---|---|---|
| `ORS_API_KEY` | Commute time is a haversine estimate, labeled "estimated" | Real walking/driving routes via [OpenRouteService](https://openrouteservice.org/dev/#/signup) (free tier) |
| `GOOGLE_PLACES_API_KEY` | Discovery uses the free OpenStreetMap Overpass API | Richer discovery + real venue photos via Google Places (New) |
| `FIRECRAWL_API_KEY` | Client-rendered private-dining pages come back `unverified` | Those pages are rendered and read, not mislabeled by a tooling gap |
| `XAI_API_KEY` | Prose capacities aren't captured; free-text search is disabled | Adds the `ai_extracted` tier, cross-source confidence checks, and NL query parsing |

Both paid tiers run **only** when the free path found nothing, and both are budget-capped per search.

## Testing the 3 required scenarios

1. **50 people, Times Square, NYC, under 20 min** — search `Times Square, New York, NY`
2. **30 people, Salesforce Tower, SF, under 15 min** — search `415 Mission St, San Francisco, CA 94105`
3. **200 people, reception style, Hilton Hawaiian Village, Waikiki, under 15 min walk** — search `Hilton Hawaiian Village, Honolulu, HI`, style = "Reception / happy hour"

```bash
npm run test:scenarios   # runs all 3 scenarios directly against search/ranking, prints results
npm test                  # unit tests (Vitest) — trust derivation, ranking, price signal, parsing, personas
```

Unit tests can't prove an external API still behaves as documented, so there are scripts that hit the real services directly (network calls, cost API credits where a key is configured):

```bash
npx tsx scripts/verify-enrichment.ts
npx tsx scripts/verify-nl-query.ts
node --conditions=react-server --import tsx scripts/verify-flywheel.ts
node --conditions=react-server --import tsx scripts/verify-dietary-summary.ts
node --conditions=react-server --import tsx scripts/loadtest-density.ts
```

Two real defects (a ranking hole where a category-guessed capacity outranked a venue's own published figure, and a stale-prop bug in the dietary-roster button) were caught by these scripts and by walking the flow directly, not by the unit suite.

## Known trade-offs

- **Photos are partial.** Auto-discovered venues pull real Google Places photos; a handful of curated seed venues show an honest "no photo found" rather than a stock placeholder, once one was tried and found more misleading than helpful.
- **Capacity is estimated when a venue publishes none**, labeled `unverified` and named "Capacity unconfirmed" — kept because excluding unknown venues entirely would drop real candidates worth calling, and ranking no longer lets that guess outrank a published figure.
- **No real authentication.** A shared workspace code trades real auth for zero-friction sharing — appropriate for a research tool with no sensitive data, not for production as-is.
- **Confirmations are trusted on sight.** Anyone with a workspace code can push a `confirmed_by_planner` figure into the shared catalog; provenance is recorded, but there's no corroboration step yet.

## Project structure

```
src/lib/geo/               geocoding + commute time
src/lib/discovery/         live discovery, scraping, JS-render + LLM tiers, trust-labeling, caching
src/lib/ranking.ts         "best overall fit" scoring
src/lib/dietary-summary.ts AI-built dietary roster from the event chat thread
src/lib/workspace.ts       company-code workspace (create/join, cookie-based)
src/app/                   routes (search, shortlist, compare, venue, event, summary)
src/data/                  curated fallback venue data
supabase/migrations/       database schema (apply in filename order)
scripts/                   seed, scenario smoke test, and live-service verification scripts
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design, data flow, and schema.

---

Built for Nowadays' "Private Dining Finder" take-home challenge.
