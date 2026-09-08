# FBIS Repository Audit

**Status labels used throughout:** Confirmed (in code) · Inferred · Recommended  
**Production truth:** current code over README/docs when they conflict.  
**Scope:** Read-only technical, quantitative-modeling, product, and commercialization audit of the Fastwater Betting Intelligence System (FBIS) repository. No code was edited for this audit.

---

## 1. EXECUTIVE VERDICT

**FBIS is closest to a personal operator research console with a strong freeze/harvest ledger — not a subscription-ready projection product.**

It has real institutional instincts (Pinnacle as benchmark, Heritage as execution, frozen snapshots, shadow models that cannot qualify, fail-closed conviction gates, sport-split collect). But production score independence only exists for **MLB** and **CFB**. **CBB production scores are market-implied and can still qualify.** **NFL has no independent model** (qualification correctly blocked). Model Lab / champion–challenger promotion criteria exist as declarations, not as a closed evidence loop that can justify paid projections.

| Dimension | Score (0–100) | One-line reason |
|---|---|---|
| **CBB model** | **28** | Production champion is `PINNACLE_IMPLIED`; independent CBBD identity is shadow-only |
| **CFB model** | **58** | Real independent score path + fail-closed priors; prior is live CFBD power, heuristics, market-shrunk tickets |
| **NFL model** | **12** | Honest non-model; blocked from qualify; zero EPA/professional football stack |
| **MLB model** | **62** | Savant×SP + Pal separation is real; overly simple; park/bullpen/lineup gaps |
| **Data integrity** | **55** | Strong identity fail-closed in places; DQ flags don't gate qualify; F5 soft-book fallback |
| **Model validation** | **42** | Freeze + accuracy/SYS exist; promotion not wired to OOS evidence; fixture ridge artifacts |
| **Market/pricing integrity** | **68** | Pin EV, no-vig, CLV definitions are careful; market still inside win-prob + shrink |
| **Deployment reliability** | **72** | CI deploy + SHA verify is serious; harvest soft-continues on SHA unavailability; auth gaps |
| **Frontend usability** | **60** | Operator-dense, honest glossaries; not subscriber-legible; misleading readiness DEGRADED |
| **Subscription readiness** | **22** | No auth/tenancy; SYS/BETS/strategy world-readable; projection product not yet defensible |

**Bottom line:** Do not sell this as a paid projection service yet. The next value is proving whether independent models beat market baselines under frozen, temporal OOS rules — especially by **stopping CBB from qualifying on circular scores** and **instrumenting model proof**, not by rewriting CFB/MLB champions.

---

## 2. CURRENT ARCHITECTURE MAP

```
Schedule sources                Odds / market                 Sport models
─────────────────               ─────────────                 ────────────
ESPN scoreboards                Parlay → Pinnacle (sharp)     MLB: Savant projectMatchup
  (CBB/CFB/NFL/NBA)             Heritage (execution display)  MLB: Ballpark Pal overlay
MLB Stats API                   Kalshi (sentiment only)       CFB: applyCfbModel / projectCfbMatchup
                                TheOdds failover (optional)   CBB/NFL/NBA: mapEvent → PINNACLE_IMPLIED
                                                              CFB/CBB shadows: collegeApply

        │                              │                              │
        └──────────────┬───────────────┴──────────────┬───────────────┘
                       ▼                              ▼
              buildSlate (slateEngine.js)
                       │
                       ├─ projectGame → blendWinProb (weights: market 0.22 …)
                       ├─ recommendBundle → QUALIFIED / LEAN / blocked
                       └─ dataQuality (flags only; does not block qualify)
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
 READ boards                     WRITE research (secret)
 /api/slate, /api/today          /api/collect → freezeSlate → odds_snapshots
 /api/ticker, /api/bets GET        → persistMatchingRec (strategy tickets)
 /api/track GET, /api/strategy GET /api/harvest → finals → grade → daily_metrics
 /api/health                     /api/college → CFBD/CBBD shadow jobs
                                 /api/model-lab → research report
                       │
                       ▼
              D1 (schema.sql + migrations/)
              prediction_snapshots (immutable INSERT OR IGNORE)
              strategy_tickets / executed_bets / model_* college tables
                       │
                       ▼
              Frontend: TODAY · BOARD · SYS · BETS
              Local: fbis-learning-v1 (browser journal ≠ D1)
```

