import { CBB_PLAYER_PROP_PROMOTED_MARKETS, CBB_PLAYER_PROP_MODEL_V2_ID } from "./cbbPlayerValidated.js";

export const CBB_PLAYER_PROP_MONEY_ID="CBB-PLAYER-PROP-MONEY-v1";
export const CBB_PLAYER_PROP_TRACK_Z=0.50;

const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const r=(v,d=3)=>v==null?null:Number(Number(v).toFixed(d));

export function propEdgeBand(z){
  const a=Math.abs(Number(z)||0);
  if(a>=1.25)return"1.25+";
  if(a>=1.0)return"1.00-1.24";
  if(a>=0.75)return"0.75-0.99";
  if(a>=0.50)return"0.50-0.74";
  return"<0.50";
}

export function buildCbbPlayerPropSignal(candidate={}, lineRow={}){
  const market=String(candidate.market||lineRow.canonicalMarket||lineRow.canonical_market||"");
  const projection=n(candidate.fbisProjection);
  const sigma=n(candidate.fbisSigma);
  const line=n(lineRow.line);
  const eventId=String(candidate.eventId||lineRow.fbisEventId||lineRow.fbis_event_id||"");
  const playerName=String(candidate.playerName||lineRow.playerName||lineRow.player_name||"").trim();
  if(!eventId||!playerName||!CBB_PLAYER_PROP_PROMOTED_MARKETS.includes(market))return{ok:false,reason:"unsupported-or-unmatched"};
  if(projection==null||sigma==null||sigma<=0||line==null)return{ok:false,reason:"projection-line-sigma-required"};
  const delta=projection-line,z=delta/sigma;
  if(Math.abs(z)<CBB_PLAYER_PROP_TRACK_Z)return{ok:false,reason:"below-tracking-threshold",zEdge:r(z)};
  const side=z>0?"MORE":"LESS";
  const safePlayer=norm(playerName).replace(/\s+/g,"-").slice(0,80);
  return{
    ok:true,
    id:[CBB_PLAYER_PROP_MONEY_ID,eventId,safePlayer,market].join(":"),
    modelId:CBB_PLAYER_PROP_MONEY_ID,
    projectionModel:CBB_PLAYER_PROP_MODEL_V2_ID,
    fbisEventId:eventId,
    projectionId:String(lineRow.projectionId||lineRow.projection_id||"")||null,
    playerId:String(lineRow.playerId||lineRow.player_id||candidate.playerId||"")||null,
    playerName,
    team:String(candidate.team||lineRow.team||"")||null,
    market,
    side,
    signalLine:line,
    signalProjection:r(projection),
    signalSigma:r(sigma),
    zEdge:r(z),
    edgeBand:propEdgeBand(z),
    signalAt:String(lineRow.collectedAt||lineRow.collected_at||new Date().toISOString()),
    startTime:String(candidate.start||lineRow.startTime||lineRow.start_time||"")||null,
    modelVersion:String(candidate.modelVersion||candidate.source||CBB_PLAYER_PROP_MODEL_V2_ID),
    dataQuality:n(candidate.dataQuality),
    projectedMinutes:n(candidate.projectedMinutes),
    oddsTier:String(lineRow.oddsTier||lineRow.odds_tier||"")||null,
    canQualify:false,
    canAuthorizeWager:false,
    prospectiveOnly:true,
  };
}

export function gradeCbbPlayerPropSignal(signal={},actual,closeLine=null,closeAt=null){
  const a=n(actual),line=n(signal.signal_line??signal.signalLine),close=n(closeLine);
  if(a==null||line==null)return{ok:false,reason:"actual-and-line-required"};
  const side=String(signal.side||"").toUpperCase();
  let result="PUSH";
  if(side==="MORE")result=a>line?"WIN":a<line?"LOSS":"PUSH";
  else if(side==="LESS")result=a<line?"WIN":a>line?"LOSS":"PUSH";
  else return{ok:false,reason:"invalid-side"};
  const lineClv=close==null?null:(side==="MORE"?close-line:line-close);
  return{ok:true,actual:a,result,closeLine:close,closeAt:closeAt||null,lineClv:r(lineClv),settledAt:new Date().toISOString()};
}
