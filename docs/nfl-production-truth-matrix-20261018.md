# NFL Production Truth Matrix — 2026-10-18

**Authority:** READ-ONLY OBSERVATION + BOUNDED REPAIR EVIDENCE  
**GitHub `main` SHA:** `352de02105f193ce449d1fb3aa3b58150bbc8fd4`  
**Cloudflare Pages production deployment:** `05654343-7223-40e9-b3b9-a3ea6542bb46` @ same SHA  
**Health API `deploymentCommit`:** `352de02105f193ce449d1fb3aa3b58150bbc8fd4`  
**Primary D1 size observed:** ~8.25 GB / 10 GB

Statuses: **VERIFIED** | **DEGRADED** | **BLOCKED** | **UNKNOWN**

| Component | Status | Evidence |
|---|---|---|
| GitHub main ↔ production Pages SHA match | VERIFIED | `/api/health` + CF Pages production deployment commit |
| NFL board slate (2026-10-18) | VERIFIED | `/api/today?sport=nfl` returns 12 scheduled games |
| 32-team season schedule completeness | VERIFIED | D1 `nfl_team_schedule_profile` 272 events / 32 teams / weeks 1–18 present |
| Today board team coverage | VERIFIED | 24 teams on board; bye/missing: CIN, DEN, DET, MIA, MIN, SEA, SF, WAS |
| Production champion identity | VERIFIED | Governance champion = `NFL-PRO-v1.1` (unchanged) |
| Displayed board research model | DEGRADED→REPAIRED in PR | Live board labeled `NFL-PRO-v1` while scoring `v1.2`; attribution repair distinguishes champion vs displayed research |
| Live score arithmetic reconciliation | VERIFIED | All 24 home/away sides on 2026-10-18 slate reconcile within 0.1 via decomposition replay |
| Immutable published freezes (today) | DEGRADED | Only 1/12 games in `published_projections` for 2026-10-18 (`401872996`) |
| Feature coverage on live scores | DEGRADED | Typical missing: success, earlyDown, explosives, pressure, trenches, specialTeams, context (~42% coverage share) |
| NFLverse/NGS feature snapshot jobs | VERIFIED | `nfl-feature-snapshot` workflow success through 2026-10-18 |
| Persistent team profiles | VERIFIED | 32 teams, latest sync 2026-10-18T01:00Z; earlier Oct 16–17 failures recovered |
| Official injury observations | VERIFIED | Fresh D1 observations through 2026-10-18T05:01Z |
| Availability before scoring (for SHADOW) | DEGRADED→REPAIRED in PR | Profiles previously attached after scoring; pipeline reordered |
| Displayed score consumes injuries | VERIFIED (intentionally false) | NFL-PRO-v1.2 does not consume injuries; QB overlay is SHADOW only |
| QB personnel prospective shadow | DEGRADED | 46 frozen rows / 12 graded / gate sample insufficient for promotion |
| NFL wager decision ledger | VERIFIED empty-of-bets | 5,589 `PASS` decisions; 0 settled outcomes in `nfl_wager_outcomes` |
| Manual tracker NFL economics | VERIFIED | Unified ledger NFL **29-14** (−$1.89 on $135.78 risk, −1.39% ROI); not model-authorized |
| Action Network paid collection | BLOCKED | Policy `PRIZEPICKS_ONLY_REAUTHORIZATION` / prior usage-limit blocks |
| PrizePicks collection | VERIFIED | Active; latest capture 2026-10-18; $0.70/run cap preserved |
| Live odds collection health | DEGRADED | `liveCollectionHealthy=false`; NFL odds source cache-only / stale observation |
| Primary D1 capacity | DEGRADED | ~82.5% of 10 GB; failedWrites historical count non-zero; cold/ops shards present |
| Storage-capacity API | BLOCKED (auth) | `/api/storage-capacity` returns 403 without operator auth |
| Historical Oct 11 score cases | NOT_FULLY_RECONSTRUCTABLE | Frozen PIT inputs missing for HOU@TEN, DET@ARI, MIN@NO, SF@SEA; PHI@JAX partial |
| NFL-PRO-v1.1 walk-forward reproduction | UNKNOWN | Training CSV `artifacts/nfl/nfl_game_training_2015_2026.csv` not present in this environment |
| Player-prop Oct 6 calibration failure | UNKNOWN (artifact present) | Calibration JSON present; independent re-run not completed in this pass |

## Governance confirmation

- Production champion **not** changed.
- Wager authorization **not** expanded.
- QB overlay remains SHADOW with existing 0.30 gate and prospective thresholds.
- Four-/five-star prop confidence remains blocked pending existing validation.
- No paid collection restrictions relaxed.
