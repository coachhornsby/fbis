# FBIS A+ Architecture — Phase 0 Gap Report

**Date:** 2026-09-14  
**Repo:** `coachhornsby/fbis` @ `main`  
**Scope:** Inspect-only inventory against the A+ forecasting / market-intelligence / decision target. No champion replacements. Staged PRs only.

Status key: **EXISTING** · **PARTIAL** · **ABSENT**

---

## 1. Major section status

| Section | Status | Notes |
|---|---|---|
| Feature registry (canonical, cross-sport) | **PARTIAL** | CFB catalogs + lineage contracts; no universal registry metadata |
| PIT feature snapshots | **PARTIAL** | NFL PBP / CFB research paths; board projections incomplete |
| Source quality states | **PARTIAL** | Health/collect telemetry; not READY/PARTIAL/STALE/… per source |
| Source redundancy / disagreement ledger | **ABSENT** | Identity matchers exist; no structured conflict store |
| Entity resolution | **PARTIAL** | Fail-closed matchers for ACTION/events; coach/venue uneven |
| ACTION observation store + Apify collectors | **EXISTING** | Shadow tables + immutable series |
| Provider sharp/steam preservation on Board | **PARTIAL** | Fields often collected; Board force-nulls FBIS `sharpLabel` and does not expose provider signals |
| FBIS-derived market signals / regimes | **ABSENT** | Derivatives lib exists; RLM/regimes/score not on Board |
| Tickets/money/sample/volume on Board | **PARTIAL** | Tickets/money yes; sample/volume/book range/history underused |
| Spread + total + ML ACTION coverage | **PARTIAL** | `publicSplits.markets` has ML/RL/TOTAL; UI/primary often RL-first |
| ACTION player props | **PARTIAL** | Normalized + inventory; no qualification (correct) |
| Movement series OPEN→CLOSE | **PARTIAL** | Pointers + history persist; Board shows open/current only |
| Reverse line movement detector | **ABSENT** | |
| Book disagreement | **PARTIAL** | `deriveBookDisagreement` exists; not wired to Board |
| Market Intelligence Score (explainable) | **ABSENT** | |
| Operator execution books | **PARTIAL** | Canonical empty default; config API exists |
| Complete offer object + EV ranking | **PARTIAL** | Offers/freshness exist; EV gated on calibration |
| PURE model family BASELINE/CHALLENGER/CHAMPION | **PARTIAL** | Strongest for CFB/MLB; NFL form+PBP research |
| NFL form / PBP challengers | **PARTIAL** | `research-v0-form` + `research-v1-pbp`; freeze incomplete |
| CFB-FBIS-v2 champion | **EXISTING** | Preserve; wager gates off |
| CBB multisource PURE | **PARTIAL** | Research/scaffold; KenPom/Torvik not production |
| MLB champion + richer challenger | **PARTIAL** | Savant RPG×SP champion; SP/bullpen/lineup decomposition thin |
| NBA / NHL PURE | **ABSENT** / scaffold | Board identity only |
| Personnel engine | **ABSENT** | |
| News/injury structured engine | **ABSENT** | |
| Sport-specific weather | **PARTIAL** | Card/venue weather display; not model-first-class everywhere |
| Uncertainty / distributions / simulation | **PARTIAL** | Heuristic σ in places; no locked calibrator → no fair EV |
| Calibration / fair price authority | **PARTIAL** | Contracts + Model Lab metrics; no production calibrator |
| Ensembles | **ABSENT** | Correct — wait for independent strength |
| Walk-forward / ablation / drift / model health | **PARTIAL** | CFB/NFL research tools; not productized |
| Model Lab + cohort separation | **EXISTING** / **PARTIAL** | Lab exists; HISTORICAL_REPLAY vs PROSPECTIVE discipline uneven |
| Decision engine object | **PARTIAL** | Authority + board decision states; ACTION context research not weighted |
| Risk / portfolio | **PARTIAL** | Units-based; correlation portfolio thin |
| Bet journal + evidence ledger | **PARTIAL** | Freeze/grade/CLV; full evidence packet incomplete |
| Postmortem engine | **ABSENT** | |
| Board ACTION-first UI | **PARTIAL** | ACTION block exists; not full intelligence surface |
| Game detail tabs (Model/ACTION/Market/…) | **PARTIAL** | Workspace panels; not full A+ tabs on `main` |
| DQ componentization | **PARTIAL** | Flags exist; Pinnacle must not dominate (roles work started) |
| Observability / cost / commercial / security | **PARTIAL** | SYS health strong; cost-by-source thin |
| Leakage / firewall tests | **EXISTING** | ACTION cannot qualify/authorize; sharpLabel null as FBIS |
| Promotion governance / model cards | **PARTIAL** | Maturity enums; cards incomplete |
| Coverage matrix | **ABSENT** as product artifact | Docs partial |

