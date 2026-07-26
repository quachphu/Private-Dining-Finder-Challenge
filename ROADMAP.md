# Roadmap: what this project is, what's built, and why

This document exists for three audiences at once: a human reviewer trying to
understand the project quickly, a future contributor picking it back up, and
a coding agent that needs to orient itself before making a change. It maps
every built feature to *why* it exists, *where* it lives in the code, and
*which part of the challenge brief* it answers.

For the day-by-day reasoning behind each decision (including two real defects
found during testing and the trade-offs deliberately left in place), see
[`DECISIONS.md`](./DECISIONS.md). For setup/run instructions, see
[`README.md`](./README.md). This file is the map between the two: what
exists, mapped to why it exists and where to find it.

---

## 1. The challenge, in one paragraph

Nowadays books corporate offsites end-to-end except private dining, which is
still handled by hand. The brief: build a **research and recommendation
tool** (explicitly *not* a booking/reservation system) where a planner enters
an **address, headcount, and max commute time**, and gets back a **ranked**
list of private-dining venues. Every recommendation must surface, when known:
venue name/address, private room(s) with capacity, commute time, a
**trust label** (verified / likely / unverified), and a **price signal**
carrying that same trust logic. Three specific scenarios must work end to
end. Menus, dietary accommodation, contact info, and "ranking based on best
overall fit" are named nice-to-haves.

Everything below either directly satisfies one of those requirements or is a
deliberate extension built on top of them once the required surface was
solid.

---

## 2. Requirements → implementation map

| Challenge requirement | Where it's implemented | Status |
|---|---|---|
| Planner enters address, headcount, max commute time | `src/components/search-form.tsx`, `src/app/search/page.tsx` | ✅ |
| Walking **or** driving, stated explicitly | `commuteMode` param throughout; shown on every card as "`N` min walk/drive" | ✅ |
| Scenario 1 — 50 people, Times Square NYC, ≤20 min | `src/data/seed-venues.ts` (curated floor) + live discovery; smoke-tested in `scripts/test-scenarios.ts` | ✅ |
| Scenario 2 — 30 people, Salesforce Tower SF, ≤15 min | same | ✅ |
| Scenario 3 — 200 people, reception style, Waikiki, ≤15 min walk | same, plus `style` (seated/reception) filtering | ✅ |
| Venue name + address | `venue_card.tsx`, `/venue/[id]` | ✅ |
| Private rooms + per-room capacity | `venue_rooms` table; smallest-fitting-room selection in `src/lib/ranking.ts` | ✅ |
| Commute (distance/time) | `src/lib/geo/commute.ts` (real routing via OpenRouteService, haversine fallback, always labeled which) | ✅ |
| Trust label: verified / likely / unverified | `src/lib/discovery/trust.ts`, `src/lib/trust-labels.ts` — actually **five** tiers, see §4 | ✅ (extended) |
| Price signal, same trust logic | `src/lib/price-signal.ts` — independent trust label, never inherits capacity's | ✅ |
| *Nice to have:* menus | `menu_url` + `menu_trust` column, extracted in `src/lib/discovery/scraper.ts` | ✅ |
| *Nice to have:* dietary accommodations | `dietary_notes` + `dietary_trust`, same extraction pass | ✅ |
| *Nice to have:* ranking by best overall fit | `src/lib/ranking.ts` — commute + capacity fit + trust weight + style match, not a raw list | ✅ |
| *Nice to have:* contact info (email/phone) | `phone`, `email` columns, surfaced on card, detail page, compare, and summary | ✅ |
| React + Tailwind | Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui | ✅ |
| Postgres on Supabase | `supabase/migrations/`, accessed server-side via service-role key | ✅ |
| Not a booking/reservation system | No booking flow exists anywhere. Outreach is a compose-only draft (§7.6) — the app never sends anything | ✅ |

Everything past this table is differentiation built once the above was solid
— see §7.

---

## 3. Architecture at a glance

