# CBB-PRO-v1 Production Contract

Canonical implementation: `functions/lib/cbbProModel.js`.

- Side gate: absolute KenPom-vs-market disagreement >= 4.0, CBBD confirms same side, absolute market spread < 20.
- Sub-4 candidates are rejected.
- Retained tags: CBBD >=2, CBBD >=3, KenPom >=6, models within 2/1, neutral site, underdog.
- Total projection: `FBIS-CBB-v2-TOTAL`, a frozen residual correction on the independent native FBIS total. It is a production projection only; totals cannot QUALIFY or authorize wagers.
- Frozen research input: `cbb-enriched-v2026.10.02`.
- Dataset SHA-256: `10d2e1af07ac31d6b6174b9cda37eb63aa8785a9050cfede0c8c1ccce52933f9`.
- Automatic wager authorization remains disabled pending price-aware validation.

## FBIS v2 total validation

- Training: 2018–22 only; ridge lambda selected by leave-one-season-out.
- 2023–24 validation: corrected MAE **13.5092** vs KenPom **13.5758** (+0.0666 points).
- 2025 confirmation: corrected MAE **14.4553** vs KenPom **14.8974** (+0.4421 points).
- Margin correction failed the KenPom benchmark and remains disabled.
- Market-confidence layer failed; total wager qualification remains disabled.
