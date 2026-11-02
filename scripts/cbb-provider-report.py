"""Render FBIS provider inventory and CBB operating contract from local evidence."""
import pathlib,json,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1];P=ROOT/'artifacts/cbb-provider-mission';j=json.loads((P/'provider-inventory.json').read_text())
summary=json.loads((P/'capture-summary.json').read_text())if(P/'capture-summary.json').exists()else None
actual={r['provider']+':'+r['name']:r for r in (summary or {}).get('records',[])}
cp={'/teams/directory':'directory','/teams/roster':'roster','/ratings/adjusted':'adjusted-current','/stats/team/leaderboard':'team-leaderboard','/games/teams':'game-teams-current'}
lines=['# FBIS CBB — provider inventory and system handoff','',
'As of November 2, 2026 UTC / November 1, 2026 Central. FBIS only; no FMIS work. Season 2027 means 2026–27.',
'',
'## Read this first',
'',
'This lists the documented data surfaces, what FBIS actually captured, what the source code requests, the consumer, and the reason for not collecting the rest. Documented availability does not prove paid-account entitlement or a successful import. An adapter in GitHub does not prove that a collector is running. No recurring provider collectors were resumed.',
'',
'Coverage: all 40 GET paths in the current CBBD OpenAPI schema; all 11 endpoints in KenPom’s official API documentation; 23 data families in the toRvik author’s reference; additional KenPom subscriber-page features. Torvik does not supply a verified complete public API contract here, so undocumented site tables are not represented as guaranteed pullable. Website membership and API access are separate.',
'',
'## Captured and verified',
'',
'- ESPN, separately from these three providers: 365 current-season team rosters, 5,543 players. Exact season/team IDs validated. Availability remains UNKNOWN.',
'- CBBD current roster response contains 1,544 program entries. Filtering against its verified 365-team Division I directory yields 365 teams and 5,541 players. Two ESPN-only records were retained and logged, not deleted: Channing Francis (cbb-2099) and Trey Lewis (cbb-2640). Non-Division-I entries are archived but excluded from the operating D1 store.',
'- KenPom seven-feed capture: 365 teams per feed, all 365 matched, including coaches/arenas. 363 teams have zero played games; the normalized importer retains preseason ratings/height context but nulls their placeholder game-derived statistics.',
'- CBBD current adjusted ratings are HTTP 200 with zero rows; prior-season adjusted ratings contain 365 teams. The bounded current box/leaderboard responses contain two team records (one game). No prior-season rating is relabeled current and no full CBB production readiness is claimed.',
'- Torvik current ratings: 365 rows, 365 distinct CBB IDs, zero unresolved.',
'- Torvik current four-factor CSV: 365 rows, 365 distinct CBB IDs, zero unresolved; all eight core four-factor fields present for all 365 teams. Also includes two/three-point offense/defense percentages.',
'- Earlier roster/ratings archive was independently downloaded and restored in SQLite. Its Drive ID is 1m3bPodgfT-ESQBstwKG4T8X6D0C5V8Jk.',
'- New merged Torvik archive: https://drive.google.com/file/d/1tJASpVptiIUlnTLFb3aTi8UrME1CCMWp/view . Independently downloaded, all member hashes checked and 365 rows restored into isolated SQLite.',
'- Authenticated raw archive: https://drive.google.com/file/d/1zMC-68JGjYO3-Xly02SXZrO7SbxfnVVB/view . Independently downloaded, all 19 member files checked, and all 730 normalized KenPom/CBBD provider rows restored with matching hashes.',
'- Current compact team store is CBB_DB.cbb_current_team_inputs, primary key (season, team_id). Merged Torvik ratings/factors also have 365 verified rows in cbb_current_provider_inputs, keyed by (season, provider, team_id), with zero readback mismatches. These remain staged evidence, not an approved production cutover.',
'']
if summary:
 lines+=['Authenticated runtime capture: '+str(summary.get('attempts',0))+' provider network attempts. Results below are from durable receipts, not inferred from configured key names.','']
 for r in summary.get('records',[]):lines.append('- '+r['provider']+' / '+r['name']+': HTTP '+str(r.get('status',0))+'; rows '+str(r.get('rows',0))+'; '+str(r.get('reason')or r.get('error')or('captured'if r.get('sha256')else'not captured'))+'.')
