# Lyrid Tennis — Handoff & Maintenance

Everything needed to deploy, run, and maintain the Tennis addition **without the original chat session**. If you (or another dev, or a fresh AI session) need to finish or fix it, start here.

## What it does
Tennis tab in the SPA. Pulls the upcoming slate, and for any matchup projects both players' performance — win prob, holds, aces, double faults, total games, **total games won (per player)**, and **fantasy score** — congregating surface, recent form, fatigue, surface transition, and head-to-head. You type the PrizePicks line for any market and it returns the over/under likelihood.

Everything is **priors** (`bet:false`) until validated against real logged lines. That's by design — no fake tiers.

## Architecture (three data sources, on purpose)
- **Index** (`tennis/tennis_serve_index.json`) — deep serve/return baselines per player by surface, built from historical match data (Sackmann schema). Slow-moving; rebuild periodically.
- **Live augment** (`tennisLiveAugment.mjs`) — refreshes only the recency-sensitive bits (form/fatigue) at read time so reads stay current between index rebuilds. Adapter not yet wired to a source (see TODO).
- **OddsPapi** — the upcoming **schedule** (`api/tennis/schedule.mjs`). Fixture-first: tournaments → fixtures. Board needs only fixtures (players+time); you type lines, so no odds pull needed for the board.

## File map (all under repo root)
- `index.html` — SPA with the Tennis tab already integrated (nav button, `#tennis-panel`, controller).
- `api/tennis/analyze.mjs` — serves a match read from the index. Query: `a`, `b`, `surface`, `bestOf`, `rankA/B`, `h2hEdge`, and line params `acesA/B, dfA, totalGames, fantasyA/B, gamesWonA/B`.
- `api/tennis/schedule.mjs` — upcoming slate from OddsPapi (needs `ODDSPAPI_KEY`).
- `tennis/tennisFeed.js` — parse Sackmann CSVs + melt to player rows.
- `tennis/tennisFeatureBuilder.js` — build the index (per-player surface profiles + recent form). CLI: `node tennis/tennisFeatureBuilder.js ./data/tennis ./tennis/tennis_serve_index.json`.
- `tennis/tennisProjector.js` — Monte-Carlo match model → all projections + fantasy (confirmed PrizePicks scoring: match +10, game ±1, set ±3, ace +0.5, DF −0.5).
- `tennis/tennisMatchRead.js` — assembles the read (congregates circumstances, grades lines).
- `tennis/tennisClassify.js` — tier/gate logic (mirrors wnbaClassify; UNGRADED until real lines).
- `tennis/tennisLiveAugment.mjs` — live form/fatigue refresh.
- `tennis/tennisColdStart.mjs` — builds a player profile on demand from the live source when they're NOT in the index (ITF, Challenger, new pros). This is how off-index players get reads.
- `tennis/tennisApiTennis.mjs` — api-tennis.com live source (drop-in alt to Matchstat).
- `tennis/tennisMatchstat.mjs` — live-stats source (Matchstat RapidAPI); resolves names->ids, pulls recent matches with serve stats. Wired into analyze.mjs.
- `tennis/oddspapiClient.mjs` — OddsPapi client (fixture-first; see note below).
- `tennis/tennisTotalGamesScan.js` + `tennis/oddspapiRunner.mjs` — real-line total-games edge scan (you run with your key).
- `tennis/tennisBacktest.js` — naive-baseline edge exploration on history.
- `build_tennis_index.sh` — rebuild the index (multi-mirror, self-healing).

## Deploy (what's on `main` vs what to push)
Already on `main`: the `tennis/` folder, `api/tennis/*`, and an `index.html` with the tab.
Push these updated files (drag into GitHub `upload/main`, or `git add`):
- `index.html` (adds games-won + fantasy line inputs)
- `api/tennis/schedule.mjs` (rewritten for OddsPapi)
- `api/tennis/analyze.mjs`, `tennis/tennisMatchRead.js` (games-won grading)
- `tennis/tennis_serve_index.json` (the built index — required for reads)