**Confirmed pipeline facts**

| Stage | Entry | Key functions / files |
|---|---|---|
| Data in | ESPN / MLB Stats / Parlay / Savant / Pal / CFBD | `buildSlate`, `fetchEspnScoreboard`, `fetchMlbStats`, `mergeParlay`, `fetchSavantSlate`, `fetchBallparkPal`, `loadCfbPrior` |
| Models run | Inside `buildSlate` enrich | `applyCfbModel`, `projectMatchup`, `attachCbbChallengers` / `attachCfbChallengers` |
| Freeze | GitHub Actions → `/api/collect` only (prod boards do not freeze) | `collectBoards` → `freezeSlate` / `freezeFromGame` in `projLedger.js` |
| Market compare | Live board + freeze time | `pinMarkets`, `priceSelection`, `recommendBundle` |
| Recs created (durable) | Freeze path | `persistMatchingRec` + `evaluateConvictionGates` |
| Grade | `/api/harvest` | `applyFinal`, `gradeStrategyAgainstFinals`, CLV via `closeCapture.js` |
| Display | SPA | `TodayView`, `App` board, `TrackView`, `MyBetsView` |

**Confirmed conflict:** README says model **FBIS-v1.3**; `weights.js` exports **`MODEL_VERSION = "FBIS-v1.4"`**; college stamps still say **FBIS-v1.3**. Reconstruction equality will treat these as different models.

---

## 3. MODEL AUDIT BY SPORT

### CBB — production is not a model

| Topic | Finding |
|---|---|
| **Inputs (confirmed)** | ESPN men’s CBB schedule/records/ranks; Parlay/Pinnacle lines; optional CBBD `/ratings/adjusted` for shadows |
| **Production formula (confirmed)** | `mapEvent`: `projHome = total/2 − spread/2` → `projectionKind = "PINNACLE_IMPLIED"`. If only spread: base-72 ± spread/2. Then `projectGame` logistic margin + market/espn/form blend |
| **Shadow formula (confirmed)** | `cbbRatings.js`: `eff = AdjOE × opp AdjDE / 104.5`; `pts = eff × poss / 100 ± HCA/2` (HCA 3.5). Registry IDs in `collegeModels.js` (`CBB-CBBD-RATINGS-v1`, matchup, REG, ensemble). All `canQualify: false` |
| **Strengths** | Shadow identity math is correct (old tempo×OE rejected). KenPom not required. Fail-closed shadows |
| **Weaknesses** | **Production “projection” is the market.** `recommendBundle` blocks NFL `PINNACLE_IMPLIED` but **does not block CBB**. Fixture ridge `data/models/cbb-reg-v1.js` (`trainingHash: "fixture-ridge-v1"`) |
| **Missing vs expected** | No production chain: efficiency → possession → matchup deltas → team HCA → shrinkage → market compare. No perimeter/rim/midrange/FT/TO/ORB ablation. Torvik/KenPom stubs only |
| **Leakage** | Market scores as “model” → circular edge vs Pinnacle (**confirmed**) |
| **Stale** | CBBD catalog cache; no CBBD key → empty challengers, board still shows implied scores |
| **Calibration** | Logistic of market margin + market blend — not an independent calibration story |
| **Market dependence** | Production: total. Shadows: independent ratings; `CBB-MARKET-SHRUNK` / `CBB-PINNACLE-IMPLIED` correctly labeled market-informed |
| **Failure modes** | Incomplete lines → base-72; still can produce tickets if EV clears |
| **Untouched** | Shadow identity formula; fail-closed `canQualify: false` |
| **Challengers** | Promote candidate: `CBB-CBBD-RATINGS-v1` only after OOS vs market baseline |
| **Retire / gate** | Qualifying on `PINNACLE_IMPLIED` as production champion |

### CFB — best college engine; not yet CBB-benchmark rigor