else:lines+=['KenPom and CBBD current imports: UNVERIFIED until the bounded runtime capture finishes. Do not label these feeds live or complete.','']
lines+=['## KenPom — all documented API feeds','',
'Authentication: stored Bearer API credential; ending-year parameter y=2027. The recurring adapter requests ratings, four-factors, pointdist, height and misc-stats and caches them for six hours when its code is executed; the board’s current static release does not execute that adapter. Archive and FanMatch have separate research/comparison readers. The one-time recovery also requests team metadata and preseason archive.',
'']
for e in j['kenpom']:
 r=actual.get('kenpom:'+e['endpoint']);state=e['status']
 if r:state+='; latest attempt HTTP '+str(r.get('status',0))+', '+str(r.get('rows',0))+' rows'+('; '+str(r.get('reason')or r.get('error'))if r.get('reason')or r.get('error')else'')
 lines+=['### '+e['endpoint'],'','- Available: '+e['availableData']+'.','- Pull status: '+state+'.','- Use / exclusion: '+e['useAndExclusion'],'- Exact documented fields: '+', '.join('`'+x+'`'for x in e['fieldNames'])+'.','']
lines+=['## KenPom — member pages outside the documented API','',
'The official member tour also shows the following surfaces. We are not automatically scraping them. No API endpoint or entitlement is invented for a website feature. Existing access rights must permit automation; do not purchase another plan or bypass a login/bot block.','']
for e in j['kenpomWebOnly']:lines.append('- '+e['surface']+': '+e['why'])
lines+=['',
'Exact use distinction: adjusted offense, defense and tempo drive the KenPom-derived FBIS side score. Four factors support matchup evidence/shadow comparisons. Point distribution, height/experience/continuity and miscellaneous statistics are retained/exposed as context and research; they are not all numerical inputs to CBB-PRO-v1. FanMatch predictions are benchmark-only. Raw archived response fields and ranks are not automatically used as model features.',
'',
'## Torvik — documented data families','',
'Current adapter sources are https://barttorvik.com/2027_team_results.csv and https://barttorvik.com/2027_fffinal.csv. The adapter’s 24-hour cache is not an active schedule. Only these two current team feeds are verified in this mission. The remaining families below are documented by the toRvik package author; their live access, historical depth and automation permissions are unverified here. No scraper was installed or run.','']
for e in j['torvik']:
 state='captured and verified, 365 teams'if e['dataset']=='bart_factors'else e['status']
 lines+=['### '+e['dataset'],'','- Available: '+e['availableData']+'.','- Pull status: '+state+'.','- Use / exclusion: '+e['useAndExclusion'],'']
lines+=['Torvik normalized fields currently retained: team, conference, games, adjOe, adjDe, tempo, barthag, wab, source; four-factor fields efgPct, efgPctD, tovRate, tovRateD, orbRate, drbRate, ftr, ftrD; twoPtPct, twoPtPctD, threePtPct, threePtPctD. Canonical/ESPN identity and source timestamps are attached separately. Raw team-results CSV contains additional ranks/projections/SOS columns; they are archived, but the current normalizer does not feed all of them into the model. A Torvik projection is not an independent FBIS-native feature.',
'',
'## CBBD — all 40 documented GET endpoints','',
'Authentication: stored shared college-data Bearer credential, with durable request reservations, daily/monthly caps and provider-remaining stop. The current schema and 1,405 field paths are included in provider-inventory.json and cbbd-field-dictionary.csv. Each row below states the operating decision; exact fields and required/optional parameters are in those machine-readable appendices. No endpoint was probed merely to see what it returns.',
'',
'CBBD IDs are provider scoped; directory sourceId / roster teamSourceId and exact school mappings must establish the ESPN/canonical crosswalk. Never treat a CBBD teamId as an ESPN ID. /teams/directory returns an object containing teams/conferences, unlike array response feeds. /ratings/adjusted does not document tempo: the existing baseline uses 68 when no pace is present. That is a model assumption, not a measured CBBD pace value. Do not advertise it as observed data.',
'',
'Current game/team statistics are date-bounded. Provider game/game-team/player result caps mean a single full-season response does not establish completeness. Historical imports need stable windows, cap detection, ID deduplication and manifests; do not restart broad scans or count jobs.','']
for e in j['cbbd']:
 r=actual.get('cbbd:'+cp.get(e['endpoint'],''));state=e['status']
 if r:state+='; latest attempt HTTP '+str(r.get('status',0))+', '+str(r.get('rows',0))+' records'+('; '+str(r.get('reason')or r.get('error'))if r.get('reason')or r.get('error')else'')
 params=', '.join(p['name']+(' [required]'if p['required']else' [optional]')for p in e['parameters'])or'none'
 lines+=['### GET '+e['endpoint'],'','- Pull status: '+state+'.','- Use: '+e['use']+'.','- Why / constraint: '+e['whyOrConstraint'],'- Parameters: '+params+'.','- Documented response fields: '+str(len(e['responseFields']))+' paths; see exact field dictionary.','']
