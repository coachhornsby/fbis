# CBB-PRO-v1 Production Contract

Canonical implementation: `functions/lib/cbbProModel.js`.

- Side gate: absolute KenPom-vs-market disagreement >= 4.0, CBBD confirms same side, absolute market spread < 20.
- Sub-4 candidates are rejected.
- Retained tags: CBBD >=2, CBBD >=3, KenPom >=6, models within 2/1, neutral site, underdog.
- Total engine is separate: 50/50 KenPom + CBBD projected total; 145-155 market-total / >=4 edge is research-only.
- Frozen research input: `cbb-enriched-v2026.10.02`.
- Dataset SHA-256: `10d2e1af07ac31d6b6174b9cda37eb63aa8785a9050cfede0c8c1ccce52933f9`.
- Automatic wager authorization remains disabled pending price-aware validation.
