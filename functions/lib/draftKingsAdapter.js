import { normalizeMarketOffer, MARKET_SOURCE_TYPE } from "./normalizedMarket.js";
import { mapUnderdogStat } from "./underdogStatMaps.js";

const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const DK_KEYS=new Set(["draftkings","dk"]);
const GAME_MARKETS=new Map([["h2h","moneyline"],["moneyline","moneyline"],["spreads","spread"],["spread","spread"],["run_line","spread"],["totals","total"],["total","total"],["total_runs","total"],["total_points","total"]]);

function dkBooks(event){return (event?.bookmakers||[]).filter(b=>DK_KEYS.has(String(b?.key||b?.title||"").toLowerCase().replace(/\s+/g,"")))}

export function normalizeDraftKingsEvents(events=[],{sport=null,league=null,fetchedAt=new Date().toISOString(),executionEligible=false}={}){
 const offers=[],warnings=[];
 for(const event of events||[]){
  for(const book of dkBooks(event)){
   for(const market of book.markets||[]){
    const family=GAME_MARKETS.get(String(market.key||"").toLowerCase());
    if(!family){warnings.push("UNSUPPORTED_DK_MARKET:"+String(market.key||"unknown"));continue}
    for(const outcome of market.outcomes||[]){
      const name=String(outcome.name||"");
      let side=null,team=null;
      if(family==="moneyline"||family==="spread"){
        team=name||null;
        if(norm(name)===norm(event.home_team))side="home"; else if(norm(name)===norm(event.away_team))side="away";
      } else if(family==="total"){if(/^over$/i.test(name))side="over";else if(/^under$/i.test(name))side="under"}
      if(!side){warnings.push("UNRESOLVED_DK_SIDE:"+String(outcome.id||name||"unknown"));continue}
      offers.push(normalizeMarketOffer({source:"draftkings",sourceType:MARKET_SOURCE_TYPE.SPORTSBOOK,sport,league,
       eventId:event.id,eventStart:event.commence_time,homeTeam:event.home_team,awayTeam:event.away_team,team,
       marketFamily:family,statFamily:null,side,line:outcome.point??null,americanOdds:outcome.price,
       standardOrAlt:outcome._main===false?"alternate":outcome._main===true?"standard":"unknown",promo:false,period:"full_game",
       sourceMarketId:market.id||market.key,sourceOutcomeId:outcome.id||null,fetchedAt,executionEligible,raw:{eventId:event.id,book:book.key||book.title,marketKey:market.key,outcome}}));
    }
   }
  }
 }
 return {ok:true,source:"draftkings",sourceType:"sportsbook",rawEventCount:(events||[]).length,normalizedCount:offers.length,warnings:[...new Set(warnings)],offers};
}

export function normalizeDraftKingsPlayerRows(rows=[],{sport=null,league=null,fetchedAt=new Date().toISOString(),executionEligible=false}={}){
 const offers=[],warnings=[];
 for(const row of rows||[]){
   const book=String(row.sportsbook||row.book||"").toLowerCase().replace(/\s+/g,"");
   if(!DK_KEYS.has(book))continue;
   const label=row.market_label||row.market_name||row.market_type||row.stat_type;
   const mapped=mapUnderdogStat(sport,label);
   if(!mapped.statFamily||!mapped.modelSupported){warnings.push("UNSUPPORTED_DK_PROP:"+String(label||"unknown"));continue}
   const side=String(row.selection_type||row.side||row.selection||"").toLowerCase();
   const normalizedSide=/over|higher/.test(side)?"over":/under|lower/.test(side)?"under":null;
   if(!normalizedSide){warnings.push("UNRESOLVED_DK_PROP_SIDE:"+String(row.id||label||"unknown"));continue}
   offers.push(normalizeMarketOffer({source:"draftkings",sourceType:MARKET_SOURCE_TYPE.SPORTSBOOK,sport,league,
     eventId:row.event_id||row.event_uuid,eventStart:row.event_start_time,homeTeam:row.home_team,awayTeam:row.away_team,
     playerId:row.player_id,playerName:row.player_name||row.player,team:row.team,opponent:row.opponent,
     marketFamily:"player_prop",statFamily:mapped.statFamily,side:normalizedSide,line:row.line??row.point,americanOdds:row.odds_american??row.price,
     standardOrAlt:row.is_main_line===true?"standard":row.is_main_line===false?"alternate":"unknown",promo:false,period:row.period||"full_game",
     sourceMarketId:row.market_id||row.market_type,sourceOutcomeId:row.outcome_id||row.id,fetchedAt,executionEligible,raw:row}));
 }
 return {ok:true,source:"draftkings",sourceType:"sportsbook",rawCount:(rows||[]).length,normalizedCount:offers.length,warnings:[...new Set(warnings)],offers};
}