Then in **Vercel → project → Settings → Environment Variables** add:
- `ODDSPAPI_KEY` = your OddsPapi key (for the schedule board)
- `MATCHSTAT_KEY` = your RapidAPI key for "Tennis API - ATP WTA ITF" (for live current-form reads; optional — reads fall back to the index if unset)

Vercel redeploys on push. Tab works once the index is committed and the key is set.

## How to use
Open Tennis tab → board lists upcoming matches → tap one → it shows projections. Type the PrizePicks line(s) in the inputs (total games, games won per player, fantasy per player, aces, DF) → tap **Apply lines** → each shows over/under % vs the projection.

## Maintenance
**Rebuild the index** (do this weekly-ish so form stays current):
```
bash build_tennis_index.sh
```
It tries multiple data mirrors, rebuilds, commits, pushes. If it prints "ALL MIRRORS FAILED", find any `tennis_atp` fork on GitHub with `atp_matches_YYYY.csv` files (search github for `atp_matches_2024.csv`), add `owner/repo/branch` to `ATP_MIRRORS` at the top of the script, rerun.

**Auto-refresh (future-proof, optional):** add a `vercel.json` cron that hits a rebuild endpoint on a schedule, OR run `build_tennis_index.sh` from a local cron / GitHub Action weekly. The multi-mirror fallback means it keeps working when a single source dies.

## Measured tier baselines (real completed Bo3, 2023-24) — use these, not intuition
| Tier | mean games | 3-set % | tiebreak % |
|---|---|---|---|
| ITF Futures | 21.35 | 29.0% | 23.5% |
| Challenger | 22.57 | 34.3% | 30.5% |
| ATP Tour | 23.49 | 36.0% | 38.5% |

**ITF runs SHORTER than tour** — fewest 3-setters, fewest tiebreaks. Big early-round skill gaps produce blowouts; tightly-matched tour fields are what create long matches. The common assumption that lower-tier matches grind to 3 sets/tiebreaks is backwards, and betting ITF OVERs on that theory fades a real UNDER lean. Note this makes the calibration bug WORSE at ITF (model ~25 vs ITF reality 21.35).

## ITF Futures — why they're NOT in the index
Sackmann's `atp_matches_futures_YYYY.csv` files exist (18,423 rows in 2024) but contain **zero serve statistics** — the stat columns are empty, because ITF Futures events don't record match stats. They cannot feed the index (no aces/svpt/SvGms to build a profile from). Challengers ARE in (`atp_matches_qual_chall_YYYY.csv`, 100% stat coverage, 2020-2025) — that's what took the index from 1,605 to 3,408 players. True ITF players are handled by cold start (below).

## ITF / new players (cold start)
Players outside the historical index (ITF, Challenger, first-year pros) are read via `tennisColdStart.mjs`: analyze.mjs misses the index, then builds their profile from the live source's recent matches. Requires a live key. Board marks these "live profile"; deep-history (indexed) matches sort first. Cold-start reads carry a smaller sample, so the thin-sample gate fires — that's intended.

## ✅ TOTAL-GAMES CALIBRATION — FIXED (was biased +2 games)
**Was:** ~52-55% three-setters and ~25.4 mean total games vs ATP reality 36% / 23.49 → every read leaned OVER. **Now:** ~23.3 mean games, three-set rate on target. Two fixes, both from the research plan:

**1. Elo anchor (`tennisElo.js` + `tennisAnchor.js`).** Raw serve/return rates are level-biased AND gauge-degenerate: `p = spw_server + (TOUR_RET − ret_returner)` is invariant to adding a constant to every spw and every ret, so a closed same-tier pool cannot be separated from tour players using point aggregates. Elo escapes this because it's built from the MATCH GRAPH — qualifiers and tier-hopping players connect Challenger to tour, propagating the real level gap. Kovalchik (2016) found Elo beat every point-based model (~70% acc). Implementation: surface-specific Elo (FiveThirtyEight dynamic K = 250/(n+5)^0.4, surface shrunk toward overall by match count), then hold the serve SUM from point data (drives match LENGTH, robust) and bisect the DIFFERENCE until implied match win prob equals Elo win prob (no analytic inverse). Validation: Sinner 2395 / Djokovic 2228 / Dimitrov 2026 / Svrcina 1804 / Kouame 1368 — real tier separation. Dimitrov v Svrcina went 62% → 77% (reality ~80%).

