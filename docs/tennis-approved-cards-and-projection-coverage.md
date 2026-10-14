# Tennis matchup cards and projection coverage

## Production inspection — 2026-10-14

Repository and Cloudflare canonical deployment initially matched
`cb71f2df3c36847580bee6e64e0553b53c394b15`.

Read-only production D1 inspection found:

- No rows in `tennis_official_matches`, hence no verified upcoming fixtures.
- No upcoming persisted Tennis v2 decisions.
- 391 ATP and 5,031 WTA canonical players; zero portrait URLs in either tour.
- Independently ingested ESPN fixtures exist and have linked research markets.
- WTA ranking ingestion was complete; player profile ingestion remained partial.
- Serve/return surface profiles exist, but observed example profiles last included
  matches in May 2026. A recent collection timestamp does not make the underlying
  playing history current.

The prior inference path began at Action market snapshots. `autoDecisionForMarket`
required a market prior, and persistence rejected a PURE output if the separate
market-residual layer could not run. The board also began at persisted decisions,
so official fixtures without a decision had no card. These are independent
availability defects, distinct from missing official schedule evidence.

## Changes

The existing card and player bank remain the product. The hero uses full-word
names, larger surnames, canonical metadata, country backgrounds, a central VS,
and branded portrait fallbacks. RU/BY/explicit neutral-athlete presentation hides
national flags. No borrowed player photo or guessed headshot URL was added.

The shared probability bar reads only the paired PURE record. An always-visible
projection panel shows probability, fair moneyline, winner, genuine persisted
simulator total when available, version, creation time, freshness, or actual block
reason. No modeled spread is invented. Fair odds and probability share one input.

Market spreads/totals use the existing `spreadDetail`/`totalDetail` contract.
Model-versus-market comparison requires paired no-vig probabilities and quote /
projection clocks within two hours; stale, missing, or future quote clocks hide
edges. Missing sportsbooks are not labeled consensus. Venue offers and Action
intelligence remain informational; empty Action data has a compact status.

Form, full stored H2H retrieval, surface H2H, surface profiles, canonical player
IDs, and expandable research remain accessible. Zero-match surface profiles show
"No sample" for performance rates instead of presenting shrunk priors as observed
results. Unknown nationality, tournament, surface, venue, format, and times stay
unknown. Independent fixtures expire four hours after observation (their existing
collector runs every three hours), rather than retaining disappeared fixtures
for eighteen hours. Research cards are labeled and grouped after verified cards.

## Inference and coverage

`GET /api/tennis-projection-coverage` is read-only. It reports a bounded 72-hour
window, official fixture candidates, verified fixtures, successful/missing/stale
outputs, missing-output rate, fixture status, and block reasons. A zero-fixture
window has a null missing rate, not a misleading 100% coverage claim.

`POST` requires existing harvest authorization. The hourly
`tennis-fixture-projections.yml` workflow resolves production before attempting
fixtures and retains inference plus readback coverage artifacts. Board reads do
not run simulations or acquire providers.

The new path verifies official identity/context and pre-match sourced deep
profiles, refuses unverified match formats, runs the unchanged Tennis v2 PURE
simulator, and persists `PURE_FIXTURE` records with no market prior. Simulator
output, exact model version, event proof, profile cutoffs, and simulation count
are retained in the existing decision context JSON. A current successful record
prevents duplicate simulations. Supported official fixtures missing predictions
retain visible blocked panels on the board.

No market probability is used to fill a PURE panel. No official fixture is
created from ESPN research data. Existing champion, qualification thresholds,
research-only state, execution gates, and wagering permissions are unchanged.

## Validation and remaining source blockers

Validation includes the full repository suite, Tennis suite, migration checks,
Functions syntax, Vite production build, SQLite fixture → real simulator →
persistence → readback/idempotency, and Chromium screenshot checks at 1440, 768,
and 390 pixels. Visual fixtures are explicitly labeled test data and excluded
from production authoring routes. Reduced-motion behavior, long names, missing
portraits, blocked states, and neutral flags are checked.

The approved design's real portraits remain blocked on authorized portrait assets. An image URL's public availability alone is not a grant
of image rights. This release does not guess either. ATP schedule ingestion remains absent. The official WTA source audit found an
available upcoming order-of-play contract; this release adds a separate WTA
schedule capture before inference. Official source IDs resolve players, explicit
timezone clocks establish scheduled instants, and Followed By / Unscheduled
23:59 placeholders become TIME_UNVERIFIED with no start timestamp. Raw source
responses and match observations retain point-in-time provenance. No research
fixture is promoted by this path. Permanent canonical player research pages
expose the existing D1 identity, surface, and recent-match evidence with their
source and last-included-match timestamps.


Production readback at 2026-10-14T18:40:21Z verified 13 upcoming official WTA
fixtures and eight persisted PURE projections. Five remain blocked: four
SURFACE_PROFILE_MISSING and one PROFILE_SAMPLE_MISSING. Missing-output rate is
38.46%, with zero stale output records. This is pipeline freshness, not a claim
that historical performance samples are current; displayed last-match dates
include May 2026 and October 2025. Three October 14 CT official cards render
actual probabilities, fair odds and simulator totals. Shnaider–Muchova renders
28.2%/71.8% and 23.7 games; these are persisted production outputs, not mockup
constants. Neutral-athlete presentation suppresses national flags.

Verified official schedules precede a separate independent ESPN section, and
both explicitly disclaim wager authority. Missing primary market quote clocks
suppress comparative edges. Polymarket observations remain informational and
retain original fixture IDs and collection timestamps. No Action snapshot was
available for the inspected cards. MLB production cards also remained functional.