| Topic | Finding |
|---|---|
| **Inputs (confirmed)** | CFBD SP+/FPI/SRS/talent/returning; CFBD PPA/portal/coaches; ESPN scoreboard/QB; D1 `team_form`; optional CFBD lines fill; Parlay market layer |
| **Formula (confirmed)** | `estimateTeam` + `blendSeason` (`w=n/(n+6)`) → feature adj (`buildCfbFeatureVector`) → clamp → `projectCfbMatchup` opponent-residual scores → Normal σ (`cfbSigma`) → `classifyCfbState` / `cfbBettingAllowed` → `applyCfbModel` |
| **Strengths** | Opponent-residual (not naïve PPG average). League-average / FCS / provisional fail closed. Feature missingness fail-soft (not zero-filled). Shadow HFA / REG / ensemble separated. Diagnostics for duplicate scores |
| **Weaknesses** | `loadCfbPrior` fetches **current-season** CFBD ratings (`cfbd.js`), then blends form + EPA — double-count risk (**inferred** from structure). Hand-tuned scales. σ heuristic. Ridge artifact is fixture. Header claims “preseason prior”; runtime is live power |
| **Missing** | Injuries, weather, travel, rest (**confirmed absent**). Rush/pass/explosiveness/havoc/trenches/finishing drives as distinct layers. Frozen preseason cut date. Elo path empty (`elo: []`) |
| **Leakage** | In-season SP+/PPA include games to date with no per-kickoff cutoff (**confirmed design risk**) |
| **Stale** | Feature/prior caches; no CFBD key → 2025 ESPN prior fallback |
| **Calibration** | Unfitted Normal + 65% `shrinkToMarket` on tickets |
| **Market dependence** | Score mean independent; `pHomeFinal` blends market 0.22; spread/total tickets shrink to Pin |
| **Failure modes** | PRIOR_ONLY → lean only; LEAGUE_AVERAGE_ONLY nulls scores; missing key → stale prior |
| **Untouched** | `projectCfbMatchup` identity; champion HFA 2.5/0; bettingAllowed blocks |
| **Challengers** | Team HFA, Blue Chip research, REG/ensemble **after real train artifacts** |
| **Retire / fix** | Live-SP+-as-“preseason prior” semantics; fixture coeffs as “trained” |

### NFL — empty model, correct honesty

| Topic | Finding |
|---|---|
| **Inputs** | ESPN + Parlay only |
| **Logic (confirmed)** | `mapEvent` leaves `projHomeScore` null; `projectionKind = "PINNACLE_IMPLIED"`; `projectGame` forces null scores; `recommendBundle` hard-blocks unless `projectionKind === "FBIS"` |
| **Strengths** | Does not fake edge |
| **Weaknesses / missing** | No EPA/play, success rate, dropback/rush, early-down, NPR, explosiveness, pressure, OL/DL, QB value, ST, context |
| **Leakage / calibration** | N/A for scores |
| **Market dependence** | Market is the only projection |
| **Untouched** | Qualification hard-block |
| **Challenger** | Build dedicated NFL model as shadow first |
| **Retire** | Nothing — there is no fake champion |

### MLB — substantial; polish, don’t rebuild

| Topic | Finding |
|---|---|
| **Inputs (confirmed)** | MLB Stats schedule/SP/F5; Savant xERA/xWOBA + team RPG; Ballpark Pal sims/F5/park; Parlay |
| **Formula (confirmed)** | `projectMatchup`: `lg × (rpg/lg) × (oppSpEra/lgEra) × park × 1.04 home`, clamp 2.3–7.2. Pal never overwrites Savant. F5 via `pushF5Recs` |
| **Strengths** | Independent of 1.5 RL. Dual-model roles clear. Canonical matching (`mlbCanonical.js`). Run line exact pairing |
| **Weaknesses** | Park often 1 in Savant path; no bullpen/platoon/weather/umpire; TBD SP → league ERA; year = calendar year |
| **Missing vs expected** | Starter→bullpen→offense/platoon→park/weather→calibrated WP chain is only partially present (Pal fills some) |
| **Leakage** | Season-to-date stats (standard); unofficial lineups flagged not blocked |
| **Stale** | Savant 30m cache; Pal throttling |
| **Calibration** | Clamp truncates tails; win-prob blend weights Pal 0.30 + market 0.22 |
| **Market dependence** | Scores independent; tickets/CLV/EV market-priced; F5 may fall back to soft books |
| **Untouched** | Savant identity, Pal separation, 1.5/0.5 RL rules |
| **Challengers** | Park-aware Savant, bullpen layer, calibrated σ |
| **Retire** | N/A |

---

## 4. MODEL LAB / RESEARCH INFRASTRUCTURE AUDIT

**What exists (confirmed)**