**2. Set-to-set momentum (`MOMENTUM` in tennisProjector.js).** Independent-set simulation structurally over-produces third sets. Measured sweep on our data: momentum 0 → **43.5%** three-set (matches Sackmann's published ~44% independent-set error exactly), 0.016 → ~36.8%, 0.023 → 31.9%. Set winner's serve gets a small additive bump for the next set. **Calibrated to 0.020/0.012** — note Pinnacle's public +2.3% figure was TOO STRONG on our data, exactly as the literature warned (treat published magnitudes as starting values).

**Current state:** mean games 23.27 vs target 23.49 (~0.2 low, was 2 games high). Three-set rate on target. Reads no longer lean systematically OVER.

**Remaining calibration work:** (a) mean games is ~0.2 low — momentum could go to ~0.019, but the test pool (random top-100 pairs) is not the real ATP match distribution, so don't over-tune to it; rebuild the benchmark on an actual match-schedule sample. (b) The ">=24 games" three-set proxy over-counts (7-6 7-6 = 26 games in straight sets) — measure true set counts if you tune further. (c) Everything is still `bet:false` priors: calibration ≠ edge. Beating the closing line is a separate, unproven question.

## Opponent adjustment (still imperfect, now largely bypassed)
The iterated opponent adjustment in `tennisFeatureBuilder.js` (damped 0.5, shrunk K=600) still leaves lower-tier players' return rates inflated (Svrcina ret≈0.446). It no longer matters much because the Elo anchor overrides the rate DIFFERENCE — but the rate SUM still flows through, so improving this would sharpen match length. The principled fix per the research: Ingram's Bayesian hierarchical model (fixed global intercept + zero-mean shrunk serve/return skills, fit in Stan) or a logistic mixed-effects model with crossed server/returner random intercepts.
## Opponent adjustment (why lower-tier stats needed fixing)
Raw rates are level-biased: a Challenger player returns against weak servers, so his return% reads elite (Svrcina 0.447 vs Dimitrov 0.373 — nonsense). `tennisFeatureBuilder.js` now runs an iterated (4-pass) opponent adjustment: each player's serve/return rates are re-estimated with the opponent's own strength stripped out, converging against already-adjusted peers. This is what makes Challenger + tour data mixable in one index.

## Data source status (verified 2026-07)
**JeffSackmann/tennis_atp and tennis_wta are REMOVED from GitHub.** Verified: the live profile github.com/jeffsackmann states "JeffSackmann has one repository available" and lists only tennis_MatchChartingProject. Raw + HTML URLs 404 from multiple independent networks. Search engines still surface cached snapshots of the old repos (all dated "Updated Dec 30, 2024") — those are stale; do not trust them. Only tennis_MatchChartingProject survives (issues filed as recently as Apr 2026).

Working sources actually in use:
- ATP tour + Challenger: `AlexandraMoldovan03/ATP-Tennis-Match-Outcome-Prediction-Using-PySpark-and-Machine-Learning/main` (2010-2025 tour, 2020-2025 qual_chall) — Sackmann schema, verified.
- ATP fallback: `michaelbruen/ATP_Tennis_Project/main` (2023-2025).
- WTA: `EdwardM1276/Tennis-Performance-Indicator/main` (2024 only — WTA is THIN).
- Worth evaluating: `Tennismylife/TML-Database` — live-updated ATP DB, explicitly extends Sackmann's schema with missing data filled in. Best candidate to replace the mirrors.
`build_tennis_index.sh` tries mirrors in order; when one dies, add a new `owner/repo/branch` to ATP_MIRRORS.

## Schedule sources (dual, auto-failover)
`api/tennis/schedule.mjs` tries in order: **api-tennis.com** (`APITENNIS_KEY`, date-range get_fixtures, generous quota — preferred) then **OddsPapi** (`ODDSPAPI_KEY`, 250 req/month free tier). If both fail it returns a note naming each source's error. Lower-tier (ITF/UTR) events are RANKED below tour events but no longer dropped — dropping them emptied the board entirely during off-weeks, since ITF is often the only tennis running.

## PrizePicks lines (auto-fill) + the forward line log
**`api/tennis/prizepicks.mjs`** pulls live tennis props from `partner-api.prizepicks.com/projections` (JSON:API — join `data` to `included` by id). Verified live: 241 tennis projections, stat types Total Games / Total Games Won / Fantasy Score / Aces / Double Faults / Break Points Won / Total Sets / Total Tie Breaks. **Critical detail:** PrizePicks serves alternates alongside the real line — `odds_type` is `standard` | `demon` | `goblin`. Only `standard` auto-fills; alternates are stashed under `alternates` for line shopping. The board auto-fills lines on first open and shows "Lines auto-filled from PrizePicks"; edit any field and re-apply to override. Fails soft — if PrizePicks changes shape you type lines as before. NOTE: this API is undocumented; it can change without notice, and check their ToS before commercial reliance.

**`tennis/tennisLineLog.mjs`** is the thing that ends `bet:false`. History can't grade us (Sackmann has outcomes, no historical PP lines), so we log forward: `snapshot()` records each slate's standard lines + our model prob/projection; `grade()` fills in results and reports hit rate + Wilson lower bound per market. A market earns a graded tier only when n>=30 AND Wilson LB > 52.4%. Storage is pluggable: `makeFileStore()` (JSONL, for local/cron) or `makeSupabaseStore({url,key})` for serverless — table DDL is in the file header. Run `node tennis/tennisLineLog.mjs snapshot` daily (cron) and `... grade` once results land.

**The path to graded tiers:** snapshot daily for a few weeks -> grade -> any market clearing Wilson LB 52.4% on n>=30 gets promoted in `tennisClassify.js`. Until then everything stays a prior. Calibration (which we fixed) is NOT edge; only the log can prove edge.

## Troubleshooting (the exact things that bit us)
- **Board empty / "schedule unavailable"** → `ODDSPAPI_KEY` not set in Vercel, or off-hours (no fixtures in the 36h window). Set the key; check during active tournament hours.
- **Reads say "index not found"** → `tennis/tennis_serve_index.json` isn't committed. Run the build script, push.
- **Downloads get 0 files** → the data mirror died. Add a new one to `ATP_MIRRORS` (Sackmann's own `JeffSackmann/tennis_atp` was removed from GitHub — do not use it).
- **"thin sample" on a player** → they're not in the index (WTA is only 2024; ITF/Challenger players often absent). Widen the index data or accept ATP-strong coverage.
- **Terminal pastes mangle** (zsh eats multi-line/`#`) → put commands in a script file and `bash file.sh`, or paste single-line commands only.
- **OddsPapi total-games SCAN** (`oddspapiRunner.mjs`) → OddsPapi is fixture-first and odds only populate on live/imminent fixtures; the odds-parsing in `oddspapiClient.mjs` (`normalizeTotals`) still needs the real market shape confirmed on a fixture that has `hasOdds:true` during play. The schedule board does NOT depend on this.
- **API keys** → never commit or paste them; keep in the shell (`export ODDSPAPI_KEY=…`) or Vercel env. Rotate if exposed.

## What's done vs TODO
Done: index build, projections + fantasy (confirmed scoring), congregation (form/fatigue/surface/H2H), games-won + fantasy line grading, OddsPapi schedule board, live-augment logic, multi-mirror self-healing builder.
TODO: (1) DONE — live form is wired via Matchstat (`tennisMatchstat.mjs` + `augmentMatchup` in `analyze.mjs`); set `MATCHSTAT_KEY`. If reads don't refresh (aces come back null), the per-match `stat` field names differ from the docs — run `node -e` importing `makeMatchstatSource(...).probe("Jannik Sinner")`, paste the sample, and adjust `mapStat()`. (2) confirm OddsPapi's total-games market shape for the edge scan; (3) widen WTA data (only 2024 now); (4) once you've logged real lines for a few weeks, promote graded tiers in `tennisClassify.js`.
