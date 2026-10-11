import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {materializeResearchCards,buildForwardSnapshot,recoverLegacyPregameCapture,summarizeCardMetrics} from '../functions/lib/cfbForwardEvidence.js';
import {appendForwardShadow} from '../functions/lib/cfbForwardStore.js';
import {loadPublishedCfbTeamCard} from '../functions/lib/cfbPublishedTeamCard.js';
const decisionAt='2026-10-11T05:00:00Z',observed_at='2026-10-11T04:00:00Z';
const teams=[{team_id:'cfb:espn:1'},{team_id:'cfb:espn:2'}];
const row=(team_id,points=28)=>({id:team_id+'g1',team_id,game_id:'1',season:2026,game_at:'2026-10-10T20:00:00Z',observed_at,content_hash:String(points),metrics_json:JSON.stringify({scoring:{points_for:points,points_against:14},offense:{off_total_yards:null,off_completions:10,off_passes:20}})});
const setup=()=>materializeResearchCards({teams,teamRows:teams.map(t=>row(t.team_id)),playerRows:[],decisionAt});
const args=async()=>({fixture:{game_id:'2',home_id:'1',away_id:'2',status:'STATUS_SCHEDULED',game_date:'2026-10-17T20:00:00Z'},cards:await setup(),receipts:[{sha256:'a'.repeat(64),observed_at}],decisionAt,codeSha:'b'.repeat(40)});
function dbWrap(sqlite){return {prepare(sql){return {bind(...args){return {async run(){return sqlite.prepare(sql).run(...args);},async first(){return sqlite.prepare(sql).get(...args)||null;}};}};}};}
test('research cards preserve NULL, pair rates and latest deterministic corrections',async()=>{
 const rows=[row(teams[0].team_id),{...row(teams[0].team_id,35),observed_at:'2026-10-11T04:30:00Z'}];
 const cards=await materializeResearchCards({teams,teamRows:rows,playerRows:[],decisionAt});
 assert.equal(cards[0].games,1);assert.equal(cards[0].summary.scoring.points_for.total,35);assert.equal(cards[0].summary.offense.off_total_yards.mean,null);
 assert.equal(cards[0].summary.passing.completion_rate.mean,.5);assert.equal(cards[1].games,0);
 assert.equal(summarizeCardMetrics([{passing:{pass_yards:100}}]).passing.pass_yards.mean,100);
 const old=await setup();assert.notEqual(old[0].version,cards[0].version);assert.equal(old[0].summary.scoring.points_for.total,28);
});
test('repeated player observations do not double count, quarantine removes unresolved membership',async()=>{
 const p={...row(teams[0].team_id),player_id:'q'};
 const cards=await materializeResearchCards({teams,teamRows:[row(teams[0].team_id)],playerRows:[p,p],decisionAt});assert.equal(cards[0].players.q.games,1);
 const absent=await materializeResearchCards({teams,teamRows:[row(teams[0].team_id)],playerRows:[p],decisionAt,quarantined:[p]});assert.deepEqual(absent[0].players,{});
 await assert.rejects(materializeResearchCards({teams,teamRows:[row(teams[0].team_id)],playerRows:[p,{...p,content_hash:'different'}],decisionAt}),/Ambiguous player/);
});
test('future source, game and materialization clocks cannot enter pregame projection',async()=>{
 const a=await args();a.cards[0].game_versions[0].game_at='2026-10-12T00:00:00Z';await assert.rejects(buildForwardSnapshot(a),/Future card/);
 const b=await args();b.receipts[0].observed_at='2026-10-12T00:00:00Z';await assert.rejects(buildForwardSnapshot(b),/source receipt/);
 const c=await args();c.fixture.game_date=decisionAt;await assert.rejects(buildForwardSnapshot(c),/upcoming/);
});
test('shadow orientation, inputs and authority remain reproducible without starter inference',async()=>{
 const a=await args(),p=await buildForwardSnapshot(a);assert.equal(p.id,(await buildForwardSnapshot(a)).id);
 assert.equal(p.team_ids.home,'cfb:espn:1');assert.equal(p.model_input.cfbFbisV2Input.home.qbStarterKnown,false);
 assert.equal(p.can_authorize_wager,false);assert.equal(p.market_quote,null);assert.equal(p.clv,null);assert.equal(p.observed_production_projection,null);
 if(p.projection){assert.ok(p.projection.p_home>=0&&p.projection.p_home<=1);assert.ok(Math.abs(p.projection.p_home+p.projection.p_away-1)<1e-9);assert.ok(p.projection.sigma_margin>0);}
});
test('legacy feature capture is never upgraded to complete upstream PIT evidence',()=>{
 const r={id:'snap1',game_id:'g1',frozen_at:observed_at,deployment_commit:'c'.repeat(40),layers_json:JSON.stringify({_snap:{start:'2026-10-11T04:30:00Z',uncertainty:{features:{qbStarterKnown:true},homePriorFrozen:{espnId:'1',asOf:observed_at},awayPriorFrozen:{espnId:'2',asOf:observed_at}}}})};
 const p=recoverLegacyPregameCapture(r);assert.equal(p.accepted,true);assert.equal(p.qualification_eligible,false);assert.equal(p.upstream_source_observed_at,null);assert.equal(p.captured_features.qbStarterKnown,true);
 assert.equal(recoverLegacyPregameCapture({...r,frozen_at:'2026-10-11T04:31:00Z'}).reason,'NOT_PREGAME');
});
test('immutable shadow database prevents mutation and refuses production',async()=>{
 const s=new DatabaseSync(':memory:');s.exec(readFileSync(new URL('../docs/sql/cfb-forward-evidence-candidate.sql',import.meta.url),'utf8'));
 const p=await buildForwardSnapshot(await args()),a={db:dbWrap(s),databaseId:'isolated',mode:'nonproduction',snapshot:p};
 await appendForwardShadow(a);await appendForwardShadow(a);assert.equal(s.prepare('SELECT COUNT(*) n FROM cfb_forward_snapshots').get().n,1);
 assert.throws(()=>s.exec('DELETE FROM cfb_forward_snapshots'),/immutable/);assert.throws(()=>s.exec("UPDATE cfb_forward_snapshots SET body_json='{}'"),/immutable/);
 await assert.rejects(appendForwardShadow({...a,databaseId:'b50c724c-903b-4241-8ce1-48d931e7a44c'}),/refuses production/);
 await assert.rejects(appendForwardShadow({...a,snapshot:{...p,can_authorize_wager:true}}),/authority/);
});
test('published card reads current and historical versions without acquisition',async()=>{
 const s=new DatabaseSync(':memory:');s.exec(readFileSync(new URL('../docs/sql/cfb-postgame-operational-candidate.sql',import.meta.url),'utf8'));
 const body={team_id:'cfb:espn:1',season:2026,games:1,record:{wins:1,losses:0}};
 s.prepare('INSERT INTO cfb_postgame_card_versions VALUES(?,?,?,?,?)').run('v1',body.team_id,2026,observed_at,JSON.stringify(body));
 s.prepare('INSERT INTO cfb_postgame_card_versions VALUES(?,?,?,?,?)').run('v2',body.team_id,2026,decisionAt,JSON.stringify({...body,games:2}));
 s.prepare('INSERT INTO cfb_postgame_card_current VALUES(?,?,?)').run(body.team_id,2026,'v2');
 assert.equal((await loadPublishedCfbTeamCard(dbWrap(s),body.team_id,2026)).card.games,2);
 assert.equal((await loadPublishedCfbTeamCard(dbWrap(s),body.team_id,2026,{asOf:observed_at})).card.games,1);
 assert.equal((await loadPublishedCfbTeamCard(dbWrap(s),'cfb:espn:2',2026)).state,'NOT_PUBLISHED');
});
test('a postgame correction changes future features while prior snapshot bytes stay frozen',async()=>{
 const a=await args(),old=await buildForwardSnapshot(a),frozen=JSON.stringify(old);
 a.cards=await materializeResearchCards({teams,teamRows:[{...row(teams[0].team_id,42),observed_at:'2026-10-11T04:40:00Z'},row(teams[1].team_id)],playerRows:[],decisionAt});
 const next=await buildForwardSnapshot(a);assert.notEqual(next.id,old.id);assert.notEqual(next.card_versions.home,old.card_versions.home);assert.equal(JSON.stringify(old),frozen);
});
