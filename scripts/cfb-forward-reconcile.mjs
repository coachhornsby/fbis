#!/usr/bin/env node
/** Reconcile a captured artifact independently against its immutable inputs. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {canonicalJson} from '../functions/lib/cfbForwardEvidence.js';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
const root=resolve(process.argv[2]||'');
const json=async p=>JSON.parse(await readFile(root+'/'+p,'utf8'));
const rows=async p=>(await readFile(root+'/'+p,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const cards=await rows('built/team-cards.jsonl'),snapshots=await rows('built/prospective-snapshots.jsonl'),receipts=await json('capture-receipts.json'),fixtures=await json('schedule.json');
for(const r of receipts.receipts)assert.equal(sha256Hex(await readFile(root+'/'+r.file)),r.sha256,'raw/normalized receipt digest');
assert.equal(new Set(cards.map(c=>c.team_id)).size,138);
const cardByVersion=new Map(cards.map(c=>[c.version,c]));
for(const card of cards){const {version,materialized_at,data_cutoff_at,last_source_observation,...body}=card;assert.equal(sha256Hex(canonicalJson(body)),version,'card version content');assert.ok(Date.parse(data_cutoff_at)<=Date.parse(materialized_at));}
for(const s of snapshots){
 const {id,...body}=s;assert.equal(sha256Hex(canonicalJson(body)),id,'snapshot content identity');
 const decision=Date.parse(s.decision_at),calculated=Date.parse(s.calculated_at),kickoff=Date.parse(s.event_start_at);
 assert.ok(Number.isFinite(decision)&&decision<=calculated&&calculated<kickoff,'actual pregame calculation window');
 assert.equal(s.can_qualify,false);assert.equal(s.can_authorize_wager,false);assert.equal(s.market_quote,null);assert.equal(s.clv,null);assert.equal(s.roi,null);
 assert.equal(s.observed_production_projection,null);assert.equal(s.temporal_class,'PROSPECTIVE_FEATURE_CAPTURE');
 for(const r of s.source_receipts)assert.ok(Date.parse(r.observed_at)<=decision,'source received before decision');
 const fixture=fixtures.find(f=>String(f.game_id)===s.game_id);assert.ok(fixture);assert.equal(fixture.status,'STATUS_SCHEDULED');assert.notEqual(fixture.provider_start_time_tbd,true);
 for(const side of ['home','away']){
  assert.equal(s.team_ids[side],'cfb:espn:'+fixture[side+'_id']);const c=cardByVersion.get(s.card_versions[side]);assert.ok(c,'captured card present');assert.equal(c.team_id,s.team_ids[side]);
  assert.ok(Date.parse(c.materialized_at)<=decision);for(const g of c.game_versions){assert.ok(Date.parse(g.game_at)<decision);assert.ok(Date.parse(g.observed_at)<=decision);}
  const input=s.model_input.cfbFbisV2Input[side];assert.equal(input.off,c.summary.scoring?.points_for?.mean??null);assert.equal(input.def,c.summary.scoring?.points_against?.mean??null);assert.equal(input.gamesPlayed,c.games);assert.equal(input.qbStarterKnown,false);assert.equal(input.qbName,null);
  if(c.coverage.recent_final_games_pending.length)assert.ok(s.qualification_reasons.includes('FINAL_GAME_STATS_PENDING'));
 }
 if(s.projection){const p=s.projection;assert.ok(Object.values(p).every(Number.isFinite));assert.ok(p.p_home>=0&&p.p_home<=1);assert.ok(Math.abs(p.p_home+p.p_away-1)<1e-9);assert.ok(p.sigma_margin>0&&p.sigma_total>0);assert.ok(Math.abs(p.home+p.away-p.total)<.11);assert.ok(Math.abs(p.home-p.away-p.margin)<.11);}
}
const quotes=await rows('built/research-market-observations.jsonl');
const snapshotById=new Map(snapshots.map(s=>[s.id,s]));
for(const q of quotes){
 const {id,...body}=q;assert.equal(sha256Hex(canonicalJson(body)),id,'quote content identity');const snapshot=snapshotById.get(q.snapshot_id);assert.ok(snapshot,'quote links immutable forecast');assert.equal(q.game_id,snapshot.game_id);
 assert.ok(Date.parse(q.observed_at)<=Date.parse(snapshot.decision_at));assert.equal(q.eligible_quote,false);assert.equal(q.is_verified_closing_quote,false);assert.equal(q.can_authorize_wager,false);assert.equal(q.roi,null);assert.equal(q.clv,null);assert.equal(q.bookmaker_updated_at,null);
 assert.ok(Number.isFinite(q.american_price)&&Math.abs(q.american_price)>=100);assert.ok(receipts.receipts.some(r=>r.sha256===q.source_sha256&&r.file===q.source_file));
 if(q.family==='moneyline')assert.equal(q.model_probability,snapshot.projection?.[q.selection==='home'?'p_home':'p_away']??null);else assert.equal(q.model_probability,null);
}
const report={status:'VERIFIED_CAPTURE_RECONCILIATION',code_sha:receipts.code_sha,cards:cards.length,prospective_snapshot_versions:snapshots.length,distinct_future_games:new Set(snapshots.map(s=>s.game_id)).size,production_writes:0,bet_eligible:0,economic_observations:0,independent_human_review:false,raw_receipts_verified:receipts.receipts.length,unqualified_research_quotes:quotes.length,eligible_quotes:0};
await writeFile(root+'/built/reconciliation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
