import { decisionFromOffer } from "./wagerDecisionEngine.js";

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const WNBA_WAGER_DECISION_VERSION="WNBA-WAGER-DECISION-v1";

export function buildWnbaOffers(game={}){
  const o=game.odds||{};
  const book=o.heritageListed?"Heritage":o.pinPresent?"Pinnacle":o.softSource||"Market";
  const observedAt=o.observedAt||o.sourceObservedAt||game.marketObservedAt||null;
  const rows=[];
  const push=(market,side,line,price)=> {
    const p=finite(price),l=finite(line);
    if(p==null)return;
    rows.push({market,side,line:l,price:p,sportsbook:book,observedAt,executionReady:true});
  };
  if(finite(o.spread)!=null){
    push("SPREAD","HOME",finite(o.spread),o.heritageSpreadHomePrice??o.pinSpreadHomePrice??o.softSpreadHomePrice??o.spreadPrice);
    push("SPREAD","AWAY",-finite(o.spread),o.heritageSpreadAwayPrice??o.pinSpreadAwayPrice??o.softSpreadAwayPrice);
  }
  if(finite(o.total)!=null){
    push("TOTAL","OVER",finite(o.total),o.heritageOverPrice??o.pinOverPrice??o.softOverPrice);
    push("TOTAL","UNDER",finite(o.total),o.heritageUnderPrice??o.pinUnderPrice??o.softUnderPrice);
  }
  push("MONEYLINE","HOME",null,o.heritageHomeMl??o.pinHomeMl??o.homeMl);
  push("MONEYLINE","AWAY",null,o.heritageAwayMl??o.pinAwayMl??o.awayMl);
  return rows;
}

export function decomposeWnbaProjection(game={}){
  const p=game.wnbaV2||game.challengers?.["WNBA-FBIS-v2"]||{};
  const d=p.decomposition||{};
  const league=finite(d.leagueOrtg);
  const home=d.home||{},away=d.away||{};
  const factors=[];
  const add=(name,value,unit="pts_per_100",reliability=null,note=null)=>{
    const v=finite(value); if(v==null)return;
    factors.push({name,value:v,unit,reliability:finite(reliability),note});
  };
  add("home_offense_vs_league",finite(home.ortg)-league,"pts_per_100",Math.min(1,(finite(home.games)||0)/14));
  add("away_offense_vs_league",finite(away.ortg)-league,"pts_per_100",Math.min(1,(finite(away.games)||0)/14));
  add("home_defense_vs_league",league-finite(home.drtg),"pts_per_100",Math.min(1,(finite(home.games)||0)/14));
  add("away_defense_vs_league",league-finite(away.drtg),"pts_per_100",Math.min(1,(finite(away.games)||0)/14));
  add("projected_pace",d.pace,"possessions",Math.min(1,Math.min(finite(home.games)||0,finite(away.games)||0)/14));
  add("home_matchup_ortg",home.matchupOrtg,"pts_per_100");
  add("away_matchup_ortg",away.matchupOrtg,"pts_per_100");
  add("home_field",d.hfa,"points",1,game.neutralSite?"Neutral site":"WNBA home-court adjustment");
  return {
    modelId:p.modelId||"WNBA-FBIS-v2",
    modelVersion:p.modelVersion||game.modelVersion||null,
    projectedHome:finite(p.home??game.projHomeScore),
    projectedAway:finite(p.away??game.projAwayScore),
    margin:finite(p.margin??game.model?.projMargin),
    total:finite(p.total??game.model?.projTotal),
    sigmaMargin:finite(p.sigmaMargin)??10.2,
    sigmaTotal:finite(p.sigmaTotal)??12.1,
    pHomeWin:finite(p.pHomeWin??game.model?.pHomeFinal??game.model?.pHome),
    factors,
    independent:true,
    marketInformed:false,
  };
}

function selectedObservation(row,offer){
  const m=String(offer.market||"").toLowerCase();
  const side=String(offer.side||"").toLowerCase();
  if(String(row.market_type||"").toLowerCase()!==m)return false;
  if(m==="total")return String(row.selection||"").toLowerCase()===side;
  if(m==="spread"||m==="moneyline")return String(row.selection||"").toLowerCase()===side;
  return false;
}

