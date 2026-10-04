export const CFB_PLAYER_PROP_MONEY_ID="CFB-PLAYER-PROP-MONEY-v2";
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null}; const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
export function buildCfbPropSignal(candidate={},lineRow={}){
 const eventId=String(candidate.eventId||lineRow.fbisEventId||""); const player=String(candidate.playerName||lineRow.playerName||"").trim();
 const market=String(candidate.market||lineRow.canonicalMarket||""); const projection=n(candidate.fbisProjection??candidate.projection),sigma=n(candidate.fbisSigma??candidate.sigma),line=n(lineRow.line??candidate.line);
 if(!eventId||!player||!market||projection==null||sigma==null||sigma<=0||line==null)return{ok:false,reason:"required-fields"};
 const z=(projection-line)/sigma; if(Math.abs(z)<0.5)return{ok:false,reason:"below-tracking-threshold",zEdge:z};
 return {ok:true,id:[CFB_PLAYER_PROP_MONEY_ID,eventId,norm(player),market].join(":"),modelId:CFB_PLAYER_PROP_MONEY_ID,eventId,playerName:player,playerId:candidate.playerId||lineRow.playerId||null,
  market,side:z>0?"MORE":"LESS",signalLine:line,signalProjection:projection,signalSigma:sigma,zEdge:z,signalAt:lineRow.collectedAt||new Date().toISOString(),
  confidenceScore:candidate.confidenceScore??null,confidenceStars:candidate.confidenceStars??null,canAuthorizeWager:false,prospectiveOnly:true};
}
export function gradeCfbPropSignal(signal={},actual,closeLine=null){
 const a=n(actual),line=n(signal.signalLine??signal.signal_line),close=n(closeLine);if(a==null||line==null)return{ok:false,reason:"actual-and-line-required"};
 const side=String(signal.side||"").toUpperCase();if(!["MORE","LESS"].includes(side))return{ok:false,reason:"invalid-side"};
 const result=a===line?"PUSH":side==="MORE"?(a>line?"WIN":"LOSS"):(a<line?"WIN":"LOSS");
 return {ok:true,actual:a,result,closeLine:close,lineClv:close==null?null:(side==="MORE"?close-line:line-close),settledAt:new Date().toISOString()};
}
