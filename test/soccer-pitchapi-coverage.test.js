import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PitchAPI sync refreshes competition QA counters from persisted rows", async () => {
  const store = await readFile(new URL("../functions/lib/soccerPitchApiStore.js", import.meta.url), "utf8");
  const sync = await readFile(new URL("../functions/api/soccer-pitchapi-sync.js", import.meta.url), "utf8");
  assert.match(store, /refreshPitchApiCompetitionCoverage/);
  assert.match(store, /pitch_match_count/);
  assert.match(store, /advanced_rows/);
  assert.match(store, /status='finished' AND raw_advanced_json IS NOT NULL/);
  assert.match(store, /advanced_coverage/);
  assert.match(store, /history_start/);
  assert.match(store, /home_network_centralization IS NOT NULL/);
  assert.match(sync, /refreshPitchApiCompetitionCoverage/);
  assert.match(sync, /coverageRefresh/);
});

test('model history omits raw payloads while retaining all scalar model evidence and cutoff',async()=>{
 const {loadPitchApiHistory,PITCHAPI_MODEL_HISTORY_COLUMNS}=await import('../functions/lib/soccerPitchApiStore.js');
 let sql,binds;
 await loadPitchApiHistory({DB:{prepare(q){sql=q;return{bind(...args){binds=args;return{all:async()=>({results:[]})}}}}}},
  {leagueKey:'ger.1',startDate:'2021-01-01',beforeDate:'2026-10-17'});
 assert.doesNotMatch(sql,/SELECT \*/);assert.match(sql,/CASE WHEN raw_advanced_json IS NULL THEN NULL ELSE home_ppda END AS home_ppda/);
 for(const key of ['home_xg','away_ppda','home_network_centralization','away_npxg','home_xg_open_play','start_time'])assert.ok(PITCHAPI_MODEL_HISTORY_COLUMNS.includes(key),key);
 assert.deepEqual(binds,['ger.1','2021-01-01','2026-10-17']);assert.match(sql,/status='finished'/);
});