function towardSelection(market,lineDelta,priceDelta){
  if(market==="SPREAD")return lineDelta==null?null:lineDelta<0?"CONFIRMS":lineDelta>0?"OPPOSES":"MIXED";
  if(market==="TOTAL")return lineDelta==null?null:lineDelta>0?"CONFIRMS":lineDelta<0?"OPPOSES":"MIXED";
  if(market==="MONEYLINE")return priceDelta==null?null:priceDelta<0?"CONFIRMS":priceDelta>0?"OPPOSES":"MIXED";
  return null;
}
function totalConfirmation(side,lineDelta){
  if(lineDelta==null)return null;
  if(side==="OVER")return lineDelta>0?"CONFIRMS":lineDelta<0?"OPPOSES":"MIXED";
  if(side==="UNDER")return lineDelta<0?"CONFIRMS":lineDelta>0?"OPPOSES":"MIXED";
  return null;
}
function modelEdge(distribution,offer,line){
  const l=finite(line); if(l==null)return null;
  if(offer.market==="SPREAD"){
    return offer.side==="HOME"?finite(distribution.margin)+l:-finite(distribution.margin)+l;
  }
  if(offer.market==="TOTAL"){
    return offer.side==="OVER"?finite(distribution.total)-l:l-finite(distribution.total);
  }
  return null;
}

export function deriveWnbaMarketTrajectory(rows=[],offer={},distribution={}){
  const ordered=(rows||[]).filter(r=>selectedObservation(r,offer)).sort((a,b)=>Date.parse(a.collected_at||a.provider_timestamp||0)-Date.parse(b.collected_at||b.provider_timestamp||0));
  if(!ordered.length)return {
    available:false,opening:null,current:null,lineMovement:null,movementVelocityPerHour:null,persistence:null,reversal:false,
    ticketPct:null,moneyPct:null,moneyMinusTicket:null,reverseLineMovement:false,marketConfirmation:"UNKNOWN",
    edgeOpen:null,edgeCurrent:null,edgeChange:null,snapshotCount:0,
  };
  const open=ordered[0],current=ordered.at(-1);
  const openLine=finite(open.line),currentLine=finite(current.line);
  const openPrice=finite(open.american_price),currentPrice=finite(current.american_price);
  const lineDelta=openLine==null||currentLine==null?null:currentLine-openLine;
  const priceDelta=openPrice==null||currentPrice==null?null:currentPrice-openPrice;
  const elapsed=(Date.parse(current.collected_at||current.provider_timestamp||"")-Date.parse(open.collected_at||open.provider_timestamp||""))/3600000;
  const velocity=lineDelta==null||!(elapsed>0)?null:lineDelta/elapsed;
  const deltas=[];
  for(let i=1;i<ordered.length;i++){
    const a=finite(ordered[i-1].line),b=finite(ordered[i].line);
    if(a!=null&&b!=null&&b!==a)deltas.push(Math.sign(b-a));
  }
  const reversal=deltas.some((s,i)=>i>0&&s!==deltas[i-1]);
  const persistence=deltas.length?Math.abs(deltas.reduce((a,b)=>a+b,0))/deltas.length:null;
  const ticketPct=finite(current.public_ticket_pct),moneyPct=finite(current.public_money_pct);
  let confirmation;
  if(offer.market==="TOTAL")confirmation=totalConfirmation(offer.side,lineDelta);
  else confirmation=towardSelection(offer.market,lineDelta,priceDelta);
  const publicHeavy=ticketPct!=null&&ticketPct>=60;
  const reverseLineMovement=publicHeavy&&confirmation==="OPPOSES";
  const edgeOpen=modelEdge(distribution,offer,openLine),edgeCurrent=modelEdge(distribution,offer,currentLine);
  return {
    available:true,
    opening:{line:openLine,price:openPrice,observedAt:open.provider_timestamp||open.collected_at||null},
    current:{line:currentLine,price:currentPrice,observedAt:current.provider_timestamp||current.collected_at||null},
    lineMovement:lineDelta,priceMovement:priceDelta,movementVelocityPerHour:velocity,
    persistence,reversal,ticketPct,moneyPct,moneyMinusTicket:ticketPct==null||moneyPct==null?null:moneyPct-ticketPct,
    reverseLineMovement,marketConfirmation:confirmation||"UNKNOWN",
    edgeOpen,edgeCurrent,edgeChange:edgeOpen==null||edgeCurrent==null?null:edgeCurrent-edgeOpen,
    snapshotCount:ordered.length,
    sharpSteamAvailable:false,
    note:"ACTION is Wager Intelligence only; it does not alter WNBA-FBIS-v2 projection.",
  };
}

