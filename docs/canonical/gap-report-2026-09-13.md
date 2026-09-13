# FBIS Canonical Gap Report — 2026-09-13

**Governing specs:** FBIS Model Family Standard + sport manuals (CBB, CFB, NFL, NBA, MLB, NHL)  
**Audit posture:** Preserve all verified production incumbents. No silent champion replacement.  
**Production SHA at audit start:** `5d95166` (Phase 6 props + logo shrink live on `fbis-myz.pages.dev`)

---

## 1. Executive verdict

The current Cloudflare Pages + D1 product is a **strong research/operator console** with:

- Independent **MLB** scores that can still qualify under integrity gates
- Fitted **CFB-FBIS-v2** as **production display projection** with wager gates hard-off
- **NBA / NFL / CBB** boards largely **market-implied** for scores (qualification blocked)
- **ACTION/Apify** correctly shadow-only
- Rebuild phases 1–6 UI (Today / Game / Player Props) shipped

It is **not yet** the full Model Family Standard A+ projection service. The largest structural gaps are shared **governance contracts** (source/feature/model registries with manual maturity states), **global point-in-time lineage**, **misprice state machine** (DISAGREEMENT vs CALIBRATED_EDGE), **per-market player prop maturity**, Queues/Workflows, Discord publication ledger completeness, and commercial-rights gating as first-class metadata.

This report freezes incumbents and defines the migration path. Implementation in this PR installs the shared contract layer without mutating champion coefficients.

---

## 2. Locked incumbents (DO NOT SILENTLY CHANGE)

| Sport | Incumbent | Manual status | Code status | Wager authority |
|---|---|---|---|---|
| **CFB** | CFB-FBIS-v2 (M*=A / T*=A) | Production projection champion — preserve locked coeffs + validation | `CFB-FBIS-v2` / `promoteCfbFbisV2ToBoard`; fitted package under `data/models/` | `canQualify=false`, `canAuthorizeWager=false` |
| **MLB** | Savant RPG×SP (+ overlays) | Full research build; preserve immutable projections | Independent scores; qualify path exists with Pin two-way | Qualify allowed only under integrity gates |
| **CBB** | Research champion — retain/repair/revalidate | March 2026 baseline referenced in manual | Board still largely Pin-implied; CBBD/Torvik/KenPom shadows | Blocked for Pin-implied |
| **NFL** | Any verified incumbent preserved until independent challenger wins | Audit/build under champion/challenger | Form/PRO shadows; board Pin-implied | Blocked |
| **NBA** | Research until locked walk-forward | Player-driven design required | Board Pin-implied | Blocked |
| **NHL** | Feasibility/research | Production only after PIT proof | Not a first-class board sport today | N/A |

**ACTION:** `inProductionRouter=false`, `decisionEligible=false`, `canQualify=false`, `canAuthorizeWager=false` — preserved.

---

## 3. Shared Model Family Standard — gap matrix

| Contract requirement | Current state | Gap severity | Notes |
|---|---|---|---|
| Canonical pipeline (PIT → PURE → immutable → calibrated → market → misprice → qualify → units → human confirm) | Partially present; EV often before calibrated distribution | **HIGH** | Heuristic Normal-σ + shrink-to-market manufactures ticket probs |
| PURE / MARKET / PLAYER family separation per sport | Partial (CFB best; CBB/NFL/NBA weak) | **HIGH** | Market shrinkage contaminates ticket probabilities |
| Projection contract (`informationCutoff`, `featureSnapshotId`, …) | Incomplete globally | **HIGH** | CFB research tables have cutoffs; live board rows incomplete |
| Source registry + commercial status | Ad-hoc docs/secrets | **HIGH** | Manual statuses not enforced in code |
| Feature registry + ablation status | CFB feature catalog only | **HIGH** | No cross-sport registry |
| Misprice states (NO_MODEL…AUTHORIZED/BLOCKED) | Conviction/edge scores without state machine | **HIGH** | Risk of labeling unvalidated EV |
| Walk-forward only (no shuffled K-fold for temporal claims) | CFB-v2 disciplined; CBB manual flags legacy learner defects | **MED** | Must not reintroduce CBB shuffled CV |
| Champion/challenger governance (no auto-promote) | Strong fail-closed on wager; CFB display cutover is code-locked | **MED** | Document display vs wager authority clearly |
| Required APIs (`/slate`, `/misprices`, `/model-lab`, `/data-health`, `/history`) | Partial (`model-lab`, `health`, `slate`, `today`) | **MED** | Add misprices + data-health product APIs |
| Product surfaces (Today, Games, Props, Misprices, Lab, Health, History) | Today/Markets/Props live; Research/Performance placeholders | **MED** | Wire Lab/Health/Misprices |
| Queues / Workflows | Absent (GH Actions + D1 retry tables) | **MED** | Cost-aware; not blocking inference |
| Discord publication ledger | `published_projections` exists; no Discord publisher | **MED** | Ledger first; channel later |
| Units-only + human confirmation | Mostly true | **LOW** | Keep; no auto-wager |