- Frozen `prediction_snapshots` with `INSERT OR IGNORE` + conflict detection (`projLedger.js`)
- College tables: `model_registry`, `model_artifacts`, `model_predictions`, `model_validation_runs`, `model_promotion_decisions` (`migrations/0009`)
- Shadow registry + `PROMOTION_CRITERIA` (`collegeModels.js`: minOosN 400, seasons, MAE, bias, no leakage, operator approval)
- `evaluatePromotion` + `model-promote` job writes a decision row (`collegeJobs.js`) — **does not flip production champion**
- `modelLab.js`: `evaluateModelRows`, `pairedModelComparison`, excludes market-informed by default in tests
- HFA promotion criteria separate (`hfa.js`); never auto
- Accuracy / calibration / CLV on SYS (`accuracyReport.js`, `TrackView.jsx`)
- Offline train stub: `scripts/college-train.mjs` (Actions CPU)

**What is missing before trusting promotion**

| Gap | Severity |
|---|---|
| No automatic wiring of lab metrics → `evaluatePromotion` inputs (opts are request-passed) | High |
| No rolling-origin temporal fold enforcement that blocks leakage in Worker path | High |
| Fixture ridge artifacts masquerade as trained models | High |
| Champion string drift (v1.3 vs v1.4) breaks clean cohort comparisons | High |
| Ablation support: feature groups not systematically ablated with stored fold IDs | Medium |
| Paired comparison exists but not a default gate on every promote attempt | Medium |
| Market-informed models correctly labeled but production CBB still uses market scores | Critical |
| No NFL/MLB entries in college-style registry with same promotion discipline | Medium |
| Reproducibility: trainingHash not verified against artifact content hash on promote | Medium |

**Verdict:** Research scaffolding is ~40% of a real champion/challenger lab. Criteria are written; the closed loop that makes promotion boring and safe is not.

---

## 5. BETTING / QUALIFICATION AUDIT

### How labels actually work (confirmed)

| Label | Meaning | Function |
|---|---|---|
| **QUALIFIED** | Complete Pin two-way + EV ≥ sport `minEv` (0.03) + caps | `isQualifiedTicket` / `recommendBundle` |
| **LEAN** | Signal that failed qualify or PRIOR_ONLY | `stampTicket(..., lean: true)` |
| **CONVICTION** | Tag when EV ≥ 0.08; also FBIS-HC-v1 filter | `tagFromEv`; `ticketMatchesStrategy` |
| **LOG** | UI operator action, not durable auto-state | `App.jsx` |
| **PASS / PASSED** | Strategy ticket D1 readback validation | `persistStrategyTicketWithReadback` |
| **Prop CONVICTION** | Separate MLB prop path (not HC-v1) | `buildPropConvictions` |

### Pricing (confirmed)

- Fair model p vs Pin no-vig (`pricing.js` multiplicative de-vig)
- Qualification EV recomputed at **Pinnacle** (`pushPriced` → `expectedRoi(fair, pinPrice)`)
- Heritage = execution / grading when present; never invents qualify price
- CLV = close no-vig − entry no-vig (`side-novig-v1`), not model vs market
- Conviction gate: canary, complete market, \|model−market\| ≤ 0.15, freeze-before-start, ROI match 1e-6 (`convictionGate.js`)

### Integrity flags

| Issue | Verdict |
|---|---|
| Market as model input | **Confirmed** — blend weight 0.22; CBB/NBA scores from lines; `shrinkToMarket(…, 0.65)` |
| Spread confused with odds | **Mostly mitigated** — `validAmericanOdds`, migration 0004 |
| Stale prices qualify | **Partial** — no max age on main-market qualify; props ≤90m but can use 36h stale props feed |
| One-sided markets | **Mitigated for FG Pin**; F5 soft-book fallback risk |
| Execution vs benchmark | **Mitigated by design** + regression tests |
| Model edge vs price value | **Tension confirmed** — edge often `probEdge`; qualify is ROI; shrink compresses disagreement |
| Recs without DQ | **Confirmed gap** — `dataQuality` stored, not required by `isQualifiedTicket` or conviction gates |

---

## 6. DATA INTEGRITY AUDIT