export async function loadWnbaActionRows(db,eventId,{limit=120}={}){
  if(!db?.prepare||!eventId)return [];
  try{
    const res=await db.prepare(
      `SELECT market_type,selection,line,american_price,sportsbook,provider_timestamp,collected_at,
              public_ticket_pct,public_money_pct,money_minus_ticket_pct,snapshot_type
         FROM action_market_book_observations
        WHERE sport='wnba' AND canonical_event_id=?
        ORDER BY collected_at ASC
        LIMIT ?`
    ).bind(String(eventId),Math.max(1,Math.min(240,Number(limit)||120))).all();
    return res?.results||[];
  }catch{return [];}
}

export function wnbaEvidence(game={},projection={}){
  const h=projection?.factors?.find(x=>x.name==="home_offense_vs_league");
  const a=projection?.factors?.find(x=>x.name==="away_offense_vs_league");
  const minGames=Math.min(
    finite(game?.wnbaV2?.decomposition?.home?.games)||0,
    finite(game?.wnbaV2?.decomposition?.away?.games)||0
  );
  const matchupReliability=clamp(minGames/14,0,1);
  const factorCount=(projection?.factors||[]).filter(x=>finite(x.value)!=null).length;
  const dataQuality=clamp((factorCount/8)*0.65+matchupReliability*0.35,0,1);
  const uncertaintyQuality=clamp(1-((finite(projection.sigmaMargin)||10.2)-8)/10,0.25,1);
  const historicalFactorReliability=clamp(
    ((finite(h?.reliability)||matchupReliability)+(finite(a?.reliability)||matchupReliability))/2,
    0,1
  );
  return {matchupReliability,dataQuality,uncertaintyQuality,historicalFactorReliability,priceQuality:0.75,stakeUnits:null};
}

export async function buildWnbaGameDecisions(game={},db=null,{minEv=0.03,calibrationLookup=null}={}){
  const distribution=decomposeWnbaProjection(game);
  if(distribution.margin==null||distribution.total==null)return {gameId:game.id,ok:false,reason:"independent_projection_missing",offers:[]};
  const offers=buildWnbaOffers(game);
  const actionRows=await loadWnbaActionRows(db,game.id);
  const evidence=wnbaEvidence(game,distribution);
  const decisions=[];
  for(const offer of offers){
    const intelligence=deriveWnbaMarketTrajectory(actionRows,offer,distribution);
    let decision=decisionFromOffer({
      offer,distribution,intelligence,evidence,minEv,
      stakeRulesValidated:false,
    });
    const cal=typeof calibrationLookup==="function"
      ?await calibrationLookup({game,offer,distribution,intelligence,evidence,decision})
      :null;
    if(cal?.confidence!=null&&Number(cal?.n)>=30){
      decision=decisionFromOffer({
        offer,distribution,intelligence,evidence,minEv,
        calibratedConfidence:cal.confidence,
        confidenceCalibrationN:cal.n,
        stakeRulesValidated:false,
      });
    }
    decisions.push(decision);
  }
  return {
    ok:true,gameId:String(game.id||""),sport:"wnba",start:game.start||null,
    matchup:`${game.away?.abbr||game.away?.name||"AWAY"} @ ${game.home?.abbr||game.home?.name||"HOME"}`,
    model:distribution,offers:decisions,
    decisionVersion:WNBA_WAGER_DECISION_VERSION,
    bestBet:decisions.filter(x=>x.decision==="BET").sort((a,b)=>(b.expectedValue??-9)-(a.expectedValue??-9))[0]||null,
  };
}
