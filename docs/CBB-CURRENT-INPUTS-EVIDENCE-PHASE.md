# FBIS CBB current Torvik inputs and Grok evidence delivery

Refreshed two public Torvik CSV feeds and generated a private current-comparison packet. Integrated the newly delivered Grok research archive without converting silence, media reports or name-only leads into verified availability.

## Current provider comparison

Two bounded manual public requests returned HTTP 200: `2027_team_results.csv` and `2027_fffinal.csv`. Each was byte-bounded, captured with its real receipt time/server Date/hash, and not retried. Existing adapters normalized 365 ratings teams and 365 factor rows; all 365 ratings map uniquely to current canonical D1 IDs. Normalized ratings pass positive finite efficiency/tempo checks. Four Factors remain research context; this phase does not add them as coefficients or treat zero placeholders as measured signal.

Ratings captured November 2 at 16:42:39 UTC (10:42 AM Central), with the existing six-hour source-age limit expiring at 22:42:39 UTC (4:42 PM Central). A later evening use requires a later permitted capture. A retrieval timestamp does not certify the provider's underlying model update time; both are distinct concepts.

Two more bounded public ESPN scoreboard requests captured 16:44:51–16:44:54 UTC. The private comparison packet evaluates the November 2 Central-date slate at 16:44:55 UTC: 182 fixtures, 115 available Torvik comparison forecasts, zero qualified wagers. Started games, stale/future scoreboards, missing provider teams, unverified venue and the West Florida classification hold suppress comparison output. Duplicate events and provider/season/capture identity mismatches reject generation.

`functions/lib/cbbTorvikPrivateComparison.js` uses the existing Torvik rating formula. It does not substitute Torvik for the KenPom primary, manufacture CBBD confirmation, refresh the old primary packet, change frozen CBB-PRO coefficients or publish predictions. All outputs remain private. Availability is UNKNOWN and every qualification/order flag remains false.

## Grok evidence integration

The 328,297-byte source archive matches SHA-256 `76aa8ebef859d5e54f757b30259b13819ad425f4d82ab062779ef342f50ba24e`; all 16 content members pass its internal manifest (17 archive members including manifest). Drive permissions are owner-only. Archived scripts are never executed.

- All 354 UNKNOWN team rows bind to 177 known fixtures and the supplied scoreboard's exact side/team ID/name; zero rejected rows. These are producer-reported source checks, not official player availability or independently recaptured summary responses. Missing injury entries and lineups do not establish a healthy/active player.
- Twenty bio lead rows bind to our exact prior ESPN/team/Torvik-lead queue. Twelve carry Grok-reported official-bio corroboration, eight remain unconfirmed. The other 43 ambiguous identities are unchanged. No automated cross-provider player-ID promotion.
- Independently browsed Patrick O'Brien's official Bucknell bio and Caleb Williams's official Georgetown bio. Their 2025-26 appearances (21 and 33) agree with the saved same-team Torvik candidates. A private review receipt records those two checks. This corroborates the historical bio/count claim; it does not establish current health or change model weights.
- Twenty-two targeted claim rows remain private research. They lack exact player IDs and/or current official, timestamp-bound evidence; no official player-availability records were accepted. Conflicts and old media dates remain intact.
- Four Kalshi raw files are byte-identical to the earlier saved capture. Spread/total cursors remain incomplete; the early CSV's raw page chain was not saved. No new market capture occurred and no historical gaps were filled with later quotes.

## Reproduction

Private input layout: `artifacts/cbb-current-evidence/` contains the pinned source archive, manually captured `torvik-refresh/` CSVs/capture metadata, fresh `scoreboard/` JSONs/capture metadata and the independently reviewed bio receipt. Prior verified roster/history/fixture/market research outputs remain at their existing private paths.

```sh
PYTHONDONTWRITEBYTECODE=1 python scripts/cbb-grok-current-evidence.py
node scripts/cbb-refresh-torvik-offline.mjs
node scripts/build-cbb-torvik-private-comparison.mjs 2026-11-02T16:44:55Z
```

These commands normalize or evaluate saved data only; they make no provider or D1 requests. New real-time uses require genuine new capture metadata, not a changed timestamp. No raw provider values, forecasts, claim records or player research are committed to the public repository.

Validation: three new Python evidence-binding tests and four new Node comparison tests, plus existing CBB suites (29 Python and 37 Node tests). Whitespace checks pass. No frontend changes, recurring collection, paid model calls, main merge or production deployment.

## Remaining work

KenPom primary and CBBD confirmation were not refreshed: their prior runtime capture used a consumed single-use permit and the route has been removed from the static deployment. Do not reuse that permit, expose stored secrets, or relabel old inputs. A new narrow secure-runtime capture remains separate work. Private Torvik comparisons are useful current research and do not complete the primary projection cutover.

Grok should prioritize the reported injury leads by obtaining exact current roster IDs and direct official source wording/publication times. Probable starters cited by a secondary article remain reported until the actual official game notes/lineup source is read. Official previews without injury statements do not create ACTIVE records. Return evidence privately in the availability schema already documented. Continue the eight unconfirmed same-team bios and the three game-count discrepancies; no broad re-pulls of old markets or new recurring jobs.
