import {verifyKalshiEventIdentity,classifyKalshiSportContract} from "./kalshiContractIdentity.js";
import {normalizeKalshiShadowOrderbook} from "./kalshiMarketShadow.js";
// Read-only research gate. No sportsbook/model authority, order placement or account access.
const time=x=>{const t=Date.parse(x||"");return Number.isFinite(t)?t:null};
const norm=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const finite=x=>typeof x==="number"&&Number.isFinite(x);
export function qualifyKalshiGameMarket({sport,market,event,fixture,orderbook,bookObservedAt,now=new Date(),settlement=null,feeEvidence=null,requestedContracts=1,modelProbability=null}={}){
 const reasons=[];
 const add=x=>{if(!reasons.includes(x))reasons.push(x)};
 const identity=verifyKalshiEventIdentity({fixture,event,market:{event_ticker:market?.eventTicker}});
 const family=classifyKalshiSportContract({ticker:market?.ticker,title:market?.title,yes_sub_title:market?.yesLabel,rules_primary:market?.rulesPrimary});
 if(!identity.matched)add(identity.reason);
 if(family.family!=="game_winner")add("CONTRACT_FAMILY_NOT_GAME_WINNER");
 if(!["active","open"].includes(String(market?.status||"").toLowerCase()))add("MARKET_NOT_OPEN");
 if(!market?.rulesPrimary||!market?.rulesSecondary)add("COMPLETE_SETTLEMENT_RULES_MISSING");
 const named=norm(market?.yesLabel),home=norm(fixture?.home_name||fixture?.homeName),away=norm(fixture?.away_name||fixture?.awayName);
 const teamSide=identity.matched&&named!==""&&(named===home||named===away);
 const settlementOk=teamSide&&settlement?.verified===true&&settlement?.eventTicker===market?.eventTicker&&settlement?.marketTicker===market?.ticker&&norm(settlement?.yesParticipant)===named&&settlement?.fullGame===true&&settlement?.tiePolicyReviewed===true&&settlement?.postponementReviewed===true&&settlement?.cancellationReviewed===true&&settlement?.payoutDollars===1;
 if(!settlementOk)add("OUTCOME_AND_SETTLEMENT_NOT_VERIFIED");
 const book=orderbook?normalizeKalshiShadowOrderbook(orderbook):null;
 if(!book)add("ORDERBOOK_NOT_VERIFIED");
 const ask=book?.yesAskDollars,size=book?.yesAskSizeContracts,qty=Number(requestedContracts);
 if(!Number.isInteger(qty)||qty<=0||!finite(ask)||ask<=0||ask>=1||!finite(size)||size<qty)add("TOP_LEVEL_LIQUIDITY_INSUFFICIENT");
 const observed=time(bookObservedAt),clock=now instanceof Date?now.getTime():time(now);
 if(observed===null||clock===null||observed>clock||clock-observed>60000)add("ORDERBOOK_OBSERVATION_STALE_OR_MISSING");
 // A fresh HTTP observation cannot establish an exchange-origin quote timestamp.
 add("EXCHANGE_QUOTE_CLOCK_UNVERIFIED");
 const feeTime=time(feeEvidence?.verifiedAt);
 const feeOk=feeEvidence?.verified===true&&feeEvidence?.marketTicker===market?.ticker&&feeEvidence?.quantity===qty&&finite(feeEvidence?.totalFeeDollars)&&feeEvidence.totalFeeDollars>=0&&feeTime!==null&&clock!==null&&feeTime<=clock&&clock-feeTime<=86400000;
 if(!feeOk)add("FEE_SCHEDULE_NOT_VERIFIED");
 const p=finite(modelProbability)&&modelProbability>=0&&modelProbability<=1?modelProbability:null;
 return {sport:sport||null,ticker:market?.ticker||null,canonicalEventId:identity.matched?identity.canonicalEventId:null,family:family.family,eventIdentityVerified:identity.matched,outcomeSettlementVerified:!!settlementOk,observedTopYesAskDollars:ask??null,topYesAskSizeContracts:size??null,restObservedAt:bookObservedAt||null,exchangeQuoteTimestamp:null,feeVerified:feeOk,feeDollars:feeOk?feeEvidence.totalFeeDollars:null,indicativeGrossEdge:p!==null&&finite(ask)?p-ask:null,indicativeNetEdge:p!==null&&finite(ask)&&feeOk&&qty>0?p-ask-feeEvidence.totalFeeDollars/qty:null,reasons,comparabilityCandidate:reasons.every(x=>x==="EXCHANGE_QUOTE_CLOCK_UNVERIFIED"),quoteExecutable:false,executionEligible:false,canQualify:false,canChangeCORE:false,canChangePinnOddsGap:false,canPublishMarketOdds:false,canAuthorizeWager:false,authority:"RESEARCH_ONLY"};
}
