# Decisions & trade-offs log

Running log of engineering decisions, kept as work happens so it can feed the
written-response deliverable directly. Newest phase last.

---

## Phase 1 — spec compliance and correctness

### Three provisioned API keys were never being read

The repo read `ORS_API_KEY` / `GOOGLE_PLACES_API_KEY`, but `.env` defined
`openroute_service_key` / `google_api_key`. Both were silently unused, so the
app ran permanently on its fallback paths: commute times were haversine
estimates rather than real routes, and discovery used OpenStreetMap Overpass
rather than Google Places.

Verified each key with a live request before wiring it, rather than assuming:

| Key | Result |
|---|---|
| OpenRouteService | Works, including the matrix endpoint and the exact auth header style `commute.ts` already used. No code change needed. |
| xAI Grok | Works; `grok-4.5` present in `/v1/models`. |
| Firecrawl | Works; current API is v2, and `formats: [{ type: "json", schema }]` extraction returns 200. |
| Google Places (first key) | Blocked for Places on both legacy and new endpoints. |
| Google Places (second key) | Works on Places API (New); **legacy endpoints explicitly disabled** for the project. |

**Effect:** all three required scenarios now report routed commute times
(`(routed)` rather than `(estimated)` in the smoke-test output).

**Trade-off:** `.env` keeps the original variable names alongside the ones the
code reads. Slight duplication, but it avoids breaking anything else that may
reference the originals, and `.env.example` documents the canonical names.

### The price signal didn't carry its own trust label

The challenge requires the price signal to be labeled with the *same trust
logic* as capacity — meaning its own independent label, not capacity's.