lines+=['## How the CBB system works','',
'1. Identity and roster layer. The canonical registry now contains 365 CBB teams; Queens (2511), Southern Indiana (88), and Lindenwood (2815) were added from verified ESPN records. Miami FL/OH now resolve to basketball IDs instead of football IDs. Team/player IDs are source scoped. Current membership, source timestamp, season and unknown health status are stored separately.',
'',
'2. Provider layer. KenPom, Torvik and CBBD adapters normalize their own ratings/context. They remain separate comparators, not three independent votes. They observe many of the same games; statistical independence has not been established. Market lines are for comparison and decision gates, not inputs to the independent native efficiency fit.',
'',
'3. Side projection. Current frozen contract is CBB-PRO-v1, version v1.1.0. The side score is FBIS’s formula applied to KenPom adjusted team ratings, not a copy of FanMatch and not a wholly independent FBIS rating system. It compares the KenPom-derived spread with the market. A side candidate needs at least four points of disagreement, CBBD confirmation on the same side, and absolute market spread below 20. Subset tags do not lower that gate. Historical selected-row prices were unavailable and assumed -110 accounting does not establish live profitability. No automatic wagers are authorized.',
'',
'4. Ratings formula. Expected possessions are the arithmetic mean of team tempos. Expected home efficiency = home AdjOE × away AdjDE / national efficiency; away uses the reverse pairing. Points = expected efficiency × possessions / 100, with neutral/home-court treatment. Total = home + away; margin = home − away. Wrong-scale or missing required inputs must fail closed. The CBBD baseline fallback tempo is a disclosed assumption, not observed pace.',
'',
'5. Independent native model. FBIS-CBB-RATINGS-v2 v2.0.0 derives opponent-adjusted offense/defense, pace, schedule strength, conference strength, matchup terms and home-court estimates from prior completed CBBD game/team box scores. KenPom ratings, Torvik ratings and sportsbook lines are prohibited inputs. Enforce the pregame cutoff; do not use final-season or postgame information as a historical pregame feature. Current season opening creates an evidence shortage, not permission to fabricate current games or injuries.',
'',
'6. Total projection. FBIS-CBB-v2-TOTAL adds its frozen residual correction to the native total. Retained artifact results: 2023–24 validation MAE 13.5092 versus KenPom 13.5758; 2025 confirmation MAE 14.4553 versus 14.8974. These are repository artifact results, not a fresh independent rerun or verified live edge. The market-confidence qualification failed, so totals remain PROJECTION_ONLY and cannot qualify wagers. The rejected native margin correction remains disabled. The residual model retains its frozen feature-imputation behavior; no claim is made that every optional residual feature is observed.',
'',
'7. Player/roster research is separate. Repository code includes season/recent player context and player-prop/possession research. Current roster capture alone does not supply verified injuries, expected minutes, confirmed starters or a validated per-player adjustment to the main side/total score. Missing availability stays UNKNOWN. Do not silently label all players healthy. Props do not inherit game-line approval.',
'',
'8. Operating board. The website was reopened for schedules/scores with seven sports: NFL, CFB, NBA, CBB, NHL, MLB and Tennis (ATP/WTA views, shared tennis storage). CBB current inputs are staged in dedicated CBB_DB; the production CBB data cutover/prediction publication is not certified by the existence of that table or by passing unit tests. Current provider captures do not themselves finalize the CBB projection system.',
'',
'9. Storage and cost. Keep compact current team/player/features, fixtures and settlement indices in CBB D1. Keep immutable raw payloads, compressed history, source/schema manifests and recovery evidence under private FBIS_Data in Google Drive. Archive→download→hash→restore validation precedes any deletion. Drive is batch/archive storage, not the public site’s request-time database; no Drive credentials in browser code. No new paid subscription or OpenAI/Gemini model call is required for these data pulls. Cloudflare ceiling remains $10/month including fixed charges/storage/usage/tax; alerts alone are not a hard cap.',
'',
'10. Runtime import and containment. A short-lived operator route runs the existing stored credentials in the runtime, rather than expecting static builds to receive them. It allows one durable capture, up to six college-data and seven KenPom requests, no retries, bounded response sizes, expiry, and authentication/quota stops. Existing never-attempted CBBD reservations can be atomically claimed without erasing their cost. A temporary internal relay may invoke the capture once; remove its trigger and worker, remove the operator route, and return to static-only deployment when complete. This is not approval to restart the paused collector fleet.',
'',
'## Implementation checks','',
'106 relevant tests pass. Added the real SQLite quota-ledger CHECK regression, zero-game KenPom placeholder handling, exact provider/season/team lookup tests, missing-input gates, one-use/expiry/authentication/stop tests and a CBBD directory-envelope test. The native reader now refuses a response at the provider 3,000-row cap rather than silently fitting an unproven full season; the collector still needs date-partition completeness before production.',
'',
'## Corrections for Grok’s earlier CBB note','',
'- VERIFIED from current repo: CBB-PRO-v1 v1.1.0 is the retained main game projection contract. Earlier CBB-ENSEMBLE-v1 / CBB-BET-v1.0 labels are not the current contract.',
'- VERIFIED from live recovery: the large history/duplicate retirement phase reduced the last measured all-D1 footprint to about 9.003 GB, and current CBB_DB is about 0.568 GB. The earlier statement that the CBB operating database was stuck at a 10 GB limit is stale. These measurements do not certify the current bill.',
'- VERIFIED from current captures: team/roster and Torvik coverage have changed. An empty tracker tab is not evidence that these source datasets are absent.',
'- Historical Heritage tickets and screenshots remain retrospective betting records, not pregame model calibration or verified closing-line evidence. No edge is established from them.',
'',
'## Grok’s role and next actions','',
'Use this inventory and exact source timestamps when writing FBIS CBB intelligence. Log primary links, event time, received time, player/team identity, claim status and source in the FBIS research ledger. Prioritize official injury/availability and starting-lineup evidence missing from the numeric providers. Keep third-party picks and provider predictions labeled as research opinions/benchmarks. Do not change model weights, start collectors, purchase access, mutate production data or authorize wagers based on this message. Do not mix this work into FMIS.',
'',
'## Field dictionary and catalog files','',
'- Full provider catalog: https://drive.google.com/file/d/1k9d5k_kBNoQlFrO6W2WcTGoKqj3w2pGU/view',
'- Exact CBBD field dictionary: https://drive.google.com/file/d/1wj2FKeJy_ic-TB1VWqDJllhBLkKBqu-V/view','',
'## Sources and implementation evidence','',
'- KenPom official API: https://kenpom.com/api-documentation.php',
'- KenPom member tour: https://kenpom.com/tour.php',
'- CBBD exact current schema: https://api.collegebasketballdata.com/api-docs.json',
'- CBBD availability: https://api.collegebasketballdata.com/data-availability',
'- Torvik captured ratings: https://barttorvik.com/2027_team_results.csv',
'- Torvik captured factors: https://barttorvik.com/2027_fffinal.csv',
'- toRvik author reference: https://torvik.sportsdataverse.org/reference/index.html',
'- Repository: functions/lib/collegeApply.js, kenpomCbb.js, torvikCbb.js, cbbRatings.js, cbbFbisRatings.js, cbbFbisV2Total.js, cbbProModel.js, cbbPlayerFeed.js, cfbCfbdAcquisition.js; data/models/cbb-pro-v1.json.',
'- Supplied FBIS_Drive_Upload.zip was inspected as a legacy source inventory (237 entries). Historical scripts were not executed or activated. The uploaded Home Court Ratings PDF does not override the frozen model’s home-court contract.',
'']
text='\n'.join(lines);(ROOT/'docs/CBB-PROVIDER-INVENTORY-20261102.md').write_text(text);(P/'handoff-entry.txt').write_text('FBIS CBB PROVIDER INVENTORY — ChatGPT/Codex — '+text)
print(json.dumps({'reportBytes':len(text.encode()),'characters':len(text),'authenticatedCaptureIncluded':bool(summary)}))
