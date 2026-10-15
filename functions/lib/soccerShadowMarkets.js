import {polymarketUsPeriod,polymarketUsMarketFamily,polymarketUsSideLabel} from "./polymarketUs.js";
import {marketTemporalStatus} from './marketTemporal.js';
const number=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function soccerShadowMarketSnapshot(rows=[],{eventId,kickoff,snapshotAt}={}){
 const references=[];const groups=new Map();
 for(const original of rows){
  const r={...original};
  if(String(r.canonical_event_id)!==String(eventId))continue;
  let raw={};try{raw=JSON.parse(r.raw_payload_json||'{}')||{}}catch{}
  if(r.source==='Polymarket US'&&raw.providerMarket){r.period=polymarketUsPeriod(raw.providerMarket);r.market_family=polymarketUsMarketFamily(raw.providerMarket);r.side=polymarketUsSideLabel(raw.providerMarket,raw.providerSide,'soccer');if(r.market_family==='moneyline'&&raw.contractLong!==true)continue;}
  if(r.period!=='full_game')continue;
  if(r.source==='Polymarket US WebSocket'&&raw.contractBindingVerified!==true)continue;
  const observed=Object.hasOwn(raw,'sourceObservedAt')?raw.sourceObservedAt:r.source_observed_at;
  const temporal=marketTemporalStatus({source:r.source,providerObservedAt:observed,collectedAt:r.collected_at,eventId,eventStartAt:kickoff,projectionAsOf:snapshotAt},{now:new Date(snapshotAt),maxAgeMs:20*60*1000});
  if(!temporal.researchEligible||Date.parse(r.collected_at)>Date.parse(snapshotAt)||Date.parse(r.collected_at)>=Date.parse(kickoff))continue;
  const price=number(r.decimal_odds),probability=number(r.contract_price);
  references.push({observationId:r.id,source:r.source,family:r.market_family,side:r.side,line:r.line,decimalPrice:price,contractProbability:probability,collectedAt:r.collected_at,providerObservedAt:observed||null,temporalStatus:temporal.status,identityLinkedAt:raw.identityLinkedAt||null});
  // Exchange asks remain separately labeled contract references, never bookmaker prices.
  if(r.source!=='PinnOdds'||!temporal.prospectiveEvidenceEligible||!(price>1)||raw.postCaptureIdentityLink===true)continue;
  const family=r.market_family==='moneyline'?'1X2':r.market_family==='total'&&number(r.line)===2.5?'TOTALS_O25':r.market_family==='btts'?'BTTS':r.market_family==='spread'&&[-0.5,0,0.5].includes(number(r.line))?'ASIAN_HANDICAP':null;
  if(!family)continue;
  const homeLine=String(r.side).toLowerCase()==='away'?-number(r.line):number(r.line);
  const cohort=[family,raw.snapshotId||r.collected_at,r.source_market_id,r.period,family==='ASIAN_HANDICAP'?homeLine:''].join('|');
  if(!groups.has(cohort))groups.set(cohort,{family,homeLine,rows:new Map(),collectedAt:r.collected_at});
  const group=groups.get(cohort),side=String(r.side).toUpperCase();
  // A duplicate selection makes a group ambiguous, not a reason to pick an arbitrary quote.
  if(group.rows.has(side))group.ambiguous=true;
  group.rows.set(side,{r,price,observed});
 }
 const byFamily={};
 for(const g of [...groups.values()].sort((a,b)=>Date.parse(b.collectedAt)-Date.parse(a.collectedAt))){
  const selections=g.family==='1X2'?['HOME','DRAW','AWAY']:g.family==='BTTS'?['YES','NO']:g.family==='ASIAN_HANDICAP'?['HOME','AWAY']:['OVER','UNDER'];
  if(byFamily[g.family]||g.ambiguous||g.rows.size!==selections.length||selections.some(s=>!g.rows.has(s)))continue;
  const sum=selections.reduce((n,s)=>n+1/g.rows.get(s).price,0);const markets={};
  for(const side of selections){const {r,price,observed}=g.rows.get(side);markets[side]={marketNoVigProbability:(1/price)/sum,entryLine:r.line==null?null:number(r.line),entryPrice:price>=2?(price-1)*100:-100/(price-1),lineTimestamp:observed,marketHistoryAvailable:1,marketUnavailableReason:null,observationId:r.id};}
  byFamily[g.family]=markets;
  if(g.family==='ASIAN_HANDICAP')byFamily.asianHomeLine=g.homeLine;
 }
 return{byFamily,references,source:'PinnOdds',exchangeSource:'Polymarket US WebSocket',snapshotAt};
}
export async function loadSoccerShadowMarkets(db,games,{snapshotAt}={}){
 const byId=new Map();if(!db?.prepare)return byId;
 for(const game of games||[]){
  const rows=(await db.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line ORDER BY collected_at DESC,CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,id DESC) rn FROM normalized_market_observations INDEXED BY idx_norm_market_event_time WHERE sport='soccer' AND canonical_event_id=? AND source IN ('PinnOdds','Polymarket US','Polymarket US WebSocket') AND collected_at BETWEEN ? AND ? AND market_family IN ('moneyline','total','btts','spread','unclassified')) SELECT * FROM latest WHERE rn=1`).bind(String(game.id),new Date(Date.parse(snapshotAt)-7*3600000).toISOString(),snapshotAt).all())?.results||[];
  byId.set(String(game.id),soccerShadowMarketSnapshot(rows,{eventId:String(game.id),kickoff:game.start,snapshotAt}));
 }
 return byId;
}
