# FBIS NFL — Final Executive Report (2026-10-18)

Verified production SHA: `59635bf8` (post-#1263). Schema tip `0114_nfl_research_publications` VERIFIED.

Follow-on durability/scheduler/audit/challenger work is in open draft PR #1264 (CI in progress at report time).

---

## COMPLETED

| Change | PR | Merge SHA / note |
|---|---|---|
| Integrity attribution, availability-before-score, frozen audits | #1253 | `4c20c777` |
| TODAY board audit/QB DTO fields | #1254 | `ef152e6f` |
| Multi-checkpoint `nfl_research_publications` + migration 0114 | #1255 | `79a14c4e` |
| Publish API deploy-race wait | #1257 | `764a1646` — first 12/12 freeze |
| v1.1 training reproduction docs | #1256 | `aeb90308` |
| Pressure-allowed + schedule context → PRO features | #1258 | `c6682a32` |
| Feature cache bust v4 | #1259 | `9eddeba1` — live pressure coverage |
| Weekly research report v2 | #1261 | `a50956f1` |
| T6 roll-forward republish (ARI@LAR) | #1263 | `59635bf8` — **12/12 restored** |
| Permanent scheduler + R2 training archive + audit v2 + PBP enrich + challenger compare | #1264 | Open / draft (implements next priorities) |

---

## SYSTEM HEALTH

| Component | Status |
|---|---|
| Current-checkpoint publications | **12/12** (`currentCoverageShare: 1`) |
| ARI@LAR | T24 + T6 freezes present (immutable roll-forward) |
| Modeled / audited games | 12/12 reconciled on `?sport=nfl` |
| Feature coverage (live pre-#1264 enrich) | **58.3%** (7/12 families) |
| QB overlay | SHADOW; prospectiveValidationPassed=false |
| Market usable lines | Degraded (0/12 in health) |
| Workers Builds (orchestrator / market-probe / soccer-backfill) | Preexisting unrelated failures every PR |
| `/api/today` without sport | Durable fallback strips research fields — use `?sport=nfl` |

---

## MODEL STATUS

- **Champion:** NFL-PRO-v1.1 — unchanged
- **Displayed research:** NFL-PRO-v1@v1.2
- **Shadow:** NFL-QB-PERSONNEL-OVERLAY-v1 — no production promotion
- **Qualification / wager authority:** unchanged (false)

---

## DATA STATUS

- Publications: compact D1 + R2; unique per checkpoint; past windows explicitly missing (not invented)
- Training CSV: recovered + hash-pinned; durable R2 archive lands with #1264 workflow
- Live families present: teamEpa, quarterback, passMatchup, rushMatchup, pressure, nextGenTracking, context
- Still null pre-PBP-enrich deploy: success, earlyDown, explosives, trenches, specialTeams
- #1264 adds PBP enrich for success/early-down/explosive; trenches+ST remain null by design

---

## PREDICTIVE RESULTS

| Model | n | Margin MAE | Total MAE | Winner |
|---|---:|---:|---:|---:|
| NFL-PRO-v1.1 (reproduced) | 2176 | 10.1993 | 10.6774 | 64.338% |
| NFL-PRO-v1.2 | 2176 | 10.1993 | (same walk-forward artifact) | — |
| NFL-PRO-v2 research | 2176 | 10.1993 | — | — |
| Form baseline | 2176 | 10.3549 | — | — |
| Closing market | 2176 | **9.8543** | — | — |

Identical chronological windows for v1.1/v1.2/v2 (`promotionEvidencePass: false`). Calibration/economics in compare left NULL.

---

## ECONOMIC RESULTS

Tracker ledger (not model-authorized):

| Book | Record | Risk | P/L |
|---|---:|---:|---:|
| Overall | 29-14-1P | $135.78 | −$1.89 (−1.39%) |
| Spreads | 22-5-1P | $67.18 | +$34.52 |
| Totals | 6-3 | $19.60 | +$5.40 |
| ML | 1-0 | $3.00 | +$4.19 |
| Props | 0-6 | $46.00 | −$46.00 |

CLV unavailable (`validClvN=0`).

---

## LEARNING

- Checkpoint windows roll; freezes must be scheduled + reconciled, not one-off PRs (#1264)
- Workers Cache can hide new feature fields for hours — bust keys on contract changes
- Arithmetic audit ≠ independent raw-source replay (audit v2)
- Props dominate tracker losses; spreads look strong but are operator tickets

---

## GOVERNANCE

No champion, coefficient, confidence-star, qualification, or wagering-authority changes this cycle.

---

## REMAINING BLOCKERS

| Blocker | Next action |
|---|---|
| #1264 merge + training R2 upload | Land after CI |
| PBP enrich not yet in prod snapshot | Runs on next feature-snapshot after #1264 |
| Trenches / special teams | Need authorized source or stay null |
| Independent replay PASS | Attach checksum + snapshot refs on every freeze |
| Market coverage 0 | Separate acquisition repair |
| QB prospective gate | Accumulate sample; no auto-promote |

---

## NEXT HIGHEST-VALUE DEVELOPMENT

1. Merge #1264; confirm training archive retrieval + 20-min reconcile keeps 12/12 across rolls.
2. Verify success/early-down/explosive flags after enriched snapshot publish.
3. Source decision for trenches/ST — never fabricate.
4. Price-paired economic evaluation for challengers (currently NULL).
