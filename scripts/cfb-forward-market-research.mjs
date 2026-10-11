#!/usr/bin/env node
/** Preserve observed public quotes; never treat ESPN's `close` slot as a verified close. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
import {canonicalJson} from '../functions/lib/cfbForwardEvidence.js';
export function researchPrices({odds,game,receipt,snapshot}){
 if(!snapshot||Date.parse(receipt.observed_at)>Date.parse(snapshot.decision_at)||Date.parse(snapshot.decision_at)>=Date.parse(snapshot.event_start_at))return [];
 if(odds?.provider?.id!=='100'||odds.provider.name!=='DraftKings')return [];
 const sides=Object.fromEntries(game.competitions[0].competitors.map(c=>[c.homeAway,String(c.team.id)]));
 if(snapshot.team_ids.home!=='cfb:espn:'+sides.home||snapshot.team_ids.away!=='cfb:espn:'+sides.away)return [];
 for(const side of ['home','away'])if(String(odds[side+'TeamOdds']?.team?.id)!==sides[side])return [];
 const price=v=>typeof v==='string'&&/^[+-]\d{3,6}$/.test(v)&&Math.abs(Number(v))>=100?Number(v):null;
 const line=(v,prefix='')=>typeof v==='string'&&new RegExp('^'+prefix+'[+-]?\\d+(?:\\.\\d+)?$').test(v)?Number(v.slice(prefix.length)):null;
 const rows=[];
 for(const [family,selection,slot,prefix] of [['moneyline','home',odds.moneyline?.home?.close,''],['moneyline','away',odds.moneyline?.away?.close,''],['spread','home',odds.pointSpread?.home?.close,''],['spread','away',odds.pointSpread?.away?.close,''],['total','over',odds.total?.over?.close,'o'],['total','under',odds.total?.under?.close,'u']]){
  const american=price(slot?.odds),number=family==='moneyline'?null:line(slot?.line,prefix);
  if(american==null||(family!=='moneyline'&&number==null))continue;
  const p=family==='moneyline'?snapshot.projection?.[selection==='home'?'p_home':'p_away']??null:null;
  const implied=american>0?100/(american+100):-american/(-american+100);
  const body={game_id:String(game.id),snapshot_id:snapshot.id,input_fingerprint:snapshot.input_fingerprint,family,selection,line:number,american_price:american,bookmaker:'DraftKings',bookmaker_provider_id:'100',source:'ESPN_PUBLIC_SCOREBOARD',source_file:receipt.file,source_sha256:receipt.sha256,observed_at:receipt.observed_at,decision_at:snapshot.decision_at,source_slot:'close',is_verified_closing_quote:false,bookmaker_updated_at:null,temporal_class:'PROSPECTIVE_UNQUALIFIED_RESEARCH_PRICE',model_probability:p,quote_implied_probability:implied,probability_difference:p==null?null:p-implied,eligible_quote:false,can_authorize_wager:false,roi:null,clv:null,qualification_reasons:['SOURCE_AND_BOOKMAKER_REFRESH_CONTRACT_UNQUALIFIED','NO_VERIFIED_EXECUTABLE_PRICE','MODEL_QUALIFICATION_DISABLED','SPREAD_TOTAL_AND_PUSH_DISTRIBUTIONS_UNQUALIFIED']};
  rows.push({...body,id:sha256Hex(canonicalJson(body))});
 }
 return rows;
}
export async function captureResearchMarkets(root){
 const capture=JSON.parse(await readFile(root+'/capture-receipts.json','utf8'));
 const snapshots=(await readFile(root+'/built/prospective-snapshots.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),byGame=new Map(snapshots.map(s=>[s.game_id,s])),records=new Map();
 for(const receipt of capture.receipts.filter(r=>r.file.startsWith('espn-schedule-'))){
  const raw=await readFile(root+'/'+receipt.file);if(sha256Hex(raw)!==receipt.sha256)throw Error('Quote source digest mismatch');
  for(const game of JSON.parse(raw).events||[])if(game.status?.type?.name==='STATUS_SCHEDULED')for(const odds of game.competitions?.[0]?.odds||[])for(const r of researchPrices({odds,game,receipt,snapshot:byGame.get(String(game.id))}))records.set(r.id,r);
 }
 const rows=[...records.values()];await writeFile(root+'/built/research-market-observations.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const report={unqualified_research_price_observations:rows.length,distinct_future_games:new Set(rows.map(r=>r.game_id)).size,eligible_quotes:0,verified_closing_quotes:0,qualified_economic_observations:0,roi:null,clv:null,can_authorize_wager:false};
 await writeFile(root+'/built/research-market-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await captureResearchMarkets(resolve(process.argv[2]||''));
