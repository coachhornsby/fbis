import {resolveTeamExact} from './teams.js';
const SERIES='KXNCAAMB1HTOTAL';
const MONTHS={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const ageOk=(date,now,maxMs)=>{const t=Date.parse(date||'');return Number.isFinite(t)&&t<=now&&now-t<=maxMs;};
const ctDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const id=name=>{const t=resolveTeamExact('cbb',{name});return t?.id==null?null:String(t.id);};
const quote=p=>typeof p==='number'&&Number.isFinite(p)&&p>0&&p<1?p:null;
/** Only accept an explicitly first-half Kalshi rule. A full-game rule cannot match. */
export function parseKalshiCbbFirstHalfTotalRule(text){
 const match=String(text||'').match(/^(?:Resolves Yes if|If) over (\d+(?:\.\d+)?) total points are scored in the 1st half of the (.+?) vs (.+?) men's college basketball game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?:\.|, then the market resolves to Yes\.)/);
 if(!match||!MONTHS[match[4]])return null;
 const line=Number(match[1]),awayId=id(match[2]),homeId=id(match[3]);
 if(!awayId||!homeId||awayId===homeId||!Number.isFinite(line)||line<=0||line>150||
    Math.abs(line*2-Math.round(line*2))>1e-8||Math.round(line*2)%2!==1)return null;
 return {period:'1h',marketFamily:'total',line,awayId,homeId,
  date:match[6]+'-'+MONTHS[match[4]]+'-'+match[5].padStart(2,'0')};
}
/** Source-only market explorer quotes. No fee, executable-price or wager authority. */
export function matchedKalshiCbbFirstHalfTotals(fixtures=[],snapshot,{now=Date.now(),retainLastObserved=false}={}){
 const result={};
 if(snapshot?.ok!==true||snapshot.sport!=='cbb_1h_total'||snapshot.seriesTicker!==SERIES||
  !Array.isArray(snapshot.records)||snapshot.records.length>4000||
  !ageOk(snapshot.capturedAt,now,retainLastObserved?Infinity:1800000))return result;
 for(const market of snapshot.records){
  if(market?.sport!=='cbb_1h_total'||market.seriesTicker!==SERIES||market.status!=='active'||
   !market.ticker?.startsWith(SERIES+'-')||!market.eventTicker?.startsWith(SERIES+'-')||
   !market.ticker.startsWith(market.eventTicker+'-')||(!ageOk(market.fetchedAt,now,retainLastObserved?Infinity:900000)||Date.parse(market.fetchedAt)>Date.parse(snapshot.capturedAt)))continue;
  const rule=parseKalshiCbbFirstHalfTotalRule(market.rulesPrimary);
  if(!rule)continue;
  const matching=fixtures.filter(game=>{if(!Number.isFinite(Date.parse(game.start||''))||
   ctDay(game.start)!==rule.date)return false;
   return id(game.away_name)===rule.awayId&&id(game.home_name)===rule.homeId;
  });
  if(matching.length!==1)continue;
  const game=matching[0];
  for(const [side,ask] of [['over',quote(market.yesAskDollars)],['under',quote(market.noAskDollars)]]){
   if(ask==null)continue;
   (result[game.id]??=[]).push({venue:'Kalshi',marketFamily:'total',period:'1h',side,
    line:rule.line,ask,receivedAt:market.fetchedAt,providerObservedAt:null,
    eventStart:game.start,transport:'REST',marketId:market.ticker,eventTicker:market.eventTicker,marketUrl:market.marketUrl||null,stale:!ageOk(market.fetchedAt,now,900000),quoteAgeSeconds:Math.floor((now-Date.parse(market.fetchedAt))/1000),marketStatus:'active',canRecommend:false,canChangeProjection:false,executionEligible:false,
    sourceSeries:SERIES,referenceOnly:true,canQualify:false,canAuthorizeWager:false});
  }
 }
 return result;
}