```
Planner types an address + headcount + commute
              │
              ▼
   ┌─────────────────────┐
   │  Geocode (Nominatim) │  src/lib/geo/geocode.ts
   └─────────┬───────────┘
             ▼
   ┌───────────────────────────┐
   │ ensureCoverage()          │  src/lib/discovery/ensure-coverage.ts
   │ "is this area's cached    │  30-day TTL cache gate — reuse cached
   │  data fresh enough?"      │  venues, or trigger a live crawl
   └─────────┬─────────────────┘
             │ (cache miss)
             ▼
   ┌───────────────────────────────────────────────────────┐
   │ Discovery pipeline (src/lib/discovery/pipeline.ts)     │
   │                                                         │
   │  1. discoverNearbyVenues()   Google Places or Overpass │
   │  2. scrapeVenueForPrivateDining()  static HTML + regex │
   │  3. renderPage()              JS-render fallback       │
   │     (only if step 2 found nothing)      (Firecrawl)    │
   │  4. extractPrivateDiningWithLlm()  prose → numbers     │
   │     (only if a page exists but states no number)(Grok) │
   │  5. buildVenueDraft()      cross-reference + trust tier│
   │  6. upsertVenueDraft()     de-dupe + write to Supabase │
   └─────────┬───────────────────────────────────────────────┘
             ▼
   ┌───────────────────────────┐
   │ Rank (src/lib/ranking.ts) │  commute + capacity fit (trust-weighted)
   │                           │  + style match → "best overall fit"
   └─────────┬─────────────────┘
             ▼
     Ranked results + map, streamed to the browser
     as each pipeline stage completes (§7.2)
```

Two structural decisions worth calling out up front, because they explain a
lot of the code:

- **Discovery is idempotent and safe to re-run.** Every write is an upsert
  keyed by a stable identifier (Google's `place_source_id`, or a de-dup match
  by name+proximity for anything Google doesn't know about — see §7.9).
  Re-running discovery for an already-covered area updates existing rows
  rather than duplicating them.
- **A curated floor exists independently of the live pipeline**
  (`src/data/seed-venues.ts`, loaded by `npm run seed`). The three required
  scenarios have real, hand-verified data (room names, actual capacities,
  sourced from each venue's own private-events page) even before — or if —
  live discovery ever runs for that area. The live pipeline supplements this
  floor; it never has to replace it for the demo to work.

---

## 4. The trust system (the core design decision)

The brief asks for three trust labels. This project ships **five**, because a
binary "we don't know" was hiding meaningfully different situations:

| Tier | Meaning | Ranking weight |
|---|---|---|
| `confirmed_by_planner` | A human phoned the venue and reported the answer back into the shared catalog | 1.0 |
| `verified` | Printed in numeral form on the venue's own private-dining page | 1.0 |
| `likely` | Venue confirms it hosts private events, but publishes no number | 0.6 |
| `ai_extracted` | An LLM read a number out of the venue's own prose (e.g. "seats about thirty") | 0.45 |
| `unverified` | Nothing found — "needs a call" | 0.25 |

**Why this is load-bearing, not decorative:** ranking multiplies capacity-fit
score by this weight (`src/lib/ranking.ts`). This was not true in an earlier
version, and the bug that resulted (an invented capacity for a coffee shop
outranking a venue's real, published 200-seat room, because the guess
happened to number-match the headcount more closely) is documented in
`DECISIONS.md` under "Density load test." Every trust tier decision in this
project follows from having been burned by that once.

**Where each tier comes from, concretely:**

- `verified` / `likely` / `unverified` — pattern-matching against the venue's
  own scraped page text (`src/lib/discovery/scraper.ts`, `trust.ts`).
- `ai_extracted` — schema-constrained xAI Grok extraction
  (`src/lib/discovery/llm-extract.ts`), used only when the regex pass found a
  private-dining page but no explicit number. `response_format: json_schema`
  with `strict: true` means the model cannot return prose or a wrongly-shaped
  object — it can still hallucinate a number, so implausible values (≤0,
  non-integer, >5000) are dropped regardless.
- **Cross-referencing**: when both the regex pass and the LLM pass produce a
  number for the same page, agreement within 20% *upgrades* the label to
  `verified`; disagreement *never* silently picks a winner — both numbers are
  shown and the label drops to `likely`.
- `confirmed_by_planner` — the community-verification flywheel, §7.4.

The **price signal** (`src/lib/price-signal.ts`) carries its **own**
independent trust label — a venue can have a `verified` capacity and an
`unverified` price, and the UI must never imply otherwise. This was a real
display-layer bug caught and fixed in Phase 1 (see `DECISIONS.md`).

All planner-facing wording for every tier lives in exactly one place —
`src/lib/trust-labels.ts` — as `Record<TrustLevel, string>` maps. This exists
because a non-exhaustive `if/else` chain once let two tiers silently fall
through to "unverified" copy, and let the raw enum string leak into the UI
("Minimum spend ~$4,250 (confirmed_by_planner)"). Adding a sixth tier today
is a TypeScript error everywhere wording is needed, not a silent bug.

---

## 5. Ranking: "best overall fit," not a raw list

`src/lib/ranking.ts` scores each venue on:

1. **Hard filters** — commute must be within the max, capacity must fit the
   headcount. Fail either and the venue doesn't appear at all.
2. **Capacity fit** — the *smallest* room that still fits the headcount wins
   (a 200-seat room for 30 people is a worse fit than a 40-seat room, even
   though both technically fit), scaled by the trust weight above.
3. **Style match** — reception vs. seated preference is penalized when
   mismatched, not excluded (a planner may still want to see it).
4. **Commute** — closer is better, within the hard cutoff.

Regression tests (`src/lib/ranking.test.ts`) pin: the smallest fitting room
wins; a `confirmed_by_planner` figure outranks a scraped one; an
*estimated* capacity can never outrank a *published* one; venues with no
commute data are skipped rather than assumed close; and one test per required
scenario using its exact numbers.

---

## 6. Data model

Seven tables, one migration per feature increment (`supabase/migrations/`,
apply in filename order):

| Table | Purpose |
|---|---|
| `companies` | A workspace: a shareable code + display name. The whole auth model — see §7.1. |
| `saved_addresses` | An office/location a company searches from repeatedly. |
| `searches` | Log of past searches (address, headcount, commute, mode, timestamp) per workspace. |
| `venues` | Name, address, lat/lng, category, price tier + trust, min spend + trust, phone/email/website, description, menu URL + trust, dietary notes + trust, `source` (`curated_seed` \| `auto_discovered`), `place_source_id` (Google's stable ID, used for upsert dedup). |
| `venue_rooms` | One row per named private room/space: capacity, style, `capacity_trust`. |
| `venue_photos` | Real photos only (see §7.10) — never a stock placeholder. |
| `shortlist_items` | A workspace's saved venues + free-text notes. |
| `venue_confirmations` | Append-only provenance log for the flywheel (§7.4) — who confirmed what, when, in which workspace. |

---

## 7. Feature deep-dives

Ordered roughly by build sequence: required-spec compliance first, then
depth added to the discovery pipeline, then planner-experience
differentiation. Each entry names the file(s) to open first.

### 7.1 Company workspaces (the auth model)

**Files:** `src/lib/workspace.ts`, `src/app/start/page.tsx`

No user accounts, no passwords. First use generates a shareable code (e.g.
`FOUNDER-DINNER-T4T`); anyone with the code sees the same saved addresses,
search history, and shortlist, via a cookie set server-side in a Server
Action. This is a deliberate scope decision: the brief describes a research
tool with no sensitive data,
and a shared-link model (like a Google Doc) has essentially zero setup
friction for a planner and a colleague comparing venues together. See
`DECISIONS.md` for the explicit trade-off this implies (no real
authorization boundary — anyone with the code has full write access) and what
a production version would add (Supabase Auth + RLS scoped to `auth.uid()`).

### 7.2 Live pipeline visibility (streamed search progress)

**Files:** `src/lib/search-stages.ts`, `src/components/search-pipeline.tsx`, `src/app/search/page.tsx`

A search can take several seconds (scraping a couple dozen venue sites is the
slow part). Rather than a generic spinner, `startSearchStages()` exposes the
search as three promises — origin resolved, coverage checked, results ranked
— each awaited inside its own React Suspense boundary. Each row in the UI
flips from spinner to result **at the exact moment that stage finishes on the
server**; it's an observed readout, not a timed animation, so it can't lie
about what's happening on a slow or partially-failed run. `performSearch()`
in `src/lib/search.ts` still exists as a synchronous composition of the same
three stages, so anything that doesn't need streaming (the scenario scripts,
the landing-page preview) is unaffected.

### 7.3 Natural-language search

**Files:** `src/lib/nl-query.ts`, `src/components/nl-search-box.tsx`, `naturalLanguageSearchAction` in `src/app/actions.ts`

A planner can type *"40 for a standing reception near Salesforce Tower, 10
minute walk max"* instead of filling in four separate fields. This is
layered **above** the structured form, never replacing it: Grok parses the
sentence into the same four parameters, and the result is used to
**pre-fill the form and redirect there for review** — it never searches
directly. The schema requires `null` for anything the sentence doesn't state,
and `sanitizeParsedQuery()` drops implausible values (a "10,000 guests"
misparse) rather than clamping them to a plausible-looking number, because a
confidently-wrong number the planner can't distinguish from one they typed is
worse than an empty box.

### 7.4 Community-verification flywheel + outreach draft

**Files:** `src/components/venue-confirmation-card.tsx`, `confirmVenueDetailAction` / outreach draft logic in `src/app/actions.ts`, migration `0006`

The highest-leverage feature in the project: it changes what "unverified —
needs a call" *means*. Instead of a dead end, a planner who calls a venue can
push the real figure back into the shared catalog as `confirmed_by_planner`
— the highest trust tier, above even `verified`. Two writes happen per
confirmation: an append-only `venue_confirmations` row (who, which workspace,
when — provenance, since a figure confirmed two years ago shouldn't read the
same as one confirmed last week) and a denormalized update onto the room/venue
itself, which is what makes every existing read path and the ranker pick it
up with zero additional code. Confirmations apply **catalog-wide**, not
per-workspace — a room's capacity is a fact about the venue, not about who
asked.

Paired in the same UI: a compose-only outreach draft, pre-filled with
headcount, date, the specific room, and the questions worth asking, handed to
the planner via `mailto:` or clipboard. The app never sends anything on its
own — this is stated in the UI copy, not just true in the code, because
"research tool, not a booking system" is a promise the interface itself
should make.

### 7.5 Cost per person

**File:** `src/lib/price-signal.ts`

`min_spend ÷ headcount`, shown on the card, compare view, and shareable
summary. It **inherits** the underlying price figure's trust badge rather
than getting its own — it's arithmetic on one already-labeled number, not a
second independent source, so an estimate built on `unverified` pricing
visibly says so rather than implying a confidence it doesn't have.

### 7.6 Side-by-side compare view

**File:** `src/app/compare/page.tsx`

Up to three shortlisted venues in one table: capacity for the *actual*
headcount, commute, price, cost per person, contact, menu, dietary notes, and
the team's own shortlist notes. Capped at three deliberately — this is a
decision aid meant to be read across in one glance, and a fourth column of
dense text stops being that. Room selection uses the exact same
"smallest room that still fits" rule the ranker uses, so this view can never
contradict the ranked list a planner already saw.

### 7.7 Exportable shortlist summary

**File:** `src/app/summary/[code]/page.tsx`

A read-only page at `/summary/[workspace-code]` a planner can forward to a
decision-maker who has no workspace access and shouldn't need any — gated by
knowing the code (like a shared doc link), sets no cookie, mutates nothing.
Ends with a plain-English legend explaining every trust label, since the
recipient has no other context for what "AI-extracted" means.

### 7.8 Persona-aware defaults

**File:** `src/lib/personas.ts`, `src/components/persona-picker.tsx`

Four pills matching the segments Nowadays actually sells to (executive
assistants, event marketers, agencies, people teams). Deliberately narrow
scope, enforced by tests (`src/lib/personas.test.ts`): a persona supplies
**default values for fields the planner hasn't set**, full stop. It never
filters results, never reweights ranking, and never overrides a value
already present in the URL — picking a persona can only change *where the
form starts*, never *what a search means*. Selection lives in the URL, not
client state, so it survives a refresh and is shareable.

### 7.9 3D map view (and the de-dup bug it indirectly surfaced)

**Files:** `src/components/map-panel.tsx`, `src/components/map-view-3d.tsx`, `src/components/map-view.tsx`

A 2D Leaflet map is the default (it always frames every result, and is the
right view for comparing distances across a spread-out result set). A 3D
toggle switches to MapLibre GL JS against OpenFreeMap's keyless `liberty`
style, which already ships a building-extrusion layer — useful for reading
*which building* a venue is actually in, in a dense downtown core. The two
map libraries are separately code-split; a planner who never opens 3D never
downloads MapLibre.

Two defensive layers exist because WebGL2 failure is not always a thrown
exception: an upfront `canvas.getContext("webgl2")` capability check, *and* a
`map.on("error", ...)` subscription that catches a GPU process failing
*after* that check passed (observed live in testing — see `DECISIONS.md`).
Either path shows a plain "3D view isn't available here, switch back to 2D"
message rather than a crash or a blank canvas with floating pins.

Unrelated to the map itself, but discovered while re-crawling to verify photo
fixes: `src/lib/discovery/pipeline.ts`'s `upsertVenueDraft()` now checks for
an existing venue (any source) with the same normalized name within 75
meters before writing a new one. Without this, Google re-discovering a
restaurant already in the curated seed set (which happens routinely — Google
has no way to know about our hand-curated data) produced two cards for the
same physical venue.

### 7.10 Photos: real where they exist, honest where they don't

**Files:** `src/lib/photos.ts`, `src/data/seed-venues.ts`, `upsertVenueDraft()` in `pipeline.ts`

No venue in this catalog ever shows a stock photo captioned as if it were the
actual venue. Four required-scenario NYC venues have genuine photographs
(committed to `public/`); auto-discovered venues get a real Google Places
photo of that exact location when one's available; anything else shows an
explicit **"no photo found"** state. A stock-placeholder approach was tried
and removed — see `DECISIONS.md` for why "clearly labeled but still visually
wrong" turned out to be worse in practice than "honestly blank."

### 7.11 Landing page: a real search, not a screenshot

**File:** `src/lib/landing-preview.ts`, `src/app/page.tsx`

The homepage preview runs the actual search pipeline for required scenario 1
(50 people, Times Square, 20-minute drive) and renders whatever comes back,
timestamped. This means it doubles as a continuously-running smoke test of a
graded scenario — if ranking regresses, the landing page shows it first.
Cached 6 hours via `unstable_cache` so anonymous visitors don't each trigger a
live geocode + discovery fan-out.

---

## 8. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) + React 19 | Recommended by the brief; Server Actions fit a mutation-heavy app (shortlist, confirmations, workspace) without a separate API layer |
| Styling | Tailwind CSS 4 + shadcn/ui | Required by the brief |
| Database | Supabase Postgres, accessed server-side via service-role key | Required by the brief; RLS bypass is intentional given the no-auth workspace model (see `DECISIONS.md`) |
| Geocoding | OpenStreetMap Nominatim | Free, keyless, no setup friction for a grader running this cold |
| Commute routing | OpenRouteService Matrix API, haversine fallback | Real routes when configured; always-available, clearly-labeled estimate otherwise |
| Venue discovery | Google Places API (New), OpenStreetMap Overpass fallback | Richer data with a key; the app still fully works with zero paid keys |
| JS-render fallback | Firecrawl | Avoids bundling a headless browser in a serverless function |
| Prose extraction + NL parsing | xAI Grok (`grok-4.5`, structured outputs) | Schema-constrained (`strict: true`) so it cannot return unshaped data |
| Maps | Leaflet (2D) + MapLibre GL JS / OpenFreeMap (3D) | Both keyless |
| Tests | Vitest | Zero-config TS/ESM, no Babel transform needed |

**The whole app runs with zero paid API keys.** Every external call has a
free, clearly-labeled fallback. See the "Optional API keys" table in
`README.md` for exactly what each key upgrades.

---

## 9. Orientation for a coding agent picking this up cold

If you're an agent asked to change something here, start with:

1. **Read `src/lib/search.ts` first.** It's the spine: geocode → ensure
   coverage → rank. Everything else either feeds it or reads its output.
2. **Trust tiers are an enum plus one lookup table.** If you're adding a new
   kind of evidence, it needs a `TrustLevel` value (`src/lib/supabase/types.ts`),
   a weight in `src/lib/ranking.ts`'s `TRUST_WEIGHT`, and copy in
   `src/lib/trust-labels.ts`. TypeScript will error at every call site you
   missed if you use exhaustive `Record<TrustLevel, ...>` maps like the
   existing ones — don't fall back to an `if/else` chain, that's the exact
   bug documented in `DECISIONS.md`.
3. **Discovery is deliberately layered by cost**: free static scrape → paid
   JS-render (only on empty) → paid LLM extraction (only on ambiguous
   prose). Adding a new signal source should follow the same "only pay when
   the free tier found nothing" gate, capped by something like
   `MAX_ENRICHMENT_BUDGET`.
4. **Every write to `venues`/`venue_rooms`/`venue_photos` in the discovery
   path goes through `upsertVenueDraft()`** in `src/lib/discovery/pipeline.ts`.
   That's also where the name+proximity de-dup guard lives — don't bypass it
   with a direct insert.
5. **Run the real test suite, not just the mental model:** `npm test` (100+
   unit tests on trust/ranking/price/personas/NL-parsing logic) and, if you
   touch anything network-facing, the live-service scripts in `scripts/`
   (they hit real APIs and cost credits where keys are configured — see
   README §Tests). Two real defects in this project (a ranking bug, a
   duplicate-venue bug) were caught by the *scripts*, not the unit suite,
   because they only manifest against live data at scale.
6. **`DECISIONS.md` is chronological and detailed on purpose** — if something
   looks like an odd choice, search there before "fixing" it; there's
   probably a documented reason (or an explicitly-accepted trade-off) already.

---

## 10. Known trade-offs and what's explicitly out of scope

Full detail in `DECISIONS.md`; short version:

- **No real authentication.** Workspace codes trade real auth for
  zero-friction sharing. Acceptable for a research tool with no sensitive
  data; a production version needs Supabase Auth + RLS.
- **Confirmations are trusted on sight.** Any workspace member can push a
  `confirmed_by_planner` figure. Provenance is recorded, but there's no
  corroboration/moderation step yet.
- **Capacity is estimated, not omitted, when a venue publishes nothing** —
  labeled `unverified` and named "Capacity unconfirmed" on the card. The
  alternative (excluding the venue entirely) would drop real candidates worth
  a planner's call; the ranking fix in §4 means a guess can no longer outrank
  a published figure.
- **The photo crossfade/tour is not built.** Only the first Google Places
  photo per venue is stored; there's no evidence yet that a second photo adds
  enough value to justify the extra fetch/storage/animation code.
- **Discovery radius is a heuristic**, not a true routable isochrone —
  intentionally generous so real per-venue routing doesn't miss a borderline
  result at the edge.

---

## 11. Quick command reference

```bash
npm install                            # install
npm run seed                           # load the curated fallback venues
npm run dev                            # run locally at localhost:3000
npm test                               # unit test suite (Vitest)
npm run test:scenarios                 # smoke-test all 3 required scenarios against real ranking logic
npx tsx scripts/loadtest-density.ts    # force a live re-crawl (bypasses cache, costs real API credits)
npx tsx scripts/verify-enrichment.ts   # verify Firecrawl + Grok tiers against real venue sites
npx tsx scripts/verify-nl-query.ts     # verify free-text parsing against live Grok
```

See `README.md` for full setup (Supabase project + migrations + env vars).
