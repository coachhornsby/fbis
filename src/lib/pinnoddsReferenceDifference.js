import {selectPinnoddsGameMarkets} from "./pinnoddsMarketSelection.js";

const SCORE_SPORTS=new Set(["cfb","nfl","cbb","nba","wnba","nhl","mlb","npb","kbo"]);
const value=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const rounded=n=>Math.round(n*10)/10;

/**
 * Research-only gap between independently modeled scores and paired PinnOdds
 * lines. A projected-points difference is NOT ATS cover probability, EV,
 * live execution authorization, or a quoted price.
 */
export function pinnoddsReferenceDifference(game={},projection={}) {
  const missing={spread:null,total:null,leading:null,available:false,researchOnly:true};
  if(!SCORE_SPORTS.has(String(game?.sport||"").toLowerCase())||
    game?.durableFallback?.statusUnverified===true||!projection?.available)return missing;
  const away=value(projection.away),home=value(projection.home);
  if(away==null||home==null)return missing;
  const selection=selectPinnoddsGameMarkets(game);
  const spreadPair=selection.families.spread,totalPair=selection.families.total;
  const homeQuote=spreadPair?.quotes.find(q=>q.side==="home")||null;
  const awayQuote=spreadPair?.quotes.find(q=>q.side==="away")||null;
  const offeredHome=value(homeQuote?.line),modelHome=rounded(away-home);
  const spread=offeredHome==null||!awayQuote?null:{
    kind:"spread",modelHome,offeredHome,delta:rounded(modelHome-offeredHome),
    absDelta:rounded(Math.abs(modelHome-offeredHome)),
    side:modelHome-offeredHome>0?"away":modelHome-offeredHome<0?"home":"equal",
    quotes:spreadPair.quotes,mainVerified:spreadPair.primaryVerified
  };
  const offeredTotal=value(totalPair?.quotes[0]?.line);
  const modelTotal=value(projection.total)??rounded(away+home);
  const total=offeredTotal==null||!totalPair?null:{
    kind:"total",modelTotal:rounded(modelTotal),offeredTotal,
    delta:rounded(modelTotal-offeredTotal),
    absDelta:rounded(Math.abs(modelTotal-offeredTotal)),
    side:modelTotal>offeredTotal?"over":modelTotal<offeredTotal?"under":"equal",
    quotes:totalPair.quotes,mainVerified:totalPair.primaryVerified
  };
  const leading=[spread,total].filter(Boolean).sort((a,b)=>b.absDelta-a.absDelta)[0]||null;
  return {...missing,spread,total,leading,available:Boolean(leading),
    capturedAt:selection.capturedAt||leading?.quotes?.[0]?.capturedAt||null,
    label:"FBIS / PINNODDS PROJECTION GAP",executable:false,evEligible:false};
}