---

## 4. Sport-by-sport gaps

### CFB (highest maturity)
**Preserve:** CFB-FBIS-v2 fitted A/A, temporal audit artifacts, wager gates off.  
**Gaps:** QB/roster/matchup challengers not isolated as versioned artifacts; player props opportunity engine provisional; misprice labeling; CFBD commercial-use flag; ACTION field-level contract incomplete vs manual.

### CBB
**Preserve:** Shadow/research posture; do not promote Pin-implied.  
**Gaps:** Full revalidation program (manual §§12–13 ML repair); CBBD/KenPom API/Torvik bulk adapters with PIT; possessions×PPP decomposition as PURE; player minutes engine; commercial rights for KenPom/Torvik.

### MLB
**Preserve:** Savant independent path + qualify gates.  
**Gaps:** Explicit MLB-FBIS-PURE / MLB-MARKET / MLB-PLAYER families; starter/lineup lifecycle snapshots; prop market maturity cards; ACTION field contract.

### NFL / NBA / NHL
**Gaps:** Nearly full Phase 0–24 programs. Board identity exists for NFL/NBA; NHL not first-class. No production PURE champions.

---

## 5. Data / commercial rights (initial registry intent)

| Provider | Domain | Intended status |
|---|---|---|
| CFBD | CFB sports | `COMMERCIAL_USE_REVIEW_REQUIRED` until paid-use terms documented; technical `PRIMARY_PRODUCTION` candidate |
| CBBD | CBB sports | Same |
| KenPom API | CBB analytics | `COMMERCIAL_USE_REVIEW_REQUIRED`; API only, no scrape |
| Torvik/T-Rank bulk | CBB analytics | Research/personal OK per manual; paid publication still `COMMERCIAL_USE_REVIEW_REQUIRED` |
| Parlay/Pinnacle + TheOdds | Market router | Production market (not PURE) |
| ACTION/Apify | Market intel | `RESEARCH_ONLY` + commercial review; shadow flags hard |
| ESPN / MLB Stats / Savant | Schedule/stats | Verify terms per commercial gate |
| Ballpark Pal | MLB overlay | Commercial key; review for paid publication |

---

## 6. Probability / EV integrity findings (critical)

1. **`shrinkToMarket(~0.65)`** and **`blendWinProb` market weight** mix market into ticket probabilities even when scores are independent → violates PURE separation for EV claims.  
2. CFB Normal-σ cover/total probabilities are **heuristic** (UI sometimes discloses) but can drive EV → must stay `MODEL_DISAGREEMENT` / unvalidated until calibration passes.  
3. Player prop `probabilityAtThreshold` without locked OOS calibrator must not show EV.

**Repair direction (challenger, not silent rewrite):** introduce misprice state machine; gate EV on `CALIBRATED_EDGE+`; leave incumbent score engines untouched.

---

## 7. What this implementation ships now

Phase 0–6 **shared foundations** (no champion coefficient changes):

1. Canonical gap report (this document)  
2. Source registry + commercial statuses  
3. Model family registry with maturity states + locked CFB-FBIS-v2 / MLB incumbents  
4. Feature lineage + projection contract helpers  
5. Misprice engine state machine  
6. D1 migration for registry/health/misprice tables  
7. APIs: `/api/data-health`, `/api/misprices`, enhanced model-lab metadata  
8. UI: Research → Model Lab; System → Data Health; Misprices board surface  
9. Tests locking ACTION shadow flags + CFB champion freeze + misprice labeling  
10. Deploy via normal CI to production

**Explicitly deferred (next phases, not claimed complete):** full sport PURE rebuilds, Torvik/KenPom production adapters, Queues/Workflows, Discord publisher, locked OOS for every prop market, NHL module.

---

## 8. Commercial readiness

**NOT READY** for paid projection claims beyond current research console.  
Required before commercial A+: rights clearance, PIT lineage complete per sold market, calibrated probs only when validated, immutable publication ledger, disclosed limitations.

---

## 9. Cloudflare cost posture

Stay on Pages Functions + D1 + R2 + GitHub Actions cron. Queues/Workflows deferred until ingestion fanout volume justifies them. No Workers AI on board path.