---

## 2. What exists already (do not rebuild)

- Three-system firewall instincts (PURE vs ACTION shadow vs decision gates)
- ACTION Apify collect → normalize → shadow observations → optional time series
- Market roles: EXECUTION / CONSENSUS / INTELLIGENCE / REFERENCE; Pinnacle demoted from execution default
- CFB-FBIS-v2 + MLB Savant champions
- NFL research-v0-form + research-v1-pbp scaffolds
- Freeze / grade / CLV / Model Lab / decision authority reason codes
- Board attach of ACTION consensus + tickets/money + open→current

---

## 3. Collected but underused (highest leverage)

| Data | Stored | Board / decision use |
|---|---|---|
| `publicBetting.sharpSide` | Yes (`public_betting_json`, research) | Dropped — `sharpLabel` force-null, no `providerSharpSignal` |
| `betCount` / tracked volume | Partial | Not on Board payload |
| Per-book matrix (`shadow_market_books`) | Yes | Not joined for disagreement/range |
| Line history ticks | Yes | Not surfaced as sparkline series |
| ML + TOTAL public splits | Yes in `markets[]` | Secondary to RL; regimes unused |
| `buildActionMarketResearchPacket` | Lib only | Not attached to games |
| Player prop inventory | Yes | Research only (correct until player PURE) |

---

## 4. ACTION fields available today

From normalizer / fixtures (when Actor supplies them):

- event, league, teams, start, period  
- consensus spread / total / ML + odds  
- publicBetting: tickets%, money%, money−tickets, max gap, **sharpSide**, **betCount**  
- lineMovement: open/current spread+total+ML, directions, **history[]**  
- books[]: per-book lines/prices/holds  
- bestOdds  
- result / closing (evaluation-only)  
- playerProps / gameProps (schema-variable)  

Often missing from Actor payloads: explicit **steam** labels, tracked **volume**, rich prop public splits.

---

## 5. Current PURE features by sport (summary)

| Sport | Champion / primary | Feature depth |
|---|---|---|
| **CFB** | CFB-FBIS-v2 | Efficiency/talent/context fitted package — preserve |
| **MLB** | Savant RPG×SP | Starter-centric; bullpen/lineup/platoon thin |
| **NFL** | research-v0-form (board research); v1-pbp parallel | Form baseline; EPA family research-only |
| **CBB** | Research / often market-implied scores | No KenPom/Torvik production PURE |
| **NBA/NHL** | None production | Architecture only |

---

## 6. Biggest model-data gaps by sport

1. **NFL** — EPA/personnel/QB PIT pipeline + prospective freeze of form+PBP  
2. **Personnel engine (all)** — starters/availability  
3. **CBB** — multisource adjusted ratings with commercial gates  
4. **Calibration** — locked OOS calibrators before fair EV  
5. **ACTION → Board** — provider signals + sample + regimes (this PR)

---

## 7. Proposed PR sequence

1. **ACTION Intelligence enrichment** ← first  
2. Feature Registry + PIT snapshot foundation  
3. NFL PBP V1 full feature pipeline  
4. NFL personnel/QB/context  
5. NFL calibrated distributions + simulation  
6. Decision-engine ACTION context research (evidence first, no hard weights)  
7. CBB multisource challenger  
8. MLB richer challenger → then NBA/NHL  

---

## 8. Highest-value first PR

**PR 1 — ACTION Intelligence enrichment**

- Preserve/expose `providerSharpSignal` / `providerSteamSignal` (`providerSignalSource=ACTION`)  
- Surface tickets/money/sample/volume/movement/book range for RL+ML+TOTAL  
- Explainable FBIS-derived signals + market regime (never unlabeled)  
- Board ACTION block shows real fields only; never invent sharp/EV/qualify  
- Keep `sharpLabel` null as FBIS truth; keep firewall gates false  

---

## 9. Explicit non-goals this cycle

- Silent champion replacement  
- Market features inside PURE  
- Black-box sharp score  
- Prop qualification without player PURE  
- Mega-PR rewrite of Board + models together  
