import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import * as SDK from 'miniflare';
import {processCfbPostgamePilot,cfbPostgamePilotHealth} from '../functions/lib/cfbPostgamePilot.js';
const options={modules:true,script:'export default {fetch(){return new Response("offline CFB integration");}}',compatibilityDate:'2024-09-23',d1Databases:['DB'],r2Buckets:['ARCHIVE']};
const mf=new SDK.Miniflare(SDK.convertV4MiniflareOptions ? SDK.convertV4MiniflareOptions(options) : options);
try {
 const db=await mf.getD1Database('DB'),archive=await mf.getR2Bucket('ARCHIVE');
 const schema=readFileSync(new URL('../docs/sql/cfb-postgame-operational-candidate.sql',import.meta.url),'utf8');
 // D1 exec accepts one statement per line; batch initializes only local workerd storage.
 await db.batch(schema.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const fixture=()=>({game_id:'g1',provider_game_id:'100',season:2026,source:'local-workerd-fixture',status:'FINAL',game_at:'2026-10-10T20:00:00Z',observed_at:'2026-10-11T00:10:00Z',temporal_class:'POSTGAME_OBSERVED',scores:{home:28,away:14},teams:[
  {team_id:'h',provider_team_id:'1',side:'home',team_complete:true,player_complete:true,metrics:{points:28,yards:400,plays:80,sacks:null},players:[{player_id:'q',provider_player_id:'10',participated:true,metrics:{passing_yards:200,total_tackles:null}}]},
  {team_id:'a',provider_team_id:'2',side:'away',team_complete:true,player_complete:true,metrics:{points:14,yards:250,plays:50},players:[]}]});
 const runGame=(payload=fixture(),extra={})=>processCfbPostgamePilot({db,archive,databaseId:'local-workerd-only',mode:'nonproduction',identityVerifier:async()=>({verified:true,fbs_involving:true}),payload,rawBody:JSON.stringify(payload),at:'2026-10-11T00:20:00Z',...extra});
 const cards=async()=>JSON.parse((await db.prepare("SELECT v.body_json FROM cfb_postgame_card_current c JOIN cfb_postgame_card_versions v ON v.id=c.version_id WHERE c.team_id='h'").first()).body_json);
 const first=await runGame();assert.equal((await cards()).players.q.passing_yards.total,200);assert.equal((await cards()).offense.sacks.total,null);
 const count=await db.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_current').first();assert.equal(count.n,2);
 const repeated=fixture();repeated.observed_at='2026-10-11T00:11:00Z';assert.equal((await runGame(repeated)).version,first.version);
 const partial=fixture();partial.game_id='g2';partial.provider_game_id='101';partial.teams[1].player_complete=false;await assert.rejects(runGame(partial));assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_game_versions').first()).n,1);
 const corrected=fixture();corrected.observed_at='2026-10-11T00:30:00Z';corrected.teams[0].metrics.yards=420;const next=await runGame(corrected,{at:'2026-10-11T00:31:00Z'});assert.notEqual(next.version,first.version);assert.equal((await cards()).offense.yards.total,420);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_versions').first()).n,4);assert.equal((await cfbPostgamePilotHealth(db)).staleCardVersions.length,0);
 const keys=await archive.list();assert.equal(keys.objects.length,4);
 for(const o of keys.objects){const obj=await archive.get(o.key);JSON.parse(await obj.text());}
 const report={status:'VERIFIED_LOCAL_WORKERD_D1_R2',database:'local ephemeral workerd',remoteProductionMutations:0,cards:count.n,gameVersions:2,cardVersions:4,rawEvidenceObjects:keys.objects.length,duplicateNoop:true,partialBlocksPublication:true,correctionPreservesOldVersions:true,sourceIdentity:'fixture only; real provider qualification pending',productionReady:false,canAuthorizeWager:false};
 console.log(JSON.stringify(report));
 if(process.env.CFB_INTEGRATION_REPORT){mkdirSync(new URL('.',`file://${process.env.CFB_INTEGRATION_REPORT}`).pathname,{recursive:true});writeFileSync(process.env.CFB_INTEGRATION_REPORT,JSON.stringify(report,null,2)+'\n');}
} finally {await mf.dispose();}
