# Pinnodds ALL baseball market inventory — production evidence

Run: https://github.com/coachhornsby/fbis/actions/runs/38357042410
Capture: 2026-10-13T06:30:39Z
API origin: `https://pinnodds.com`; authenticated via the **existing**
`PINNODDS_API_KEY` Cloudflare Orchestrator secret; never checked into GitHub.

## Sport and scope
Pinnodds sport ID **6** is Baseball. Every audit requests exactly:
1. `GET /kit/v1/prematch/fixtures?sport_id=6&include_specials=1`
2. `GET /kit/v1/markets?sport_id=6&event_type=live&include_specials=1`

No API calls if the production OIDC-only probe version check fails. It stops
immediately on 401/403/429 and does not retry quota-denied calls. The results
are captured as a temporary artifact and GitHub job summary. The authenticated
probe never writes prices into model inputs or grants wagering authority.

Four times daily at 00:23, 06:23, 12:23 and 18:23 UTC by GitHub Actions;
nominal eight API requests per day (schedule may be delayed by GitHub).
Do not interpret a zero-row snapshot as unsupported league coverage.

## Verified October 13 production snapshot
HTTP 200 both prematch and live; X-Data-Status was `fresh`.
Prematch: **3 MLB regular matches**, **115 MLB specials**,
**58 quoted MLB player-prop specials**, 1 NPB futures row and 1 KBO futures
row; live: 0 events. NPB/KBO regular-game and player-prop rows: **0**.

MLB quoted player-prop market counts:
- Home runs 26
- Total bases 22
- Strikeouts 4
- Hits allowed 2
- Pitching outs 2
- Earned runs 2

Concrete examples for Kevin Gausman (decimal odds, snapshot only):
- Ks 4.5: Over 2.20, Under 1.689
- Hits allowed 4.5: Over 2.59, Under 1.51
- Pitching outs 14.5: Over 2.34, Under 1.613
- Earned runs 1.5: Over 1.649, Under 2.27

NPB special: **Nippon Professional Baseball Winner** — futures, not
an individual-game market. KBO special: **Korea Professional Baseball
Winner** — futures, not an individual-game market.

NO verified starting-pitcher metadata fields were observed on the 3 MLB
regular event rows; a named pitcher prop is NOT proof of confirmed starter
status. Preserve official starter identity/confirmation sources.

## Engineering next
- Convert only well-matched sports/teams/periods/player identities into
  `normalized_market_observations` with original source timestamps.
- Validate individual contract scope, market availability, and freshness,
  including line depth and provider max risk. No odds fabricated or borrowed
  across providers.
- Preserve point-in-time immutability and independent FBIS forecast authority.
- NPB and KBO remain starter-data / active-game-market gaps until verified.
- The recurring workflow is a **research inventory**, not streaming live
  quotes on the FBIS website, trading, model qualification, or a promise of
  profitable player-prop predictions.
