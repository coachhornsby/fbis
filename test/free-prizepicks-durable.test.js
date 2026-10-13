import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMirrorProps,matchMirrorEvent,FREE_PROP_MIRROR_URL,loadFreeMirrorRows} from '../functions/lib/freePrizePicksMirror.js';
import {captureFreeMirror,consumeFreeMirror,onRequestPost} from '../functions/api/free-prizepicks-collect.js';
const now=new Date('2026-10-13T16:00:00Z');
const prop=(patch={})=>({projectionId:'p1',playerId:'player1',player:'Quarterback',sport:'NFL',stat:'Pass Yards',line:'220.5',Team:'Seattle Seahawks',Opponent:'Denver Broncos',teamCode:'SEA',opponentCode:'DEN',startTimeIso:'2026-10-15T20:15:00-04:00',providerFetchedAt:'2026-10-13T12:09:00Z',oddsType:'standard',status:'pre_game',gameId:'provider-game',...patch});
const feed=props=>({scrapedAt:'2026-10-13T12:11:00Z',leagueResults:[{leagueName:'NFL',ok:true,publishedCount:props.length,providerFetchedAt:'2026-10-13T12:09:00Z'}],props});
const game={id:'canonical-game',sport:'nfl',start:'2026-10-16T00:15:00Z',home_name:'Seattle Seahawks',away_name:'Denver Broncos',home_abbr:'SEA',away_abbr:'DEN'};
function archive(){const data=new Map();return{data,async get(key){if(!data.has(key))return null;return{async json(){return JSON.parse(data.get(key))}}},async put(key,value){data.set(key,value)}};}
function database(){const writes=new Map();return{writes,prepare(sql){return{bind(...args){return{async all(){return{results:sql.includes('FROM games')?[game]:[]}},async run(){const inserted=!writes.has(args[0]);writes.set(args[0],{sql,args});return{meta:{changes:inserted?1:0}}}}}}}};}
test('free mirror preserves provider IDs, clocks, unsupported labels and independent event identity',()=>{
 const result=normalizeMirrorProps(feed([prop(),prop({projectionId:'p2',stat:'Longest Completion'}),prop()]),{games:[game],now,snapshotId:'hash'});
 assert.equal(result.rows.length,2);assert.equal(result.reasons.DUPLICATE_PROVIDER_PROP,1);
 const first=result.rows[0];assert.equal(first.eventId,'canonical-game');assert.equal(first.playerId,null);assert.equal(first.raw.providerPlayerId,'player1');
 assert.equal(first.sourceMarketId,'p1');assert.equal(first.statFamily,'passing_yards');assert.equal(first.executionEligible,false);
 assert.equal(first.raw.providerTimeConfidence,'MIRROR_REPORTED_CAPTURE');assert.equal(first.period,'unspecified');
 assert.equal(result.rows[1].statFamily,null);assert.equal(result.rows[1].raw.marketRaw,'Longest Completion');assert.equal(first.modelProbability,undefined);
});
test('matching requires both team identities, kickoff and a single canonical candidate',()=>{
 assert.equal(matchMirrorEvent(prop(),[game]).id,game.id);
 assert.equal(matchMirrorEvent(prop({Opponent:'Other',opponentCode:'NYJ'}),[game]).id,null);
 assert.equal(matchMirrorEvent(prop({startTimeIso:'2026-10-17T00:15:00Z'}),[game]).id,null);
 assert.equal(matchMirrorEvent(prop(),[game,{...game,id:'duplicate'}]).reason,'AMBIGUOUS_EVENT_MATCH');
});
test('clock failures and failed publisher leagues cannot create usable normalized observations',()=>{
 assert.throws(()=>normalizeMirrorProps({...feed([]),scrapedAt:'2026-10-14T12:00:00Z'},{now}),/PUBLICATION_TIME_INVALID/);
 assert.throws(()=>normalizeMirrorProps({props:[]},{now}),/SCHEMA_INVALID/);
 const bad=normalizeMirrorProps(feed([prop({providerFetchedAt:'2026-10-14T00:00:00Z'})]),{now});assert.equal(bad.rows.length,0);assert.equal(bad.reasons.INVALID_PROP_CLOCK,1);
 const failed=normalizeMirrorProps({...feed([prop()]),leagueResults:[{leagueName:'NFL',ok:false}]},{now});assert.equal(failed.reasons.PUBLISHER_LEAGUE_COLLECTION_FAILED,1);
});
test('raw free capture precedes ingestion, replay keeps original capture clock and paid calls never occur',async()=>{
 const env={ARCHIVE:archive(),DB:database()};let calls=0;
 const fetchImpl=async url=>{assert.equal(url,FREE_PROP_MIRROR_URL);calls++;return new Response(JSON.stringify(feed([prop()])),{headers:{etag:'publisher-etag'}})};
 const first=await captureFreeMirror(env,{fetchImpl,now});assert.equal(first.pages,1);assert.equal(env.ARCHIVE.data.size,2);assert.equal(env.DB.writes.size,0);
 const later=await captureFreeMirror(env,{fetchImpl,now:new Date('2026-10-13T17:00:00Z')});assert.equal(later.snapshotId,first.snapshotId);assert.equal(later.collectedAt,first.collectedAt);
 const consumed=await consumeFreeMirror(env,{snapshotId:first.snapshotId,batchIndex:0,now});assert.equal(consumed.inserted,1);assert.equal(consumed.matchedRows,1);
 assert.equal((await consumeFreeMirror(env,{snapshotId:first.snapshotId,batchIndex:0,now})).inserted,0);
 const record=[...env.DB.writes.values()][0];assert.equal(record.args[29],'2026-10-13T12:09:00.000Z');assert.equal(record.args[30],now.toISOString());assert.equal(record.args[31],'RESEARCH');
 assert.equal(calls,2);assert.equal(env.DB.writes.size,1);
 await assert.rejects(consumeFreeMirror(env,{snapshotId:first.snapshotId,batchIndex:1,now}),/BATCH_OUT_OF_RANGE/);
});
test('mirror collection requires existing harvest authority',async()=>{
 const response=await onRequestPost({env:{HARVEST_SECRET:'test'},request:new Request('https://fbis.test/api/free-prizepicks-collect',{method:'POST',body:'{"operation":"capture"}'})});assert.equal(response.status,403);
});
test('event API mirror adapter preserves null odds and labels the publisher clock',async()=>{
 const db={prepare(){return{bind(){return{async all(){return{results:[{sport:'nfl',canonical_event_id:'canonical-game',source_market_id:'p1',player_name:'Quarterback',stat_family:'passing_yards',line:220.5,source_observed_at:'2026-10-13T12:09:00Z',collected_at:'2026-10-13T16:00:00Z',raw_payload_json:JSON.stringify({snapshotId:'hash',eventMatchStatus:'TWO_TEAM_KICKOFF_VERIFIED',publishedAt:'2026-10-13T12:11:00Z'})}]}}}}}}};
 const rows=await loadFreeMirrorRows(db,['canonical-game'],'nfl');assert.equal(rows.length,1);assert.equal(rows[0].fbisProjection,null);assert.equal(rows[0].overOdds,null);assert.equal(rows[0].provider,'PRIZEPICKS_FREE_MIRROR');assert.equal(rows[0].quoteKind,'DAILY_MIRROR_REFERENCE_NOT_LIVE_VERIFIED');
});
test('empty current NFL publisher feed is a valid zero-row snapshot',async()=>{
 const {normalizeFreeNflMirror}=await import('../src/features/playerProps/freePrizePicksMirror.js');
 const result=normalizeFreeNflMirror({sport:'NFL',totalProps:0,scrapedAt:'2026-10-13T12:11:00Z',collectionStatus:{ok:true,providerFetchedAt:'2026-10-13T12:09:00Z'}},{now});
 assert.equal(result.ok,true);assert.equal(result.rows.length,0);
});