| Area | Assessment |
|---|---|
| **Team identity** | `marketLabels.js` / `teams.js` / `mlbCanonical.js` fail-closed on ambiguity — solid |
| **Date/time** | America/Chicago calendar; freeze skips past CT dates — solid |
| **Neutral site** | ESPN `neutralSite` / notes → HFA 0 — medium misclassification risk |
| **FBS/FCS / newly promoted** | Provisional / LEAGUE_AVERAGE_ONLY blocks — good; SRS prior-year FCS fallback exists |
| **Probable starters** | MLB SP from Stats; unofficial lineup flag only |
| **Injuries/personnel** | CFB absent; MLB Pal/lineups partial |
| **Null/zero-fill** | CFB features fail-soft (**confirmed**); probability contract rejects invalid p |
| **Source freshness** | Parlay 15m; empty Kalshi/F5 6h; props 36h stale path |
| **Duplicates** | Odds snapshots append-only (duplicates possible); strategy ticket IDs keyed |
| **Doubleheaders** | MLB game ids from Stats — watch edge cases |
| **Season transitions** | `cfbSeasonYear` / `cbbSeasonYear` heuristics |
| **Stale caches** | TODAY all-sports cache-only — good cost control, can hide freshness |
| **Fallbacks** | Pin→Heritage display; F5→soft books; CFB prior→ESPN 2025; CBB→market scores |
| **Silent zero-fill** | Not the CFB pattern; CBB base-72 from spread-only is a silent prior (**confirmed**) |

---

## 7. FRONTEND / PRODUCT AUDIT

**Could a subscriber understand the product today?** Only with operator coaching. TODAY/BOARD show Proj, Pin, Edge, EV, Quality flags, lean reasons. SYS has serious accuracy/calibration/CLV research UI. Gaps: uncertainty mostly CFB-only; Quality score unexplained; SportReadiness always shows `DEGRADED` when games exist (`App.jsx`); browser `fbis-learning-v1` vs D1 BETS/SYS dual ledger; no auth.

### Recommended surfaces

| Tier | Contents |
|---|---|
| **PRIVATE / SYS** | Deployment SHA, D1 health, collect/harvest proofs, anomalies, college quota, EV audit, Heritage import, manual finals, raw challenger diagnostics, operator journal |
| **PRO / SUBSCRIBER** | Frozen projections: score/spread/total/WP/fair ML/sharp line/delta/quality/uncertainty/drivers/completeness/PASS·QUALIFIED·CONVICTION status/freeze timestamp; historical MAE/Brier/CLV by sport & model version; clear “lean ≠ play” |
| **PUBLIC** | Marketing, methodology summary, delayed aggregate track record — not live EV boards |

**Do not build payments/Discord automation yet.** Projection independence and validation proof are not strong enough.

---

## 8. PERFORMANCE / COST AUDIT

| Pattern | Finding |
|---|---|
| Board poll 45s | Calls `/api/slate` **and** `/api/track?days=2` every cycle — confirmed cost amplifier |
| TODAY 60s | Cache-only Parlay/Pal for non-focused sports — good |
| Health 60s | Always on + workflow health — overlapping |
| Parlay | 15m cache; full odds only collect-full slots |
| CFBD | Isolated college workflow; 30k monthly cap / 8k design target (`quota.js`) |
| Pal | Optional; TODAY cache discipline |
| Bundle | `tesseract.js` lazy on Heritage OCR only — still heavy for operators |
| D1 | Storage budget warnings; anomalies opt-in on SYS |
| Collect | Sport matrix + CFB/NFL dayOffset 0–2 — good Worker budget hygiene |

**Opportunities:** Drop incidental board `/api/track`; coalesce health polls; keep OCR off subscriber path; avoid full-slate ticker rebuilds (`ticker.js`).

---

## 9. DEPLOYMENT / DEVOPS AUDIT

**Strengths (confirmed)**

- `ci.yml`: test → migrate → deploy → list-deployment SHA verify on `main`
- `deploy-pages.yml`: manual fallback (intentional duplicate)
- Harvest SHA verify with fail-closed on genuine mismatch
- Additive migrations + `verify:migrations`
- Sport-isolated collect/harvest; watchdog catch-up

**Weaknesses (confirmed)**

| Issue | Risk |
|---|---|
| SHA unavailable → collection continues (`collectionAllowedAfterVerify`) | Stale Worker may still write research |
| `authorizeHarvest` fails **open** if secret unset | Catastrophic if misconfigured |
| `/api/track` POST **no auth** (manual-final, audit-ev, recompute, reconstruct) | Public host write surface |
| Heritage Confirm same-origin to public Pages | Anyone visiting site can write executed bets |
| Runtime `CREATE TABLE IF NOT EXISTS ev_audit_records` in track.js | Bypasses migration discipline |
| Docs understate afternoon harvest (`20 11,16`) | Ops confusion |
| Vite local `/api/slate` still calls `freezeSlate` | Dev/prod behavior conflict |

