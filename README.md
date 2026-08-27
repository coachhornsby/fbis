# FBIS — Fastwater Betting Intelligence System

Operator dashboard for independent projections, Pinnacle pricing, +EV, and forecast grading.
Hosted on **Cloudflare Pages**. No droplet.

Live: **https://fbis-myz.pages.dev/**

FBIS is not a picks site. The loop is:

**forecast → no-vig price → compare to Pinnacle → require +EV → record → grade final → diagnose error → repeat**

Champion model weights do not auto-rewrite from last night’s W/L.

## Boards

MLB · NBA · NFL · CFB · CBB · **SYS** (forecast tracking)

College baseball was dropped. NBA was added.

## Book stack

One job per source. They are never interchangeable.

| Role | Source | Use |
|---|---|---|
| Execution | Heritage | Where you actually bet. Every rec is a Heritage ticket. |
| Sharp / fair | Pinnacle | Market layer, vig, no-vig, CLV. Parlay `eu` region. |
| Sentiment | Kalshi | Public implied probability only. Never a betting price. |
| MLB scores | Baseball Savant | Run projections from SP quality + team RPG. Not the 1.5 run line. |
| MLB matchups | Ballpark Pal | Optional overlay: simulated runs, F5, park, starter matchups. |

Parlay does not list Heritage. The Pinnacle number is the benchmark to shop at Heritage — it is not recorded as a Heritage execution price unless Heritage is actually in the feed. If Pinnacle is missing, the market stays empty — Kalshi is not a fallback.

Every selection shows **Pinnacle vig** (two-way hold) and the no-vig probability. Fair American is `1/p`. EV is expectancy at the Pinnacle price. A projection is not a bet until it clears sport-aware edge **and** +3% EV at a complete two-way. Missing EV fails the gate. Unpriced model disagreement is a **lean**, not a qualified ticket.

Baseball run line is always **1.5** (full game) / **0.5** (F5). Alternate lines are never rewritten onto those numbers.

## How scores are projected

- **MLB** — Two independent models. Proprietary: Savant RPG × starter ERA-eq × 1.04 home, clamped 2.3–7.2. Ballpark Pal: simulated runs and Pal win probability as a separate layer. Pal never overwrites Savant and is never a sportsbook price. Win-prob blends Pinnacle no-vig, ESPN, Savant score, Pal, and W-L form.
- **CFB** — Independent FBIS-v1.3 prior + season form (ESPN AP rank, records, harvested points for/against). HFA 2.5 (0 on neutral). Pinnacle remains the market layer only.
- **NBA / NFL / CBB** — Pinnacle total/spread split into implied team scores until an independent sim is wired. Win-prob blends no-vig Pinnacle, ESPN, score (line-implied margin), and W-L form.

Hover a Proj cell for the recipe. SYS explains every board.

## Tracking (SYS)

The website is not the collector. GitHub Actions call `/api/collect` through the day (full Parlay odds at ~8am and 11am CT; cache-only later) so every scheduled game gets pregame checkpoints even if nobody opens the board. `/api/harvest` (~06:20 CT) attaches finals and writes them to D1. Each Action job loops MLB/NBA/NFL/CFB/CBB as separate Worker invocations (`?sport=`), and football dates as `?dayOffset=`, so a large CFB slate cannot exhaust the Cloudflare subrequest budget and starve other boards. A 207/partial or 500/failed collect does not stamp `last_collect_success_at`. UTC crons are fixed; Chicago offset is CDT (UTC-5, ~Mar–Nov) or CST (UTC-6, ~Nov–Mar). Scheduled verification requires an actual GitHub `schedule` run, not only `workflow_dispatch`.

SYS reads D1 (cache is a 21-day fallback). Projection Accuracy reports actual vs projected totals, % bias, home/away bias, MAE, median abs, RMSE, within-X distribution, Pal vs proprietary vs ensemble vs Pinnacle, team/park/starter/month slices, and both score-winner and ensemble-probability winner hit. Calibration includes home p below 50%. Logged tickets stay a separate dataset from every-game forecast error.

Checkpoints: FIRST_AVAILABLE · EARLY · MORNING · LINEUP_CONFIRMED · PREGAME · CLOSE. FIRST_AVAILABLE is the first freeze; older EARLY rows still count as the first-available alias.

**CLV** is entry no-vig vs close (last pregame) no-vig for the side you bet — not model fair vs market.

Model version: **FBIS-v1.3**

**CFB (v1.3)** — Independent score model: ESPN AP rank prior + harvested current-season points for/against, blended with `w = n/(n+6)`. HFA 2.5 (0 on neutral). Win/spread/total probabilities use an explicit Normal sigma (wider early). No EPA, transfer, QB, or coaching feed is wired. Pinnacle remains the market layer. A projected winner is not a bet.

**Strategy FBIS-HC-v1** — Qualified tickets with EV ≥ 8% (CONVICTION). The 2026-08-26 seed is the operator-corrected 7 CONVICTION tickets (`data/cohorts/fbis-hc-v1.json`, D1 `strategy_tickets` role=seed). Reported record 7-0. Reconstruction is operator-declared until journal EV/timestamps are imported (recovered N is separate from the graded 7-0 record). The seed sample was MLB-heavy overs — that is an observation, not a gate. Champion weights, logistic k, and qualification gates stay frozen. Prospective matches still use the CONVICTION / EV ≥ 8% conjunction and are graded separately from forecast MAE/Brier.

## Data

- MLB Stats API — schedule, scores, probable pitchers, F5 linescore (free)
- ParlayAPI — Pinnacle game lines (3 credits, `eu` region), cached 15 minutes. Kalshi sentiment is a 1-credit pull; empty Kalshi/F5 responses cache for 6 hours.
- Ballpark Pal — optional; set `BALLPARK_PAL_API_KEY` when you have it (15k requests/month)

The operator ticket journal still lives in the browser (`fbis-learning-v1`). POST `/api/strategy` is secret-protected (`x-harvest-secret` or `STRATEGY_IMPORT_SECRET`) and does not accept arbitrary CORS. The FBIS-HC-v1 seed names are the seven operator-declared 2026-08-26 positions; they are not a recovered journal. Frozen projections live in Function cache (~21 days). Cloudflare D1 (`schema.sql` plus `migrations/`) is the authoritative research ledger.

## Tests

```bash
npm test
```

## Local

```bash
npm install
npm run dev
```

Opens on port **5175**. Copy `.env.example` to `.env`.

## Deploy (free Cloudflare Pages)

```bash
npx wrangler pages secret put PARLAY_API_KEY --project-name fbis
npx wrangler pages secret put BALLPARK_PAL_API_KEY --project-name fbis
npm run deploy
```

Needs Wrangler logged in (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` in the environment.
