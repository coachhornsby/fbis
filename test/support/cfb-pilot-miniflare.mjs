import {readFile} from 'node:fs/promises';
import {materializeResearchCards,buildForwardSnapshot} from '../../functions/lib/cfbForwardEvidence.js';
// Isolated workerd/D1/R2 integration. No credentials or remote resources.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundled=await build({entryPoints:['test/support/cfb-pilot-worker.mjs'],bundle:true,write:false,format:'esm',loader:{'.sql':'text'},platform:'browser'});
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'cfb-isolated-test',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2024-09-23',d1Databases:['DB'],r2Buckets:['ARCHIVE']}]}));
const send=async(path,body)=>{
 const response=await mf.dispatchFetch(`http://local.test${path}`,body?{method:'POST',body:JSON.stringify(body)}:{});
 const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
};
try {
 await send('/init');
 const payload={game_id:'g1',provider_game_id:'100',season:2026,source:'fixture',status:'FINAL',game_at:'2026-10-10T20:00:00Z',observed_at:'2026-10-11T00:10:00Z',temporal_class:'POSTGAME_OBSERVED',scores:{home:28,away:14},teams:[
  {team_id:'h',provider_team_id:'1',side:'home',team_complete:true,player_complete:true,metrics:{points:28,yards:400,plays:80},players:[{player_id:'q',provider_player_id:'10',participated:true,metrics:{pass_yards:200}}]},
  {team_id:'a',provider_team_id:'2',side:'away',team_complete:true,player_complete:true,metrics:{points:14,yards:250,plays:50},players:[]}]};
 const rawBody=JSON.stringify({provider:'synthetic',complete:true});
 const first=await send('/process',{payload,rawBody,at:'2026-10-11T00:20:00Z'});
 const duplicate=await send('/process',{payload,rawBody,at:'2026-10-11T00:21:00Z'});
 assert.equal(first.version,duplicate.version);
 let state=await send('/inspect');assert.equal(state.cards.length,2);
 assert.equal(JSON.parse(state.cards.find(c=>c.team_id==='h').body_json).games,1);
 payload.observed_at='2026-10-11T00:30:00Z';payload.teams[0].metrics.yards=420;payload.teams[0].players=[];
 await send('/process',{payload,rawBody,at:'2026-10-11T00:31:00Z'});
 state=await send('/inspect');const home=JSON.parse(state.cards.find(c=>c.team_id==='h').body_json);
 assert.equal(home.offense.yards.total,420);assert.deepEqual(home.players,{});
 await send('/forward-init');
 const teamRows=['1','2'].map(id=>({team_id:'cfb:espn:'+id,season:2026,id:'row'+id,game_id:'old',game_at:'2026-10-10T20:00:00Z',observed_at:'2026-10-11T00:10:00Z',content_hash:'fixture'+id,metrics_json:JSON.stringify({scoring:{points_for:28,points_against:14}})}));
 const cards=await materializeResearchCards({teams:teamRows.map(r=>({team_id:r.team_id})),teamRows,playerRows:[],decisionAt:'2026-10-11T01:00:00Z'});
 const snapshot=await buildForwardSnapshot({fixture:{game_id:'future-fixture',home_id:'1',away_id:'2',status:'STATUS_SCHEDULED',game_date:'2026-10-17T20:00:00Z'},cards,receipts:[{sha256:'a'.repeat(64),observed_at:'2026-10-11T00:10:00Z'}],decisionAt:'2026-10-11T01:00:00Z',codeSha:'b'.repeat(40)});
 await send('/forward',snapshot);await send('/forward',snapshot);
 let snapshots=await send('/forward-inspect');assert.equal(snapshots.results.length,1);assert.equal(JSON.parse(snapshots.results[0].body_json).id,snapshot.id);
 const actual=process.argv[2]?(await readFile(process.argv[2],'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse):[];
 for(const p of actual){await send('/forward',p);await send('/forward',p);}
 snapshots=await send('/forward-inspect');assert.equal(snapshots.results.length,actual.length+1);
 for(const p of actual)assert.equal(JSON.parse(snapshots.results.find(r=>r.id===p.id).body_json).id,p.id);
 console.log(JSON.stringify({status:'VERIFIED_LOCAL_WORKERD_D1_R2',cards:state.cards.length,idempotency:true,correction:true,immutable_shadow_snapshots:snapshots.results.length,actual_prospective_samples:actual.length,production_mutations:0}));
} finally {await mf.dispose();}
