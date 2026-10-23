import { readFrozenPropForecast } from './propForecastArchive.js';
import { readPropEvidence } from './propEvidenceStore.js';
export async function loadPropResearchResult(env,{sport,eventId,playerId,market,eventStart,now=Date.now()}={}){
 const pregame=Date.parse(eventStart)>now;
 const frozen=await readFrozenPropForecast(env,{sport,eventId,playerId,market,eventStart});
 const pending={status:pregame?'PREGAME':frozen?'OFFICIAL_RESULT_PENDING':'FROZEN_PREGAME_FORECAST_MISSING',frozenPrediction:frozen?.frozenAt||null,projection:frozen?.projection??null,actual:null,forecastError:null,recordedWager:false};
 if(pregame||!frozen||sport!=='nhl')return pending;
 try{
  const obj=await env.ARCHIVE.get('player-props/official/v1/nhl-outcome-index.json');if(!obj)return pending;
  const index=await obj.json(),link=index[[eventId,playerId,market].join('|')];if(!link?.id)return pending;
  const evidence=await readPropEvidence(env,'OFFICIAL_RESULT',link.id);if(!evidence.ok)return pending;
  const p=evidence.payload,r=p.result;
  if(p.canonicalEventId!==eventId||p.canonicalPlayerId!==playerId||r?.canonical_market!==market||r.period!=='full_game'||r.status!=='FINAL'||r.playerStatus!=='PLAYED'||r.official!==true||r.correctionPending===true||typeof r.actual!=='number'||!Number.isFinite(r.actual)||!Number.isFinite(Date.parse(r.finalizedAt))||Date.parse(r.finalizedAt)<Date.parse(eventStart))return pending;
  return {...pending,status:'OFFICIAL_RESULT_JOINED',actual:r.actual,forecastError:frozen.projection-r.actual,source:r.source,finalizedAt:r.finalizedAt,resultEvidenceId:link.id,modelVersion:frozen.modelVersion};
 }catch{return {...pending,status:'RESULT_EVIDENCE_READ_FAILED'};}
}

export function summarizePropForecastErrors(rows=[]){
 const groups=new Map(),seen=new Set();let excluded=0;
 for(const r of rows){const key=[r.sport,r.eventId,r.playerId,r.market,r.modelVersion].join('|');
  if(seen.has(key)||r.status!=='OFFICIAL_RESULT_JOINED'||!r.modelVersion||!Number.isFinite(r.forecastError)||!Number.isFinite(Date.parse(r.frozenPrediction))||Date.parse(r.frozenPrediction)>=Date.parse(r.eventStart)||!r.resultEvidenceId){excluded++;continue;}
  seen.add(key);const group=[r.sport,r.market,r.modelVersion].join('|');if(!groups.has(group))groups.set(group,{sport:r.sport,market:r.market,modelVersion:r.modelVersion,n:0,absolute:0,squared:0,bias:0});
  const g=groups.get(group);g.n++;g.absolute+=Math.abs(r.forecastError);g.squared+=r.forecastError**2;g.bias+=r.forecastError;
 }
 return {cohorts:[...groups.values()].map(g=>({sport:g.sport,market:g.market,modelVersion:g.modelVersion,n:g.n,mae:g.absolute/g.n,rmse:Math.sqrt(g.squared/g.n),bias:g.bias/g.n})),excluded,calibrationProbability:null,profit:null,recordedWager:false};
}
