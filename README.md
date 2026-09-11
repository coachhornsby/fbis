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
- **CFB** — Independent score model. Authorized prior is CollegeFootballData SP+/FPI/SRS/Elo for all FBS (`cfb-prior-v2-cfbd`) when `CFBD_API_KEY` is bound. Feature stack includes CFBD EPA proxies, transfer deltas, coaching continuity, returning production, ESPN QB-room continuity, and transfer-QB prior production signals (when CFBD player history is available). Fallback is ESPN FPI + opponent-adjusted 2025 SRS. HFA 2.5 (0 on confirmed neutral). Pinnacle remains the market layer only. League-average-only games cannot qualify.
- **NBA / NFL / CBB** — Pinnacle total/spread split into implied team scores until an independent sim is wired. CBB shadow challengers (CBB-CBBD-RATINGS-v1 and related) use CollegeBasketballData AdjOE×opp AdjDE / national × possessions and cannot qualify. KenPom is not required. Win-prob blends no-vig Pinnacle, ESPN, score (line-implied margin), and W-L form.

Hover a Proj cell for the recipe. SYS explains every board.

## Tracking (SYS)

The website is not the collector. Board routes (`/api/slate`, `/api/today`, `/api/ticker`, `/api/bets`) are read-only and do not trigger freeze/harvest writes. GitHub Actions call `/api/collect` through the day (full Parlay odds at ~8am and 11am CT; cache-only later) so every scheduled game gets pregame checkpoints even if nobody opens the board. `/api/harvest` (~06:20 CT) attaches finals and writes them to D1. The workflow runs one job per sport (MLB/NBA/NFL/CFB/CBB) with football split by `?dayOffset=` so a large CFB slate cannot exhaust the Cloudflare subrequest budget and starve other boards. A 207/partial or 500/failed collect does not stamp `last_collect_success_at`. UTC crons are fixed; Chicago offset is CDT (UTC-5, ~Mar–Nov) or CST (UTC-6, ~Nov–Mar). Scheduled verification requires an actual GitHub `schedule` run, not only `workflow_dispatch`.

`/api/health` is a read-only operational endpoint (no upstream calls, no writes) that reports deployment commit SHA, D1 binding, and scheduled collect/harvest health.

SYS reads D1 (cache is a 21-day fallback). For heavy windows (season/lifetime totals and all-board summaries), SYS can use pre-aggregated `daily_metrics` rows so the page does not need to scan the full snapshot ledger. Projection Accuracy reports actual vs projected totals, % bias, home/away bias, MAE, median abs, RMSE, within-X distribution, Pal vs proprietary vs ensemble vs Pinnacle, team/park/starter/month slices, and both score-winner and ensemble-probability winner hit. Calibration includes home p below 50%. Logged tickets stay a separate dataset from every-game forecast error.

Checkpoints: FIRST_AVAILABLE · EARLY · MORNING · LINEUP_CONFIRMED · PREGAME · CLOSE. FIRST_AVAILABLE is the first freeze; older EARLY rows still count as the first-available alias.

**CLV** is entry no-vig vs close (last pregame) no-vig for the side you bet — not model fair vs market.

Model version: **FBIS-v1.4** (platform) / **CFB-FBIS-v2** (CFB production projection)

**CFB-FBIS-v2 (production projection)** — Fitted M\*=A / T\*=A ridge on provenance-repaired 2022–2025 design rows. Coherent scores: `home = (total + margin) / 2`, `away = (total - margin) / 2`. Runtime loads fold3 A coefficients from `data/models/cfb-fbis-v2-fitted-aa.js` (betas verbatim from `fitted-coefficients-final.json`). **`canQualify = false`**. **Wager authorization disabled**. Closing lines remain evaluation-only and are never model features.

**CFB prior layer** — Team-specific prior is CollegeFootballData SP+/FPI/SRS/Elo covering all FBS when `CFBD_API_KEY` is bound. Feature feeds include CFBD EPA proxies, transfer portal deltas, coaching continuity, returning production, and ESPN QB continuity. Missing feature feeds fail soft and are flagged as absent. League-average-only cannot qualify, show LOG, or create a strategy ticket.

