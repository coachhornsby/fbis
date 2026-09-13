# FBIS Manual Completion — Revised Honest Handoff (PR #92)

**Do not merge yet.** Draft until GitHub CI is green on the corrected head. No production deployment claim.

## Four counts (requirement-level, from `docs/canonical/manual-completion-matrix.md`)

| Bucket | Count | Meaning |
|---|---:|---|
| 1. **IMPLEMENTED** functional requirements | **24** | Shared governance, champion freezes, ACTION append series, CBBD/shared college freeze-grade, market gates |
| 2. **IMPLEMENTED_RESEARCH_ONLY** | **18** | NFL PBP→feature→OLS→walk-forward/freeze/grade machinery; CBB possessions×PPP baseline |
| 3. **IMPLEMENTED_SCAFFOLD / IMPLEMENTATION_PENDING** | **27** (10 scaffold + 17 pending) | Declared CFB/MLB challenger slots; NFL non-PBP families; CBB KenPom/Torvik/minutes/player; NBA/NHL provider-independent models still unfinished |
| 4. **True external / evidence blockers** | **3** | 2× `PROVIDER_OR_LICENSE_BLOCKED` (NBA/NHL ingestion) + 1× `VALIDATION_PENDING` (NFL production OOS accumulation after pipeline). **`OOS_DATA_PENDING` = 0** at program level — full pipelines are not complete enough to use that label |

Also: any challenger→champion remains **OPERATOR_PROMOTION_REQUIRED** (process gate, not counted as “done”).

---

## NFL — exact honesty

| Question | Answer |
|---|---|
| What real data feeds the current research projection? | **When fit + feature snapshot/raw PBP provided:** PIT-filtered nflfastR/nflverse-shaped PBP → computed feature diffs → transparent OLS. **Otherwise:** optional team-form fallback (`NFL-TEAM-FORM-v0`) labeled **IMPLEMENTED_SCAFFOLD** — not the manual pure model. |
| Which manual features are actually computed? | `historical_pbp`, `epa`, `success_rate`, early/passing-down efficiency, rush/pass splits, explosiveness, pressure/sacks proxy, turnovers, red zone, pace |
| Which are only declared? | field position, special teams, rosters, QB identity, injuries/practice, active/inactive, coaching, venue/roof/surface, weather, rest/travel (+ schedule identity slot) |
| Can the model be replay-trained historically today? | **Yes** — `fitOlsMargin` + `runNflWalkForward` on PIT-safe historical rows (fixture-proven). No fabricated coefficients. |
| Are shadow predictions automatically frozen? | **Research freeze contract yes; production auto-freeze job = no** |
| Are they automatically graded? | **Research grade path yes; production auto-grade job = no** |
| Is a walk-forward runner operational? | **Yes** (expanding walk-forward on supplied labeled rows) |
| What remains besides future OOS N? | Non-PBP feature families; production auto-freeze/grade wiring; operator promotion. **Therefore not program-level `OOS_DATA_PENDING`.** |

Modules: `nflPbpNormalize.js`, `nflPbpFeatures.js`, `nflResearchPipeline.js`, `nflPureChallenger.js`.

---

## CBB

- Possessions×PPP baseline: **IMPLEMENTED_RESEARCH_ONLY** (legitimate minimal independent research model).
- Full manual: **not complete**. See `cbbProgramAudit.js` — KenPom/Torvik adapters, minutes/player models, richer matchups still **IMPLEMENTATION_PENDING**; several lineage/registry pieces **IMPLEMENTED_SCAFFOLD**.
- Shared college freeze/grade/paired Pinnacle comparison: **IMPLEMENTED** (thin PURE series).
- **Do not** call the complete CBB manual `OOS_DATA_PENDING`.

---

## CFB / MLB

- Champions **CFB-FBIS-v2** / **MLB-SAVANT-RPG-SP** locked (**IMPLEMENTED**).
- Challenger “feature lists” are **DECLARED SLOTS** → **IMPLEMENTED_SCAFFOLD** / **IMPLEMENTATION_PENDING**.
- Real CFB champion feature pipeline (`cfbFeaturePipeline.js`) is separate and preserved.
- Path `provider → raw → normalize → PIT → feature → model → projection → freeze → grade` is **incomplete** for each challenger slot.

---

## NBA / NHL

- Ingestion/redistribution: **PROVIDER_OR_LICENSE_BLOCKED**.
- Provider-independent contracts/enums/opportunity scaffolds: present.
- Score/xG/covariance/freeze-grade models: **IMPLEMENTATION_PENDING** where unfinished — **not** excused by the license block.

---

## Testing

- Integrity: `test/manual-completion-integrity.test.js` (governance + honest statuses).
- Functional: `test/functional-pipeline.test.js` (PBP→features→PIT→OLS→freeze→grade→walk-forward; CBB PIT; ACTION append/identity/splits).
- Existing ACTION series tests remain authoritative for observation append behavior.

---

## PR / CI

- Branch: `cursor/fbis-manual-complete-312d`
- PR: #92 (keep **draft**)
- Rebased/merged with `main` (0025 tip) earlier this run
- Before merge request: push corrected head → full GitHub CI green (migration verify, production build, governance + functional tests)
- **No production deployment**
