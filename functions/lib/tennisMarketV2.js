/**
 * TENNIS-FBIS-MARKET-v2
 * Market residual layer. Anchors to a sharp/consensus prior and asks whether
 * independent fundamentals/context justify moving away from it.
 * Research-only until prospective CLV/ROI validation passes.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const logistic=z=>1/(1+Math.exp(-z));

export const TENNIS_MARKET_MODEL_ID="TENNIS-FBIS-MARKET-v2";
export const TENNIS_MARKET_VERSION="v2-market-residual-1";

export function americanToProb(o){
  o=finite(o); if(o==null||o===0)return null;
  return o>0?100/(o+100):(-o)/((-o)+100);
}
export function decimalToProb(o){
  o=finite(o);return o!=null&&o>1?1/o:null;
}
export function noVigTwoWay(a,b,{format="american"}={}){
  const conv=format==="decimal"?decimalToProb:americanToProb;
  const pa=conv(a),pb=conv(b); if(pa==null||pb==null)return null;
  const z=pa+pb; if(!(z>0))return null;
  return {p1:pa/z,p2:pb/z,hold:z-1};
}
function median(xs){
  const a=xs.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return null;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function sd(xs){
  const a=xs.filter(Number.isFinite);if(a.length<2)return null;
  const m=a.reduce((s,x)=>s+x,0)/a.length;
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));
}

// Acquisition provider and sportsbook/source labels are distinct provenance.
// Either field can identify ACTION; a book label cannot mask that acquisition.
export function hasActionTennisProvenance(quote={}) {
  return [quote.source,quote.provider].some(value=>/ACTION/i.test(String(value||"")));
}
export function tennisQuoteAcquisitionProvider(quote={}) {
  return [quote.provider,quote.source].find(value=>/ACTION/i.test(String(value||"")))
    ||quote.source||"MARKET_FEED";
}

/** Convert book quotes to no-vig p1 probabilities. */
export function normalizeTennisMarketQuotes(quotes=[]){
  return (quotes||[]).map(q=>{
    const format=q.format||((finite(q.p1Price)>1&&finite(q.p2Price)>1)?"decimal":"american");
    const nv=noVigTwoWay(q.p1Price,q.p2Price,{format});
    return nv?{
      book:String(q.book||"unknown").toLowerCase(),
      p1:nv.p1,p2:nv.p2,hold:nv.hold,
      observedAt:q.observedAt||null,
      collectedAt:q.collectedAt??null,
      isExchange:Boolean(q.isExchange),
      volume:finite(q.volume),
      source:q.source||null,
      provider:q.provider||null,
    }:null;
  }).filter(Boolean);
}

export function buildSharpMarketPrior({quotes=[],pinnacle=null,betfair=null}={}){
  const qs=normalizeTennisMarketQuotes(quotes);
  const byBook=new Map(qs.map(q=>[q.book,q]));
  const pin=pinnacle||byBook.get("pinnacle")||byBook.get("pinny")||null;
  const bf=betfair||byBook.get("betfair")||null;
  const all=qs.map(q=>q.p1);
  const consensus=median(all),dispersion=sd(all);
  let prior=null,source=null;
  if(pin&&bf){
    const w=bf.volume!=null?clamp(Math.log10(Math.max(10,bf.volume))/6,.20,.45):.30;
    prior=(1-w)*pin.p1+w*bf.p1;source="pinnacle+betfair";
  }else if(pin){prior=pin.p1;source="pinnacle";}
  else if(bf){prior=bf.p1;source="betfair";}
  else if(consensus!=null){prior=consensus;source="multibook-consensus";}
  return {p1:prior,p2:prior==null?null:1-prior,source,consensus,dispersion,quotes:qs};
}