**Strategy FBIS-HC-v1** — Qualified tickets with EV ≥ 8% (CONVICTION). Production seed identity and graded tickets live in Cloudflare D1 (`strategy_tickets` role=seed). The repo ships **synthetic** cohort fixtures under `data/cohorts/` for offline tests only — not real operator slips. Reconstruction is operator-declared until journal EV/timestamps are imported. Champion weights, logistic k, and qualification gates stay frozen. Prospective matches still use the CONVICTION / EV ≥ 8% conjunction and are graded separately from forecast MAE/Brier.

**CFB HFA** — Production champion remains 2.5 points at a true home venue and 0 at a confirmed neutral site. Team-specific score-based and market-residual HFA live as **shadow challengers** only. Blue Chip Analytics 2026 raw/smooth values are stored as dated third-party research and are never production recommendations. FBIS does not reproduce Blue Chip smoothing and does not invent Action Network ratings. Missing historical closes keep the market-residual challenger unavailable.

## Data

- MLB Stats API — schedule, scores, probable pitchers, F5 linescore (free)
- Odds provider pool (router) — Parlay → TheOdds API → SharpAPI → TheRundown → fail closed / no market data. Backups are queried only when a preferred provider is unavailable, exhausted, rate-limited, stale, or incomplete. Fresh complete primary data does not burn backup quota. Absence of any one provider is a safe degrade; absence of all valid market data fails closed. Soft SharpAPI/TheRundown quotes never populate `pin*`; wager qualification never fabricates market data.
- ParlayAPI — preferred primary for Pinnacle game lines (3 credits, `eu` region), cached 15 minutes. Kalshi sentiment is a 1-credit pull; empty Kalshi/F5 responses cache for 6 hours.
- The Odds API — intentional production fallback (`THEODDS_API_KEY`) for Pinnacle h2h/spreads/totals when Parlay is unavailable/exhausted.
- SharpAPI — intentional production fallback (`SHARPAPI_API_KEY`, newly rotated keys only). Soft DraftKings/FanDuel full-game lines for market coverage / display; never `pin*`.
- The Rundown — intentional production fallback (`THERUNDOWN_API_KEY`, newly rotated keys only). Soft DraftKings/FanDuel/BetMGM full-game lines for market coverage / display; never `pin*`.
- Open-Meteo weather — free venue forecast attached on every slate. Outdoor / non-closed-roof MLB, NFL, and CFB projections apply weather impact; indoor/dome/closed roofs skip it. NFL soft-odds stubs use a home-stadium catalog; CFB CFBD boards geocode from venue name or `(City, ST)` labels.
- Ballpark Pal — optional; set `BALLPARK_PAL_API_KEY` when you have it (15k requests/month)
- CollegeFootballData — CFB ratings (SP+/FPI/SRS/Elo) and college research jobs. Set `CFBD_API_KEY` as a Pages secret (never commit the value). Optional alias `CBBD_API_KEY` for the same bearer. See `docs/college-research.md`.

The operator ticket journal still lives in the browser (`fbis-learning-v1`). POST `/api/strategy` is secret-protected (`x-harvest-secret` or `STRATEGY_IMPORT_SECRET`) and does not accept arbitrary CORS. Heritage bet-slip Confirm from the operator board is same-origin and does not paste **HARVEST_SECRET**. Collect/harvest still use that Pages secret. Parse/preview does not write. Changing the paste after preview requires parse again before write. Imported slips are executed bets, separate from the FBIS-HC-v1 seed cohort in D1. Frozen projections live in Function cache (~21 days). Cloudflare D1 (`schema.sql` plus `migrations/`) is the authoritative research ledger.

See `SECURITY.md` for secret-handling rules.

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
npx wrangler pages secret put CFBD_API_KEY --project-name fbis
npm run deploy
```

Needs Wrangler logged in (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` in the environment.
