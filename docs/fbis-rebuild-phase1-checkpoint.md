# FBIS Rebuild — Phase 1 Checkpoint

**Recorded:** 2026-09-13  
**Status:** COMPLETE — safe to proceed to Phase 2 (domain contracts)

---

## 1. Exact SHAs

| Ref | Full SHA |
| --- | --- |
| `origin/main` HEAD | `b5fc9eabbced73a5fae8086165875df507324b74` |
| Production `deploymentCommit` | `b5fc9eabbced73a5fae8086165875df507324b74` |
| Schema | `0022_action_apify_harden` **VERIFIED** |
| Model package | `FBIS-v1.4` |
| Prod health | `HEALTHY` |

Main and production match.

---

## 2. Production safety (verified live + code)

| Invariant | Live / code |
| --- | --- |
| Odds router | `parlay → theodds → sharpapi → therundown` → fail closed |
| Action in router | **false** (`inProductionRouter: false`) |
| Action mode | **shadow** |
| Action plan | **starter** (after #84+#85) |
| `canQualify` | **false** |
| `canAuthorizeWager` | **false** |
| Championship | **COLLECTING** |
| Bankroll dollars | **none** (unit sizing only; slip import may store book risk metadata) |
| Auto sportsbook execution | **none** (manual Heritage/NoVig import only) |

CFB-FBIS-v2 / CFB-PLAYER-v1 / NFL challengers: `canQualify=false`, `canAuthorizeWager=false` in registry and packages. Coefficients **not** changed in this phase.

---

## 3. PR reconciliation

| PR | Classification | Notes |
| --- | --- | --- |
| #80–#82 | MERGED (historical) | Matching repair, props outcomes[], secret-sync retries |
| #84 | MERGED | Pin `ACTION_APIFY_PLAN=starter` |
| #85 | MERGED | Fix Pages secret/var binding conflict; deploy green |
| **#83** | **MERGE_READY** (draft) | SHA-gate post-repair verify + championship checkpoint doc; no router/promote changes. Recommend mark ready + merge when owner wants checkpoint on main. |
| #42 | NEEDS_REVIEW | Board min type size — UI polish; defer into Phase 3+ shell work or close if superseded |
| #38 | DO_NOT_MERGE (draft) | CFB board polish — defer; will be reshaped by Today rebuild |
| #4 | DO_NOT_MERGE (draft) | MLB phase-1 / conviction paused — out of scope for launch rebuild |
| #6 | SUPERSEDED / optional | Full-repo audit markdown — informational |
| #53–#60 | NEEDS_FIX / defer | Dependabot major bumps — do not merge during rebuild without isolated validation |

**Do not promote Action.** No open PR does so.

---

## 4. Security

| Item | Finding |
| --- | --- |
| Repo visibility | **PUBLIC** (`coachhornsby/fbis`) |
| Secret scan (working tree) | No live credentials found; test fixtures use obvious placeholders (`test-token-not-secret`) |
| `.env` / `.dev.vars` | gitignored |
| Pages secrets | Synced via CI (`HARVEST_SECRET`, provider keys, `APIFY_TOKEN`, plan pin) — values never logged |

**Recommendation:** `KEEP_PUBLIC_TEMPORARILY`

Rationale: tree looks clean of committed secrets, but public history + Actions logs deserve an owner pass before `READY_TO_RETURN_PRIVATE`. **Do not change visibility without owner approval.**

---

## 5. Action matching / props (preserved)

| Item | State |
| --- | --- |
| CFB duplicate collapse (ESPN vs synthetic) | On main (#80) |
| Football slate horizon today→+3 Chicago | On main (#80) |
| Strict name fluff (not global MASCOT) | On main |
| `outcomes[]` prop flatten | On main (#81) |
| Live SHA-gated verify | CFB 3/3, NFL 4/4; identity/price/line/book **1.0**; canonical ~**0.54** → **RESEARCH_READY** |
| Headshots from Action | Unavailable — keep `imageUrl` nullable |

---

## 6. Economics

| Field | Value |
| --- | --- |
| Subscription | $19 (Starter) |
| Prepaid platform usage | $19 |
| Live plan env | **starter** |
| MTD estimated Action spend | $0 (no championship cadence run yet) |

Track separately: subscription · gross usage · prepaid · excess · tax. Do not collapse to a single “Action costs $X”.

---

## 7. Frontend current state (pre-rebuild)

Nav today: **TODAY · MLB/NBA/NFL/CFB/CBB · BETS · SYS** (`src/App.jsx`).

Large views: `App.jsx`, `TodayView.jsx`, `TrackView.jsx`, `MyBetsView.jsx`.

Target customer nav (Phase 3+):

```text
TODAY · MARKETS · PLAYER PROPS · MY BETS · PERFORMANCE · RESEARCH
```

System/admin separated.

---

## 8. Parallel tracks

```text
TRACK A — FBIS PRODUCT REBUILD (Phases 2–10)
TRACK B — ACTION CHAMPIONSHIP (shadow COLLECTING; no promotion)
```

Do not block UI work on championship completion.

---

## 9. Phase 1 exit → next

**Next major action:** Phase 2 — domain contracts + API cleanup  
(Event / Market / PlayerMarket contracts; hide provider schemas from frontend; additive only; no Action promotion; no model coefficient changes.)