The schema already separated `price_tier_trust` and `min_spend_trust` from
`capacity_trust`, and `/venue/[id]` displayed them correctly. But the venue
card and the shortlist rendered a single trust badge (capacity's) next to a
bare price-tier badge, so a card could read "$$$ · Verified" while nothing
about that price had been verified. That's the exact failure mode the trust
system exists to prevent, and it was a display-layer bug only.

Fixed by adding `src/lib/price-signal.ts` as the single place that resolves
which price figure to show and which trust label belongs to it, then pairing
each fact with its own badge on the card and shortlist.

**Decisions inside that helper:**
- Minimum spend wins over price tier when both exist — it's the number a
  planner actually budgets against.
- With neither available, it returns an explicit "Price unknown" at
  `unverified` rather than rendering blank, preserving the fails-safe pattern.
- `TrustBadge` gained an optional `subject` prop so the pairing is announced
  to screen readers ("Price: needs a call"), not conveyed by layout alone.

### Tests

There was no test runner at all. Added Vitest (36 tests, all passing) covering
the two pieces of logic where a silent regression would be most damaging:

- **Trust derivation** (`trust.test.ts`): explicit capacity on a private-dining
  page → `verified`; page but no number → `likely`; no page → `unverified`;
  capacity numbers found *without* a private-dining page still → `unverified`
  (numbers appear incidentally in addresses/prices/years, so a number alone
  must not earn trust); category-estimated capacity is always `unverified`;
  price trust stays independent of capacity trust.
- **Ranking** (`ranking.test.ts`): commute cutoff and capacity are hard
  filters; the smallest fitting room wins; tighter capacity fit and better
  trust each rank higher all else equal; style mismatch is penalized but not
  excluded; venues with no commute data are skipped rather than assumed close;
  plus one test per required scenario using its exact numbers.
- **Price signal** (`price-signal.test.ts`): precedence, honest unknown, and
  that a price is never reported as more trustworthy than its own source.

Chose Vitest over Jest for zero-config TS/ESM support, and kept the
environment as plain `node` since all tested logic is pure.

### Ported discovery from legacy Places API to Places API (New)

Wiring the Google key surfaced a latent break: `places.ts` called the legacy
`maps.googleapis.com/maps/api/place/*` endpoints, which are disabled for this
Cloud project. Worse, `discoverNearbyVenues` only fell back to Overpass when
*no key was configured* — so a configured-but-failing Google path returned zero
candidates and never fell back, silently producing empty discovery.

Changes:
- Rewrote against `places.googleapis.com/v1/places:searchNearby` with an
  explicit `X-Goog-FieldMask`.
- Removed the N+1 request pattern. The legacy code needed a separate Place
  Details call per candidate to get website/phone/photo; the field mask returns
  all of it in the initial request.
- Requests each venue type separately (`searchNearby` caps a response at 20
  places), so a dense core like Times Square isn't represented by 20 pizza
  counters.
- Made the Overpass fallback trigger whenever Google yields nothing, not just
  when the key is absent — restoring fails-safe behavior.
- Maps Google's `priceLevel` enum back onto the existing 0–4 numeric contract
  so trust/tier logic stays provider-agnostic and its tests stay valid.

**Photos are built but currently inert.** `photos` comes back empty from both
Text Search and Place Details even with an explicit `fields=photos`, for places
that demonstrably have photos on Google Maps, while basic fields work — the
signature of a project billing/SKU restriction rather than a code problem.
The path is implemented so it activates automatically once that's resolved.

**Security decision:** the legacy code embedded the API key directly in stored
photo URLs, which leaks it into the database and into page HTML. The port
stores only the opaque photo resource name and serves bytes through
`/api/place-photo`, which attaches the key server-side and validates the
resource name so the route can't be used as an open proxy.

### Still open from Phase 1

- Landing-page example data (`src/app/page.tsx` `MOCK_CARDS`) claims to come
  from a real run. Decision: replace with a real live search on the landing
  page, so there's nothing to keep in sync. Not yet done.

---

## Phase 2 — scraper depth

### Firecrawl over self-hosted Playwright for JS rendering

The static cheerio pass can't see content rendered client-side, which was
mislabeling real venues as "unverified" purely because of a tooling gap.

Chose Firecrawl (hosted) over bundling Playwright/Puppeteer. On serverless
Next.js, a headless Chromium means a ~300MB dependency, multi-second cold
starts, and per-host anti-bot handling we'd maintain ourselves; Firecrawl is
one fetch with a timeout that degrades like any other network call. The
trade-off is a paid dependency with per-page cost — accepted, then contained
with the gating below.

Verified against the live v2 API before writing the integration: the current
endpoint is `api.firecrawl.dev/v2/scrape`, and `formats: [{type:"json",
schema}]` extraction works but bills 5 credits/page versus 1 for `markdown`.

**Architecture decision — render and extract are kept separate.** Firecrawl
could do schema extraction itself in the same call, but this requests
`markdown` only and extracts separately. That keeps the regex pass and the LLM
pass as two genuinely independent reads of the same page, which is what makes
the cross-referencing below possible, and costs 1 credit instead of 5.

**Cost gating (two layers):**
- Rendering only runs when the free static pass produced no capacity figure,
  so spend goes only to pages the cheap path couldn't read.
- `MAX_ENRICHMENT_BUDGET` caps how many venues per run may reach the paid
  tiers. In a dense area the first gate alone can match most candidates, so
  without a ceiling one Manhattan search could drain the credit balance.
  Candidates are processed in discovery order, so the budget goes to the
  closest venues.

**A flaw this surfaced:** the first implementation only kept a rendered page if
it contained capacity numbers or private-dining keywords. That threw away the
contact details, menu link, and page text for any site that blocked a plain
fetch outright — exactly the sites rendering exists to rescue, and it left the
LLM tier unable to run on them. Now the rendered text is always kept; only the
trust-relevant `privateDiningPageFound` claim stays gated on evidence.

### Grok as a distinct `ai_extracted` tier, not a merged one

Added `grok-4.5` schema-constrained extraction (verified `grok-4.5` is live in
`/v1/models`; uses `response_format: json_schema` with `strict: true`, so the
model cannot return prose or a differently-shaped object).

New enum value `ai_extracted` via migration `0004`, deliberately its own tier:
an AI-read capacity is more informative than "we found nothing" but less
reliable than a number matched verbatim on the venue's page, so merging it into
either neighbour would misrepresent it. It's labeled by *how the number was
obtained* ("AI-extracted") rather than by a confidence adjective, letting the
planner weigh it themselves. Ranking weights it 0.45, below `likely` (0.6).

`strict: true` guarantees shape, not semantics, so implausible figures
(non-integer, ≤0, >5000) are dropped — a hallucinated 900-person private room
is still correctly shaped.

**Measured result** on `wayfaretavern.com/private-events`, a real site where the
static pass found the page but no numbers: rendering succeeded and the LLM
returned five *named* rooms (Sequoia Lounge, Barbary Room, Juniper Bar, Juniper
Dining Room, Cellar Dining Room). The old pipeline showed this venue as a
single vague "second-floor private rooms (unspecified breakdown)".

### Cross-referencing: disagreement is surfaced, not resolved

When both the regex pass and the LLM pass produce a capacity for the same page,
they're compared. Agreement within 20% upgrades the label to `verified` — two
independent methods agreeing is stronger evidence than either alone.
Disagreement beyond that is never silently resolved by picking a winner: both
figures are shown ("the page text reads as up to 60 guests, while AI extraction
reads 200"), and the label *drops* to `likely`.

20% tolerance because venues routinely describe one room as both "up to 60" and
"seats 55"; an exact-match rule would flag normal paraphrasing as a conflict.

The verbatim figure stays the displayed number — it's what's actually printed on
the page — with the conflict carried by the label and note.

### Menus and dietary info

Both columns already existed but had no trust labels, so migration `0005` adds
`menu_trust` and `dietary_trust`. They're separate columns, not one shared
label: a venue commonly links a concrete menu PDF while only vaguely gesturing
at dietary accommodations in prose, so the two genuinely differ in confidence.

- Menu links prefer a PDF on the venue's own host; off-host links are rejected
  so a delivery aggregator's menu isn't passed off as the venue's. Found
  alongside a confirmed private-dining page → `verified`; found without one →
  `likely`, since it may just be the regular restaurant menu.
- Dietary phrases matched on the venue's own pages are `likely` — the phrase is
  real, but "vegan" appearing near private-dining copy isn't a commitment to
  cater a vegan event. An LLM summary of the same text is `ai_extracted`.
- The dietary section now renders **even when empty**. "We looked and found
  nothing published" is real information to a planner with dietary
  requirements; hiding the section leaves them unsure whether it was checked.

### Dense-area candidate cap

`MAX_CANDIDATES_TO_SCRAPE = 12` was a flat cap. Discovery order reflects
proximity and place type, not private-dining capability, so in a dense core the
venues that actually host 200-person receptions were often past position 12.
The cap now scales with how crowded the area turned out to be (12 → 20 → 30).

Also ported discovery to request each venue type separately, since
`searchNearby` caps a single response at 20 places — otherwise a dense core
comes back as 20 pizza counters.

### Testing

63 tests passing. Beyond the Phase 1 suites, added coverage for the
AI-extracted tier (own tier, all rooms preserved, verbatim figures still win
over AI reads), cross-referencing (agreement upgrades, disagreement surfaces
both values and downgrades), menu/dietary labeling, and the menu/dietary
extraction helpers (PDF preference, off-host rejection, malformed hrefs,
de-duplication, honest nulls).

Unit tests can't prove an external API still behaves as documented, so
`scripts/verify-enrichment.ts` exercises both tiers against real venue sites.
That's how the discarded-render flaw above was caught.

---

## Phase 3 — differentiation

### Community-verification flywheel

The highest-leverage feature here, because it changes what "unverified — needs
a call" *means*: instead of a dead end, it becomes the mechanism by which the
catalog improves. Migration `0006` adds `confirmed_by_planner` as a tier above
`verified` — everything else in this system is inferred from what a venue
publishes; this is a human who phoned and asked.

**Two writes per confirmation, deliberately:**
1. An append-only `venue_confirmations` row — the provenance (who, which
   workspace, when, what they were told). A capacity confirmed two years ago
   shouldn't read the same as one confirmed last week.
2. The denormalized figure onto the room/venue. This is what makes it a
   flywheel rather than a private note: every existing read path and the ranker
   pick it up with no changes.

**Confirmations apply catalog-wide, not per-workspace.** A room's capacity is a
fact about the venue, not about the company that asked; scoping it privately
would throw away the entire compounding benefit. Attribution is stored so the
figure keeps its provenance, using the existing no-auth model (a display name
within a workspace, not a verified identity).

`room_id` is nullable and `on delete set null`: a planner may confirm a
venue-level fact like minimum spend that belongs to no single room, and
re-scraping a venue's rooms must never destroy call history.

### Compose-only outreach draft

Paired with the flywheel in one component, since asking the venue and recording
the answer are two halves of the same loop. Generates a pre-filled draft
(headcount, date, the specific room, the four questions worth asking) and hands
it to the planner via a `mailto:` link or clipboard copy. The app never sends
anything — stated in the UI, not just in code.

### A bug the integration check caught

`scripts/verify-flywheel.ts` does a real round-trip (insert confirmation →
update room → run `performSearch` → assert the label survives → revert). It
immediately caught two user-facing bugs that all 65 unit tests missed:

1. A `confirmed_by_planner` room was described as **"Capacity unverified — call
   the venue to confirm"**. The reason strings were an if/else chain ending in
   an unverified fallback, so *every tier added after `likely`* fell through to
   it — the `ai_extracted` tier had the same bug.
2. The raw enum identifier leaked into planner-facing copy: "Minimum spend
   ~$4,250 (confirmed_by_planner)".

Root cause was the same for both: non-exhaustive handling of a widening enum.
Fixed by moving all trust wording into `src/lib/trust-labels.ts` as
`Record<TrustLevel, string>` maps, shared by the badge and the ranker, so
adding a tier is now a *type error* everywhere wording is needed rather than a
silent fallthrough. Regression tests assert no raw enum identifier ever reaches
the planner.

Worth noting as a process point: the failure mode wasn't a missing test, it was
a test suite that could only see what it was pointed at. The round-trip script
found in one run what unit tests structurally couldn't.

### Cost per person

`min_spend ÷ headcount`, shown on the card, the compare view, and the shareable
summary. It inherits the underlying price figure's trust label rather than
carrying its own badge: the estimate is arithmetic on that one number, so a
second badge would imply a second, independent source. An estimate built on
unverified pricing therefore visibly says so.

### Side-by-side compare view

`/compare` puts up to three shortlisted venues in one table — capacity for the
actual headcount, commute, price, cost per person, contact, menu, dietary, and
the team's own notes. Capped at three because the value is a decision aid a
human reads across, and four columns of dense text stops being that.

Rooms are chosen per column using the same "smallest room that still fits" rule
the ranker uses, so the compare view can't contradict the ranked list.

### Exportable shortlist summary

`/summary/[code]` is a read-only page a planner can forward to a decision-maker.
Gated by the workspace code, matching the rest of the app's model — possession
of the link is the credential, like a shared doc. It sets no cookie and mutates
nothing, deliberately: the recipient is likely an exec who should be able to
read it, not join a workspace. It ends with a plain-English legend for the trust
labels, since the person receiving it has no other context for them.

### Landing page: a real search, not a screenshot

The hero preview used to be a hardcoded `MOCK_CARDS` array captioned as real
output from a real run. That was true the day it was written and silently
becomes a false claim the moment ranking weights or the catalog change.

It now runs the actual pipeline for required scenario 1 (50 near Times Square,
20-minute drive) and renders whatever came back, captioned with the UTC
timestamp of the run. Two consequences worth stating:

- It doubles as a continuously-running smoke test of a graded scenario. When the
  ranking fix below landed, the landing page changed too, because it isn't a
  separate artifact.
- Ranking demoted Carmine's out of the top four on its own (a 200-seat room is a
  poor fit for 50), which is the correct behaviour and something a hand-curated
  preview would have quietly hidden.

Cached with `unstable_cache` for 6 hours so anonymous visitors don't each
trigger a geocode and commute fan-out: measured 40s cold, 50ms warm. That API
is deprecated in favour of the `use cache` directive, but the directive requires
enabling the project-wide `cacheComponents` flag, which changes rendering
semantics for every route. Not worth that blast radius for one panel.

If the pipeline can't reach its sources the panel says so rather than falling
back to invented cards.

### Live pipeline visibility

The generic loading skeleton is replaced by a three-row readout of what the
search is actually doing: locating the address, reading venue websites (with the
count actually fetched), then measuring commute and ranking (with "N of M
results have a capacity confirmed on the venue's own site").

**Each row's state is observed, not animated.** A timed client-side sequence
would have been far easier and would look identical on a good run — and would
lie on a bad one, cheerfully reporting progress for a venue whose site 404'd.

Implementation is three promises that settle in order (`src/lib/search-stages.ts`),
each awaited inside its own Suspense boundary, so React streams each row in as
that stage finishes. Work starts once and the promises are shared — nothing runs
twice, and the page shell no longer waits on the slowest scrape. `performSearch`
still exists as a thin composition of the three stages, so the scenario scripts
and landing preview were untouched.

The panel stays visible after results load rather than vanishing. "We re-checked
18 sites just now, 4 of 9 results are venue-confirmed" is provenance a planner
deciding whether to trust the list actually wants.

### Natural-language search

Layered above the structured form, never replacing it. Grok parses free text
into the same four parameters, and the action then **redirects into the
populated form** rather than searching directly. The parse is always reviewable
and correctable, and an address the model got wrong is obvious before anyone
reads a ranked list built on it.

The schema requires nulls for anything the sentence doesn't state, and unstated
fields are left off the URL entirely so the form falls back to its own defaults.
A confidently-invented headcount is worse than an empty box, because the planner
would have no way to tell it apart from one they typed.

`sanitizeParsedQuery` drops out-of-range values instead of clamping them: a
"10000 guests" read is far more likely a misparse than a real request, and
quietly turning it into 5000 would hide that.

Verified against live Grok (`scripts/verify-nl-query.ts`). All three required
scenarios parse correctly, and "somewhere nice for a team dinner" correctly
yields null for headcount, location, and commute.

One real bug fixed along the way: an NL-parsed address was being silently
discarded, because a URL with an address but no headcount still looked
"pristine" to the page, which then pre-selected the first saved office over it.

### Persona-aware defaults

Four pills matching the segments Nowadays sells to (executive assistants, event
marketers, agencies, people teams). Scope is deliberately tiny: a persona only
supplies **defaults for fields the planner hasn't set**. It never filters
results, never reweights ranking, and never overrides a value already in the
URL, so picking one cannot quietly change what a search means — only where the
form starts. Tests pin that property directly.

Selection lives in the URL rather than client state, so it survives a refresh
and can be shared.

### 3D map view

MapLibre GL JS against OpenFreeMap's `liberty` style — genuinely keyless (no
registration, no quota), which preserves the project's "runs with zero paid
keys" property. Attribution is carried by the style and rendered automatically.

Worth noting from reading the style JSON rather than assuming: `liberty` already
ships a `building-3d` fill-extrusion layer driven by OpenMapTiles'
`render_height`/`render_min_height`, active from zoom 14. So there was no
extrusion layer to hand-roll; adding one would double-draw the same geometry.
The work was camera behaviour instead — fit the results, then ease into the
tilt, since `FitBoundsOptions` has no pitch field.

2D remains the default: it always frames every result and is the view you want
for comparing distances. 3D is opt-in for reading a specific block. The two
libraries are separately code-split, so a planner who never opens 3D never
downloads MapLibre.

`maplibre-gl` installed as v6, which **dropped the default export** — the
current OpenFreeMap quick-start still documents v5's `maplibregl.Map`. Caught by
the type checker, not by guessing.

### Density load test, and the two defects it found

`scripts/loadtest-density.ts` bypasses the 30-day coverage cache and forces live
runs against Times Square and the SF Financial District. It found two problems
that no unit test would have.

**1. The candidate cap was leaving most of a dense area unread.** Times Square
returns ~70 candidates for a 20-minute driving radius; the cap read 30 of them
and surfaced 7 venues with a site-confirmed capacity.

The fix was not simply raising the cap. This tier is a plain HTTP GET plus an
HTML parse — free — and the requests fan out across distinct venue domains, so
concurrency was the real constraint, not cost or politeness. Raising concurrency
4 → 8 alongside the caps (12/20/30 → 15/25/45) made it *both* broader and
faster:

| | before | after |
|---|---|---|
| Times Square sites read | 30 in 51.4s | 45 in 31.3s |
| venues cached in area | 52 | 64 |
| site-confirmed capacities | 7 | 9 |

The paid rendering/LLM tiers stay bounded by `MAX_ENRICHMENT_BUDGET`, so API
spend per run is unchanged.

**2. A fabricated capacity could outrank a verified one.** With the wider net,
required scenario 1 came back with Raising Cane's, LOS TACOS and Joe's Pizza
ranked 2–4, above Carmine's private party room.

The cause was structural, not cosmetic. Venues that publish no capacity get a
category estimate (`estimateCapacityByCategory`), and a guess of ~60 is a
near-perfect "fit" for a party of 50, while Carmine's real 200-seat room scores
as a loose fit. Raw capacity fit was rewarding a number we invented.

Fit credit is now proportional to how much the figure is believed
(`rawCapacityFit × TRUST_WEIGHT[capacity_trust]`). The top of scenario 1 became
Dos Caminos (verified) → Carmine's (verified) → Carmine's 44th (verified) →
AperiBar (likely), with the guessed entries below. Locked in with regression
tests.

This is the clearest example in the project of why the trust tiers have to be
load-bearing rather than decorative: the labels were already correct, but the
ranker wasn't listening to them.

### Photos: real where they exist, honest where they don't

Four venues in the required NYC scenario now carry genuine photographs (the
files already in `public/`, previously used only on the landing page) as their
*only* photo. Padding them out with picsum filler would have produced a "photo
tour" mixing one real room with two stock images, which is worse than one
accurate picture. Remaining seed venues keep placeholders, detected at render
time and visibly labeled "Placeholder image". Auto-discovered venues get no
placeholder at all — only genuine Google Places photos, or an explicit "no photo
found".

**The auto-crossfade photo tour was deliberately not built.** Google Places
Photos returns HTTP 200 with the `photos` field absent entirely, even when
explicitly requested in the field mask — a project-level SKU/billing
restriction, re-confirmed this session, not a code bug. No venue in the catalog
has two genuine photos, so a crossfade would be code that never runs. The
storage path already keeps every photo returned, so it would activate on its own
if that SKU were enabled.

### Known trade-off left in place

`estimateCapacityByCategory` still invents a number for venues that publish
none, labeled `unverified` with the room named "Capacity unconfirmed" and a note
saying it was estimated from category alone. It's honest at the field level, but
the guess does load-bearing work in *filtering*: it decides whether an unknown
venue appears in a 200-person search at all.

Left as-is because the alternative — excluding every venue with no published
capacity — would drop real candidates a planner might want to call, and the
ranking fix above means guessed figures no longer outrank confirmed ones.
Documented rather than silently accepted.
