import test from 'node:test';
import assert from 'node:assert/strict';
import { mapNbaFrozenPregameModels } from '../functions/lib/nbaFrozenPregameModels.js';
const before='2026-10-24T22:00:00.000Z';
const start='2026-10-25T00:00:00Z';
const player={sport:'nba',player_id:'5061568',player_name:'Carter Bryant',team_key:'SAS'};
const row={game_id:'401909858',player_id:player.player_id,player_name:player.player_name,team:'SA',market_type:'three_pointers_made',projection:1.3,sigma:1.1,
 model_id:'NBA-PLAYER-PRO-v1',model_version:'v1',start_time:start,created_at:before,feature_cutoff_timestamp:before,
 home_abbr:'DAL',away_abbr:'SA',availability_status:'AVAILABLE',projected_minutes:18};
test('NBA pretip persisted player forecasts map by exact player ID, event, and canonical roster',()=>{
 const out=mapNbaFrozenPregameModels([row],[player]);assert.equal(out.length,1);
 assert.equal(out[0].canonicalPlayerId,'nba:espn:5061568');
 assert.equal(out[0].canonicalEventId,'401909858');
 assert.equal(out[0].canonical_market,'three_pointers_made');
 assert.equal(out[0].team,'SAS');assert.equal(out[0].opponent,'DAL');
 assert.equal(out[0].historicalPregame,true);
 assert.equal(out[0].canAuthorizeWager,false);
});
test('NBA never promotes a forecast created or cut off after tipoff',()=>{
 assert.deepEqual(mapNbaFrozenPregameModels([{...row,created_at:'2026-10-25T00:01:00Z'}],[player]),[]);
 assert.deepEqual(mapNbaFrozenPregameModels([{...row,feature_cutoff_timestamp:'2026-10-25T00:01:00Z'}],[player]),[]);
 assert.deepEqual(mapNbaFrozenPregameModels([{...row,feature_cutoff_timestamp:'2026-10-24T23:00:00Z'}],[player]),[]);
});
test('NBA identity and availability fail closed without official ID or exact roster',()=>{
 assert.deepEqual(mapNbaFrozenPregameModels([row],[{...player,player_id:'other'}]),[]);
 assert.deepEqual(mapNbaFrozenPregameModels([row],[{...player,team_key:'DAL'}]),[]);
 assert.deepEqual(mapNbaFrozenPregameModels([{...row,availability_status:'OUT'}],[player]),[]);
});
test('NBA aliases GS/NO resolve verified roster to canonical GSW/NOP',()=>{
 const source={...row,team:'GS',away_abbr:'GS',home_abbr:'PHX'};
 assert.equal(mapNbaFrozenPregameModels([source],[{...player,team_key:'GSW'}])[0]?.team,'GSW');
 const no={...row,team:'NO',away_abbr:'NO',home_abbr:'DEN'};
 assert.equal(mapNbaFrozenPregameModels([no],[{...player,team_key:'NOP'}])[0]?.team,'NOP');
});