**Deploy certainty:** Strong for “this SHA is on Pages Production” after CI verify. Weaker for “live code matches research writers under soft SHA paths” and “writes are operator-only.”

---

## 10. PRIORITIZED ROADMAP

### P0 — must fix before trusting production

| # | Files / functions | Problem | Change | Why | Complexity | Immediate prod behavior? | Needs OOS? |
|---|---|---|---|---|---|---|---|
| P0.1 | `slateEngine.js` `recommendBundle`, `mapEvent` | CBB (and NBA) can qualify on `PINNACLE_IMPLIED` | Hard-block qualify unless `projectionKind === "FBIS"` (mirror NFL) | Stops circular “edge” tickets | Low | **Yes** (fewer/no CBB quals) | No for gate; OOS later for challenger promote |
| P0.2 | `auth.js`, `functions/api/track.js` | Unauthenticated POST + harvest fail-open | Fail-closed harvest if secret missing; auth track POST | Protects D1 integrity | Low–Med | **Yes** | No |
| P0.3 | `weights.js`, `collegeApply.js`, `collegeModels.js`, README | v1.3 vs v1.4 drift | Align version strings; document cutover without rewriting historical rows | Reconstruction / cohort integrity | Low | Label-only if careful | No |
| P0.4 | `dataQuality` → `isQualifiedTicket` / `evaluateConvictionGates` | DQ flags don’t block | Require minimum DQ / block `pinnacle_implied_score` + unresolved market | Prevents low-integrity quals | Med | **Yes** | No |

### P1 — required before subscription launch

| # | Files | Problem | Change | Complexity | Immediate? | OOS? |
|---|---|---|---|---|---|---|
| P1.1 | Auth layer + API CORS | World-readable SYS/strategy/bets | Private/SYS vs subscriber split | High | Yes | No |
| P1.2 | `modelLab.js`, `collegeJobs.js` model-promote | Promotion not evidence-driven | Wire lab paired OOS → criteria → decision; still no auto role flip | Med | No (process) | Uses OOS |
| P1.3 | CBB: promote path for `CBB-CBBD-RATINGS-v1` | No independent production CBB | Shadow freeze + temporal OOS vs Pin baseline; operator promote only | High | No until promote | **Yes** |
| P1.4 | Subscriber-facing projection card | Operator-dense UI | One card: proj, market, delta, quality, uncertainty, status, freeze ts, hist MAE | Med | Display | No |
| P1.5 | F5 book fallback (`parlay.js`) | Soft books can complete F5 market | Pin-only for qualify; else lean | Med | **Yes** | No |
| P1.6 | Docs vs cron / Vite freeze | Operator confusion | Sync CLOUDFLARE_SETUP/README; remove local freeze or label clearly | Low | Dev/docs | No |

### P2 — important model/product improvement

| # | Area | Change | Complexity | OOS? |
|---|---|---|---|---|
| P2.1 | CFB prior | Freeze preseason cut; stop labeling live SP+ as preseason; reduce EPA double-count via ablation | High | **Yes** |
| P2.2 | CFB features | Rush/pass, explosiveness, havoc, trenches as feature groups with ablation | High | **Yes** |
| P2.3 | MLB polish | Park into Savant challenger; bullpen layer; lineup freshness gate | Med–High | **Yes** |
| P2.4 | NFL shadow v0 | EPA/success-rate opponent-adjusted power → shadow only | High | **Yes** |
| P2.5 | Replace fixture ridge artifacts | Real `college-train.mjs` artifacts with content hashes | Med | **Yes** |
| P2.6 | Cross-sport ranking | Calibrated edge × uncertainty × correlation × bankroll exposure (no sport quotas) | High | After calibration |

### P3 — optional / later

- Payments / Discord memberships
- KenPom/Torvik paid feeds (optional shadows)
- Autonomous anything (**do not**)
- Destructive migrations (**do not**)
- Blue Chip HFA as production (**challenger only**)

---

## 11. FIRST ENGINEERING SPRINT

