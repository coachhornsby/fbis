# Main changes absent from starting production

Production `739c6da30278c4364b64bb5f730942eab7f72d71` → audited main `be7911674d66d7facfecd176ce1aa2b73f3d61cb`. Every listed commit exists on main; absence from production is not lost work.

| Commit | Subject | Classes |
|---|---|---|
| f5cbd02593cf9d2efeffc7f2999cfd95bffe4a32 | Soccer Phase 3H-R: record controlled proof evidence | CODE_ONLY |
| 9b1202f6a5a99931ac24e87f1b6e7369aab0d789 | Soccer Phase 3H-R3: fix null-season canonical history filter | CODE_ONLY |
| a27101f406c7d2be7be41e0dbd1cc1fbfc562851 | Test Soccer null-season canonical history query | CODE_ONLY |
| 46a90e09fbb92dabb69034cec3f478e7ef67875f | Soccer Phase 3H-R3: prove null-season loader repair | CODE_ONLY, CONFIGURATION |
| a9b0c9a73853e08416015e57022b3ce1d85ad466 | CBB Phase B: move SportsDataverse bulk persistence out of Pages (#877) | CODE_ONLY, CONFIGURATION, MIGRATION |
| 0367c3ce0a4bafc509d640381331b9c54313f47f | Repair NHL shadow official event identity | CODE_ONLY |
| 22b25eb1f82b22685181b61d9fc3254355ccfd15 | Repair WNBA lineup substitution state corruption (#872) | CODE_ONLY |
| 97dc4b40aa6ef676df50e76162a13aa825427e3e | Quantify WNBA atomic lineup reconstruction repair (#883) | CODE_ONLY, CONFIGURATION, SCHEDULE_REQUIRED |
| e9a3fa91abdb439569ea153fd28c713c3efcd90d | Refine Tennis matchup card hero and recent form (#887) | CODE_ONLY |
| c430a5d4cb655010aea61f212cc9a37e856d2215 | NFL prop state: fix event linkage and freeze semantics (#880) | CODE_ONLY |
| c6472f204836bf5e55e982829a5bbd4ff57ba844 | Replay Tennis delta: .github/workflows/tennis-refresh.yml | CODE_ONLY, CONFIGURATION, SCHEDULE_REQUIRED |
| 061a377d541704d0e4183431fd42eb84949ac09e | Replay Tennis delta: api/tennis/analyze.mjs | CODE_ONLY |
| b808ac8bd8c3e95ed5dce911337ba4a207d39bb9 | Replay Tennis delta: api/tennis/batch.mjs | CODE_ONLY |
| 9475e2bb6036b4799578d4a06acb7765b46136f9 | Replay Tennis delta: api/tennis/liveApi.mjs | CODE_ONLY |
| 19768978036dc28bc561451ea79bc16ef9c47826 | Replay Tennis delta: api/tennis/log.mjs | CODE_ONLY |
| a74a4bc693be4c4850b3ee0389933cfd86a80065 | Replay Tennis delta: api/tennis/prizepicks.mjs | CODE_ONLY |
| 1442016beab2cff83e1fe0b34b226735e6c8ea22 | Replay Tennis delta: api/tennis/schedule.mjs | CODE_ONLY |
| dce978410bbbf28c94a273a63a57b88007013cc4 | Replay Tennis delta: build_tennis_index.sh | CODE_ONLY |
| 235f61751ee372b9b94d74f82889fc545d9af3f0 | Replay Tennis delta: docs/tennis-lyrid-authority-migration.md | CODE_ONLY |
| 0ce80096aefe842910dffc2fcb0b68070a50c279 | Replay Tennis delta: research/tennis/sackmann-source-recovery-audit-2026-10-07.json | CODE_ONLY |
| 598d2d0fd5e1b722d71497b431222076208bf0bc | Replay Tennis delta: scripts/tennis-auto-refresh.mjs | CODE_ONLY |
| d7f79cb5dde521def97ae2b454f0eae18529b105 | Replay Tennis delta: scripts/tennis-canonical-source-audit.mjs | CODE_ONLY |
| 7377d977c5a801b4eaaf0017fcfa3a6d110cbd32 | Replay Tennis delta: scripts/tennis-index-source-audit.mjs | CODE_ONLY |
| ce9e824bcdaa6b7cd19159519c2f16efed64e221 | Replay Tennis delta: tennis/TENNIS_HANDOFF.md | CODE_ONLY |
| 0a408db6865e83034342a6cf2c50e2d1f9dc0ed0 | Replay Tennis delta: tennis/backtest_smoke.js | CODE_ONLY |
| 93fff7d8e4f564a897cc6197448bc25c017e466e | Replay Tennis delta: tennis/canonicalMatchObservation.js | CODE_ONLY |
| a0601a41b9ef0168041f056870f79371aa3311d8 | Replay Tennis delta: tennis/oddspapiClient.mjs | CODE_ONLY |
| 2ce33d02d0805eee2ade6387bd2fb1170978f418 | Replay Tennis delta: tennis/oddspapiRunner.mjs | CODE_ONLY |
| 4d64f770c0a299a0fd27d85cadbd66df912515da | Replay Tennis delta: tennis/package.json | CODE_ONLY |
| 52d5df249c4171e87e0220fde04ef943cfc1f1cf | Replay Tennis delta: tennis/probe.mjs | CODE_ONLY |
| 62d4b98f9e7ca83ed7dc0e7bf8a8533511d110a1 | Replay Tennis delta: tennis/scan_smoke.js | CODE_ONLY |
| 15c086b7d450f15e5d244929c0ab5f2719a725c8 | Replay Tennis delta: tennis/smoke_test.js | CODE_ONLY |
| a2f882e6bee292e395a8fe700d91c0bf6914ab8b | Replay Tennis delta: tennis/sources/tennismylife.js | CODE_ONLY |
| 038e494417bf0991128980f31d835b16c3476270 | Replay Tennis delta: tennis/sources/tennismylifeRemote.js | CODE_ONLY |
| e6a68bd48b128a64f1d60cafa82b9f52cf2589ad | Replay Tennis delta: tennis/tennisAnchor.js | CODE_ONLY |
| ff73ab73b9534d8a105c07c1f75e6f8b2f9a688e | Replay Tennis delta: tennis/tennisApiTennis.mjs | CODE_ONLY |
| dc4dce51a7fd6889400fb9d8f847cd2e07a999bf | Replay Tennis delta: tennis/tennisBacktest.js | CODE_ONLY |
| 70f602ba3085ee7a6256b75e3e431878b8adfb34 | Replay Tennis delta: tennis/tennisClassify.js | CODE_ONLY |
| d19b36d26d94aa8751f227f887a4569e61b5a50b | Replay Tennis delta: tennis/tennisColdStart.mjs | CODE_ONLY |
| 12b7b48a7f2275debf687b4f2fc7c27f34ae957b | Replay Tennis delta: tennis/tennisContext.mjs | CODE_ONLY |
| 166e5a935e209f761b052fd1e77ac9eda8ca2eab | Replay Tennis delta: tennis/tennisElo.js | CODE_ONLY |
| c91fb2280ebd5cab4cb3bd4335798a6960ee7d6a | Replay Tennis delta: tennis/tennisFeatureBuilder.js | CODE_ONLY |
| 571d00bc43aaa27d7406e91f5d1d8594553b6633 | Replay Tennis delta: tennis/tennisFeed.js | CODE_ONLY |
| 14eeb9bc34a14bb02630733293114da2a161f485 | Replay Tennis delta: tennis/tennisLineLog.mjs | CODE_ONLY |
| f5889b90eab851d39e604d1fd02856bd8ea6fe11 | Replay Tennis delta: tennis/tennisLiveAugment.mjs | CODE_ONLY |
| 847937cd956db93497db258c03bd95b4d735261c | Replay Tennis delta: tennis/tennisMatchRead.js | CODE_ONLY |
| 6fe213d4d98c1b160897167029cb4034c0c8dc06 | Replay Tennis delta: tennis/tennisMatchstat.mjs | CODE_ONLY |
| 2642d76de7415ba25e45fba2ae8a1903eb4d388c | Replay Tennis delta: tennis/tennisNarrative.js | CODE_ONLY |
| 6cd80f16cebbfa3d46e7343ddeef51131e7bf721 | Replay Tennis delta: tennis/tennisObservationReconcile.js | CODE_ONLY |
| 1fb2f385c65948c41d05e5540011a62e9d52d8ed | Replay Tennis delta: tennis/tennisPriorsLog.mjs | CODE_ONLY |
| 69958398041970f9a6fc71853d61a38de5ccfbb5 | Replay Tennis delta: tennis/tennisProjector.js | CODE_ONLY |
| 1b9038ad78a59cd5e63cb807dd897ff873988b4f | Replay Tennis delta: tennis/tennisTotalGamesScan.js | CODE_ONLY |
| 0b78f7c6f88556fb2b1e894749ae2df0c5d56d31 | Replay Tennis delta: test/tennis-canonical-observation.test.js | CODE_ONLY |
| 403c0f4de1d578a27ca90b94a19fa6863e887f6e | Replay Tennis delta: test/tennis-player-index-integrity.test.js | CODE_ONLY |
| b1c0ee31ef776017fbb055689201ae50e8f83897 | Replay Tennis delta: test/tennis-source-acquisition.test.js | CODE_ONLY |
| 38f51d5399d6bd2587b4c0670c32db8113a8f7ad | Combine current-main and Tennis test coverage | CODE_ONLY |
| 371a14a1cebe12f31219cff96cf4f50a3e15c189 | MLB: add frozen-calibration pitcher K market replay (#886) | CODE_ONLY, CONFIGURATION |
| 6a46f0f97d1706734842c2ccd58082089bf86100 | Fix escaped Tennis test fixtures: test/tennis-canonical-observation.test.js | CODE_ONLY |
| 15d1e4588d9b7f34fa55ba77a5aa07341774db6c | Fix escaped Tennis test fixtures: test/tennis-source-acquisition.test.js | CODE_ONLY |
| 9cc08fd5f6f61d78f3f7b014d04161b6395ab264 | Normalize Tennis fixture escapes: test/tennis-canonical-observation.test.js | CODE_ONLY |
| 0ddf9190e5fab79307fa804cc4f32dc80f02725c | Normalize Tennis fixture escapes: test/tennis-source-acquisition.test.js | CODE_ONLY |
| 5c716975192e47415d061d685fa9f6f4386b244a | Gate NHL shadow ops on exact Pages production SHA | CODE_ONLY, CONFIGURATION |
| c5d26d1c09c87c8bb17e6f962b913a74791b78d9 | Merge Tennis authoritative migration and autonomous canonical refresh (#865) | CODE_ONLY |
| fd3f10f91ceacc77fc8d1873927faec9ed27d740 | [mlb-prop-evidence-smoke] MLB: settle Oct 6 finals (#891) | CODE_ONLY, CONFIGURATION |
| 8cde41b160faac7b7a31368c9044849b08e9eaf0 | CBB Phase B: rebuild empty snapshot table for transfer leakage QA (#893) | CODE_ONLY, MIGRATION |
| be7911674d66d7facfecd176ce1aa2b73f3d61cb | Allow verified descendant Pages SHA for NHL shadow ops | CODE_ONLY, CONFIGURATION |

These filename classes identify inspection scope; they do not prove a backfill is necessary. Tennis #865 adds an autonomous refresh workflow and production state/source governance; its API-token/state requirements require its own runtime evidence. Tennis UI #887 is code-only and requires deployment plus visual verification. 0096 requires governed migration completion. Open PRs are not treated as merged source.
