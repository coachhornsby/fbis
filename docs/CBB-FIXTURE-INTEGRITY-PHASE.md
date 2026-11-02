# FBIS CBB fixture integrity and benchmark reconciliation

Reconciled the private FanMatch screenshot transcription against the saved 182-event ESPN slate and provider identities, without provider requests. The result is historical snapshot evidence, not a live schedule certification.

All 19 previously unmerged spelling candidates resolve using existing exact source/team identities and 13 explicitly reviewed additional aliases for non-D1 opponents. No fuzzy matching. Of 181 KenPom rows, 180 match ESPN fixtures. Paine at Jacksonville remains an opponent conflict with ESPN/Torvik's Trinity College of Jacksonville. Northern Illinois–Grambling remains absent from the KenPom benchmark; benchmark absence alone does not invalidate an ESPN fixture.

Seven ESPN fixtures receive research holds: three starts before 9 AM Central require official confirmation; one opponent conflict; three source start differences (West Florida 60 minutes, Seattle/Hawaii one minute, SUNY Old Westbury/Stony Brook one minute). These are conservative unverified-data holds, not declarations of cancellation, incorrect source or market closure. Original clocks and opponents remain intact.

Added a pure fixture-evidence check in the private projection producer. Evidence must match event ID, date and full fixture key, be within six hours and not from the future. Holds suppress primary and comparison forecasts. Missing evidence in a supplied slate, changed fixtures and inconsistent records also suppress numbers. Existing direct callers can omit the optional evidence argument for compatibility; the dated offline build command now requires a fixture-evidence file argument. This adds no production HTTP route, D1 reader or collection schedule.

The private evidence is bound to the specific captured fixture. Its reported screenshot time is approximate (06:43 UTC November 2); it cannot be used to assert historical knowledge before that capture. Do not use this evidence to backdate projections or silently carry it to future slates. Regenerate after supported schedule corrections. No new projections were published or regenerated in this phase.

Validation: 19 Python tests pass (4 new fixture tests plus 15 prior identity/schema tests) and 19 Node tests pass (private projections, frozen CBB-PRO and static board isolation). Raw screenshots, transcripts, benchmark numbers and detailed reports remain in private Drive. Development only; no deployment or collector restart.

## Reproduction

The saved inputs are artifacts/cbb-fixture-integrity/fanmatch.csv and reconciliation.csv, plus the verified existing ESPN capture and provider profiles. Run `PYTHONDONTWRITEBYTECODE=1 python scripts/cbb-fixture-integrity.py`. For a later permitted private projection build, supply verified generation UTC time and the generated fixture-evidence.json as the third command argument to scripts/build-cbb-projection-packet.mjs; source expiry and future-capture gates still apply.

## Prompt for Grok

FBIS only. Prioritize official-source confirmation for Jacksonville's November 2 opponent (Paine versus Trinity College of Jacksonville), the Northern Illinois–Grambling, Merrimack–App State and Winthrop–Queens start times, and the West Florida, Seattle/Hawaii and Old Westbury/Stony Brook time differences. Use official team/venue/conference schedules, preserve source timezone and event IDs, and return evidence rather than silently correcting data.

Upload your already-captured Heritage, Kalshi and Polymarket US market snapshots to private FBIS_Data with retrieval timestamps, exact contract IDs/rules, prices, sizes and pagination/completeness status. Keep International Gamma data separate. Identify Kalshi key scopes through read-only metadata or an owner-provided settings view; do not test permissions by placing/canceling orders. No credentials in deliverables. No new bulk pulls, recurring jobs, production changes or wagers.

Then continue the 63-record ambiguous player-identity queue and source-linked availability/starting-lineup evidence. Use the existing private queue, preserve uncertainty, and post results with Drive links in the handoff. I retain engineering/model integration.