**Goal:** Make it possible to *prove* whether each sport is good enough for a paid projection service — without boiling the ocean.

**3–6 tightly scoped changes:**

1. **Gate market-implied qualification (CBB/NBA)**  
   In `recommendBundle`, block when `projectionKind !== "FBIS"` (same as NFL). Keep scores visible as market context / lean-only.  
   *Proves independence: no more fake CBB edge tickets.*

2. **Instrument Model Lab proof board on SYS**  
   Endpoint already: `/api/model-lab`. Surface paired champion-vs-challenger MAE/Brier for CFB FBIS vs `CFB-PINNACLE-IMPLIED` / ratings shadows, and CBB CBBD vs Pin-implied — graded frozen rows only. Exclude market-informed as “edge models.”  
   *Proves what we can currently measure.*

3. **Freeze + report CBB independent shadow as first-class research series**  
   Ensure `CBB-CBBD-RATINGS-v1` predictions land in `model_predictions` on collect/college refresh and are graded on harvest — no qualify.  
   *Creates the OOS sample needed before any CBB promote.*

4. **Qualification integrity: DQ + Pin-only F5**  
   Block qualify on `pinnacle_implied_score` / unresolved market / critical MLB missing-SP; F5 qualify only on complete Pin.  
   *Cleans the ticket population used for “are we profitable?” so it doesn’t contaminate “are we accurate?”*

5. **Version + auth hygiene**  
   Align `MODEL_VERSION` labels in docs/college stamps without rewriting historical snapshot rows; fail-closed harvest secret; auth `/api/track` POST.  
   *Protects the ledger you will use as evidence.*

6. **(Stretch) CFB prior provenance flag**  
   Persist `priorAsOf` / `priorSeasonYear` / `priorIsLiveInSeason` on CFB freezes so later OOS can stratify early-season vs live-power contamination — **do not change score formula yet**.  
   *Enables honest CFB validation without contaminating history.*

**Sprint success criteria:**  
A SYS (or lab) view that answers, for MLB / CFB / CBB-shadow / NFL-none: N frozen graded games, MAE total/margin, Brier vs market, and “cannot qualify because …” reasons — with CBB no longer generating Pin-circular QUALIFIED tickets.

---

## 12. DO NOT CHANGE LIST

| Leave alone | Why |
|---|---|
| CFB `projectCfbMatchup` opponent-residual identity | Already fixed compressed FBS/FCS; needs OOS before further formula edits |
| Champion HFA 2.5 / neutral 0 | Explicitly frozen; shadows only (`hfa.js`) |
| FBIS-HC-v1 conjunction (qualified ∧ EV≥8% ∧ CONVICTION) | Strategy cohort ≠ model; N=7 is not promotion evidence |
| NFL qualify hard-block | Correct honesty |
| Shadow `canQualify: false` / no auto-promote | Matches philosophy |
| Savant vs Pal separation; RL 1.5/0.5 exact pairing | Well designed |
| Pin = benchmark EV; Heritage = execution | Pricing integrity core |
| Frozen snapshot immutability (`INSERT OR IGNORE`, grade via COALESCE) | Historical comparability |
| Probability decimal contract / reconstruction freeze-before-start | Protects conviction integrity |
| Blue Chip / team HFA as production | Challenger only; insufficient evidence |
| Fixture REG coefficients as production features | Not real trained models — don’t “tune” them in place |
| Autonomous betting / OpenClaw / agent execution | Out of scope by product rule |
| Destructive D1 migrations / rewriting historical freezes | Contaminates comparability |
| Changing CFB/MLB champion formulas because theory says so | Challenger + temporal OOS + operator approval only |

---

## Doc vs code conflicts (treat code as truth)

| Docs | Code |
|---|---|
| README FBIS-v1.3 | `MODEL_VERSION` FBIS-v1.4 |
| CBB grouped with “implied until wired”; NFL similarly | NFL blocked; **CBB not blocked** |
| CFB “preseason” CFBD prior | `loadCfbPrior` uses **current-season** ratings when available |
| Harvest ~06:20 CT only | Cron `20 11,16 * * *` (two slots) |
| Board routes don’t write | True for freeze; `/api/track` POST and bets Confirm **do write** |
| Local = production freeze policy | Vite middleware still freezes |

---

**No code edits were made for this audit.** The First Engineering Sprint (Section 11) is the recommended next implementation plan pending operator approval.
