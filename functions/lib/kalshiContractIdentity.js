/**
 * Conservative Kalshi sport-contract classification.
 * Never infer canonical athlete, game, period or side from ticker abbreviations.
 * An exact independently verified fixture title + start is required for
 * any possible manual comparison. This module has ZERO authority to promote.
 */
const clean = v => String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const at=v=>Number.isFinite(Date.parse(v||""))?Date.parse(v):null;
const isTicker=v=>/^[A-Z0-9_.-]{4,160}$/.test(String(v||""));
export function classifyKalshiSportContract(m={}) {
 const legs=Array.isArray(m.mve_selected_legs)?m.mve_selected_legs:[];
 const multi=legs.length>1||Boolean(m.mve_collection_ticker);
 const text=clean([m.title,m.subtitle,m.yes_sub_title,m.rules_primary].join(" "));
 const detected=multi?"combo":/\b(player|passing yards|rushing yards|receiving yards|receptions|touchdowns|strikeouts|points scored)\b/.test(text)
   ?"player_prop":/\b(wins|winner|moneyline|win the game)\b/.test(text)?"game_winner":"unclassified";
 return {
  ticker:isTicker(m.ticker)?m.ticker:null,
  family:detected,hasSelectedLegs:legs.length>0,
  selectedLegs:legs.filter(l=>isTicker(l?.market_ticker)&&["yes","no"].includes(String(l.side).toLowerCase()))
    .slice(0,12).map(l=>({marketTicker:l.market_ticker,eventTicker:String(l.event_ticker||"").slice(0,160),
      side:String(l.side).toLowerCase()})),
  playerId:null,canonicalEventId:null,period:"UNVERIFIED",
  contractRulesVerified:false,settlementVerified:false,feesVerified:false,
  executionEligible:false,canQualify:false,canAuthorizeWager:false,
  reason:multi?"COMBO_CONTRACT_LEGS_REQUIRE_RFQ_AND_SETTLEMENT_PROOF":
    detected==="player_prop"?"PLAYER_ID_STAT_THRESHOLD_UNVERIFIED":
    detected==="game_winner"?"EVENT_AND_OUTCOME_UNVERIFIED":
    "CONTRACT_FAMILY_UNVERIFIED",
 };
}
export function verifyKalshiEventIdentity({fixture,event,market}={}){
 const fixtureStart=at(fixture?.startTime || fixture?.start_time || fixture?.event_start_time);
 const providerStart=at(event?.kickoffTime||event?.verifiedGameStartTime);
 const a=clean(fixture?.away_name||fixture?.awayName);
 const h=clean(fixture?.home_name||fixture?.homeName);
 const title=clean(event?.title);
 const teamsExact=a&&h&&a!==h&&
   [a+" vs "+h,h+" vs "+a,a+" at "+h,h+" at "+a].some(t=>clean(t)===title);
 const validMarket=market?.event_ticker && event?.event_ticker
   &&market.event_ticker===event.event_ticker;
 if(!fixtureStart||!providerStart||!teamsExact||!validMarket||
   Math.abs(fixtureStart-providerStart)>2*60*60*1000){
   return {matched:false,canonicalEventId:null,reason:
     !fixtureStart?"CANONICAL_START_MISSING":
     !providerStart?"PROVIDER_KICKOFF_NOT_VERIFIED":
     !teamsExact?"TWO_TEAM_IDENTITY_UNVERIFIED":
     !validMarket?"EVENT_TICKER_MISMATCH":"KICKOFF_MISMATCH",
     canQualify:false,executionEligible:false};
 }
 // This is an event-identity candidate only, NOT proof of market side,
 // exact line, settlement conditions, cash payout or fee-adjusted execution.
 return {matched:true,canonicalEventId:String(fixture.id||""),
   reason:"TWO_TEAMS_KICKOFF_EVENT_TICKER_VERIFIED",
   sideVerified:false,periodVerified:false,contractRulesVerified:false,
   canQualify:false,executionEligible:false};
}
export function kalshiPropAndComboGate(market={}){
 const contract=classifyKalshiSportContract(market);
 return {...contract,quoteExecutable:false,impliedJointProbability:null,
   approvedForPlayerProps:false,approvedForCombos:false};
}