export function actionTennisSignals(actionIntel={}){
  const markets=actionIntel?.publicSplits?.markets||[];
  const ml=markets.find(m=>String(m.market).toUpperCase()==="ML")||null;
  const history=Array.isArray(actionIntel?.lineHistory)?actionIntel.lineHistory:[];
  const points=history.filter(x=>finite(x.odds)!=null||finite(x.line)!=null)
    .map(x=>({t:Date.parse(x.observedAt||x.collectedAt||""),odds:finite(x.odds),line:finite(x.line),book:x.book||null}))
    .filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
  let velocity=null;
  if(points.length>=2){
    const a=points[0],b=points.at(-1),hrs=(b.t-a.t)/36e5;
    if(hrs>0&&a.odds!=null&&b.odds!=null)velocity=(b.odds-a.odds)/hrs;
  }
  return {
    ticketPct:finite(ml?.ticketPct??actionIntel?.publicSplits?.ticketPct),
    moneyPct:finite(ml?.moneyPct??actionIntel?.publicSplits?.moneyPct),
    moneyTicketGap:finite(ml?.moneyTicketGap??actionIntel?.publicSplits?.moneyTicketGap),
    trackedBetCount:finite(actionIntel?.trackedBetCount),
    trackedVolume:finite(actionIntel?.trackedVolume),
    lineVelocityAmericanPerHour:velocity,
    hasActionData:Boolean(ml||points.length),
    sharpLabel:null,
  };
}

/**
 * Market-residual probability.
 * Market stays dominant by design. Fundamental information may move the prior
 * only modestly unless later walk-forward calibration proves larger residuals.
 */
export function tennisMarketResidualProjection({
  fundamentalP1,
  market,
  actionIntel=null,
  contextDifferential=0,
  residualWeight=.22,
  maxResidualLogit=.45,
}={}){
  const f=finite(fundamentalP1),m=finite(market?.p1);
  if(f==null||m==null)return {
    modelId:TENNIS_MARKET_MODEL_ID,modelVersion:TENNIS_MARKET_VERSION,
    p1:null,p2:null,decisionEligible:false,canQualify:false,canAuthorizeWager:false,
    reason:"missing-fundamental-or-market"
  };
  const action=actionTennisSignals(actionIntel||{});
  let residual=clamp(logit(f)-logit(m),-maxResidualLogit,maxResidualLogit);
  // Research-only weak contextual modifiers; all are capped.
  let modifier=clamp(finite(contextDifferential)||0,-.15,.15);
  if(action.moneyTicketGap!=null) modifier+=clamp(action.moneyTicketGap/100*.08,-.035,.035);
  const p1=logistic(logit(m)+residualWeight*residual+modifier);
  return {
    modelId:TENNIS_MARKET_MODEL_ID,modelVersion:TENNIS_MARKET_VERSION,
    p1,p2:1-p1,marketPrior:m,fundamentalP1:f,
    marketResidual:f-m,appliedResidualLogit:residualWeight*residual,
    action,marketSource:market.source||null,marketDispersion:market.dispersion??null,
    decisionEligible:false,canQualify:false,canAuthorizeWager:false,
    governance:"RESEARCH_ONLY"
  };
}

export function deriveMarketMovementFeatures(snapshots=[]){
  const rows=(snapshots||[]).filter(x=>finite(x.p1)!=null&&x.observedAt)
    .map(x=>({...x,p1:Number(x.p1),t:Date.parse(x.observedAt)})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
  if(!rows.length)return {n:0};
  const open=rows[0],close=rows.at(-1),dtH=(close.t-open.t)/36e5;
  let reversals=0,lastSign=0;
  for(let i=1;i<rows.length;i++){
    const d=rows[i].p1-rows[i-1].p1,s=Math.sign(d);
    if(s&&lastSign&&s!==lastSign)reversals++;
    if(s)lastSign=s;
  }
  return {
    n:rows.length,openP1:open.p1,currentP1:close.p1,
    move:close.p1-open.p1,velocityPerHour:dtH>0?(close.p1-open.p1)/dtH:null,
    reversals,hoursObserved:dtH,
  };
}
