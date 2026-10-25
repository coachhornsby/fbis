# Projection delivery repair — phase 2 — 2026-10-25

Baseline production SHA: `709f1f8b1074259f4bfefa7c7772a6c7e75c1f6b`.

The previous acceptance audit found 388 NHL contracts but zero independent player model rows. Investigation reproduced two defects in the existing official NHL source adapter:

1. `skaterRows` invoked `clockSeconds` without defining or importing it. Any nonempty skater response threw a ReferenceError, and `loadNhlProV2Context` caught it and replaced the entire source context with trained team priors and an empty skater map.
2. Official skater summaries use `teamAbbrevs`, including the singular value `ANA`; `teamAbbr` did not read that field. Even after fixing the exception, these records would be discarded without a team.

The repair defines a bounded time parser for numeric seconds and M:SS source representations. It reads single-team `teamAbbrevs` values, and does not guess a team from a comma-separated season aggregate. Existing rate calculations, prior/current weighting, player-share model, coefficients, versions, champions and wagering gates are unchanged.

A regression fixture uses the retained official summary fields for player 8473986: 11 games, 19 shots, 2 goals and 3 assists. The complete official-context loader now delivers that athlete to the existing NHL player model and then to canonical prop rows for shots, goals, assists and points. Numeric TOI and M:SS are checked. A multi-team aggregate stays unassigned.

Validation: 55 focused tests passed; the main npm test suite passed 2,207 tests with zero failures. Build passed. Release evidence and post-release production counts are recorded on the associated PR after deployment.

## Other source findings

NFL's excluded Kirk Cousins forecasts were tied to ATL while the retained current roster places player 14880 at LV. Those forecasts must not be joined to an ATL contract by name or moved to another game. Source-owned forecast generation needs current roster filtering before a future capture; this patch does not rewrite historical forecasts or crosswalks.

NBA stale rows retain their original feature cutoff. The existing scheduled NBA prospective workflow can regenerate from approved current data; no timestamp-only freshness repair is performed. Current roster status and old forecast age are separate evidence.

The tennis consensus identifier and source quote-clock blockers from phase 1 remain open. This phase does not fabricate prices, references, forecasts or authority, and claims no accuracy or ROI gain.
