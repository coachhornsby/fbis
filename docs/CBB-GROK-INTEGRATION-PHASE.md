# FBIS CBB: delivered history integration and zero-write repair

This development phase verifies Grok's delivery and stages private research inputs. It does not reopen collectors or change projections. Seven sports and the existing CBB-PRO contract remain unchanged.

## Completed data work

Three Drive archives and all 61 member files passed independent byte-size and SHA-256 checks. Restored 113,882 historical player-game rows, with no duplicate (Torvik player ID, game ID) keys and exact scoring identity across every row: 2×two-point makes + 3×three-point makes + free throws = points. Every player-game row has 53 fields and season 2026, with dates in the prior season. All 4,978 player-season rows have 67 fields and season 2026.

The staged outputs contain 4,979 historical player/team summaries, 5,543 current roster records, 444 offseason context rows and source-scoped identity crosswalks. Exact reviewed aliases resolve all 365 TeamRankings and 79 On3 team rows. One historical Torvik name, Saint Francis, remains unresolved against the current registry; historical membership must be checked before attaching a current ID.

There are 2,894 unique normalized-name player candidates, 63 ambiguous roster-name matches and 2,586 current players without a prior-name match. None is a verified cross-provider player identity. Missing history does not mean freshman, zero contribution, transfer or departure. The two Torvik historical files disagree on membership: 59 game-file player IDs are absent from the season-summary file, while 58 season-summary IDs have no player-game rows. Do not silently drop those records.

Scoring arithmetic is validated. Usage, minutes percentages, BPM and other inferred positional columns are not promoted into model inputs. No expected minutes, availability adjustments, continuity percentages or roster-impact coefficients were invented. All player candidate outputs keep availability UNKNOWN and productionAdjustment null.

Grok's slate reconciliation matches all 182 private ESPN events one-to-one. We independently checked event IDs, away/home names, start instants, Central dates and neutral flags against our frozen packet. The extra Torvik record is Wayne State (MI) at Detroit Mercy, absent from that ESPN capture and without a verified start. This is reconciliation of captured evidence, not live schedule verification.

Independent calculations reproduced the supplied external Torvik backtest's counts, margin/total MAE and Brier score for all-game and D1-only groups. This does not establish original pregame snapshots, FBIS performance or market profitability.

## Zero-write patch disposition

Grok's added regression fails on current unpatched code: failed CBB endpoints and zero successful writes can still report success. The narrower repair makes such a run failed, retains partial endpoint/write-failure reporting for CBB, and preserves CFB status behavior. Existing failure caching is retained; removing it is not necessary for the reproduced reporting bug and could increase repeated requests. The unused expectedGames heuristic is omitted: expected fixtures alone do not establish required new writes, especially on idempotent replays.

This repair corrects reporting. It does not prove why the original historical jobs wrote zero rows, restore missing data, or enable collectors. No original incident runtime logs were supplied.

## Reproduction and validation

Private verified bundles must already be restored beneath artifacts/cbb-grok-integration/restored. Existing verified current provider profiles and ESPN roster captures remain required.

Run `node scripts/cbb-grok-identity-registry.mjs`, then `python scripts/cbb-grok-stage.py`. All staging is offline; output stays under ignored artifacts. Raw data, research outputs and archives must not enter the public repository or static site.

Six Python regression tests cover ambiguous team identities, name-only player candidates, duplicate names, suffixes, scoring identities, seasons, dates, schema widths and duplicate player games. Fifty-one offline college tests pass. The supplied status-only patch also passed 51 tests in a separate worktree before narrowing its scope.

## Next model phase

Resolve cross-provider player IDs using supporting identity evidence, validate minutes/usage columns against authoritative definitions and records, investigate historical file coverage gaps, then build a roster-aware preseason challenger with point-in-time evaluation. TeamRankings RETURN/TRANSFER are provider model components; its combined rating includes market influence. On3 missing coverage stays unknown. No generic provider-roster penalty should double-count preseason information already present in KenPom.
