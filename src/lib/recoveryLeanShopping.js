// Compact four-sport research display: compare only real, event-matched full-game sportsbook lines.
// Display differences are not calibrated win probabilities, EV, or wager authorization.
export const RECOVERY_QUOTE_TTL_MS=5*60*1000;
const SPORT_GAPS=Object.freeze({
 cbb:{side:2,total:3},nba:{side:2,total:3},nfl:{side:1.5,total:2.5},cfb:{side:2.5,total:3.5}
});
const finite=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const rounded=v=>Math.round(v*10)/10;
const signed=v=>(v>0?'+':'')+rounded(v).toFixed(1);
const formatLine=v=>(v>0?'+':'')+rounded(v).toFixed(1);
function americanOdds(q){
 const a=finite(q?.americanOdds);
 if(a!==null&&Number.isInteger(a)&&Math.abs(a)>=100&&Math.abs(a)<=100000)return a;
 const d=finite(q?.decimalOdds);
 if(d!==null&&d>1.001&&d<=1000)return d>=2?Math.round((d-1)*100):-Math.round(100/(d-1));
 return null;
}
function normalizeQuote(raw,game,now,maxAgeMs){
 if(!raw||typeof raw!=='object')return null;
 const eventId=String(raw.canonicalEventId||raw.canonical_event_id||raw.eventId||raw.gameId||'');
 const sport=String(raw.sport||'').toLowerCase();
 const family=String(raw.marketFamily||raw.market_family||'').toLowerCase();
 const period=String(raw.period||'').toLowerCase();
 const side=String(raw.side||'').toLowerCase();
 const book=String(raw.source||raw.bookmaker||raw.provider||'').trim();
 const rawStatus=String(raw.marketState||raw.status||'').toLowerCase();
 const observedAt=String(raw.sourceObservedAt||raw.capturedAt||raw.collectedAt||raw.fetchedAt||'');
 const time=Date.parse(observedAt),start=Date.parse(game.start);
 const line=finite(raw.line),american=americanOdds(raw);
 if(!Number.isFinite(start)||game.status!=='scheduled'||now>=start||
   sport!==game.sport||eventId!==String(game.id)||
   (raw.date&&raw.date!==game.date)||
   !['full_game','fg'].includes(period)||
   !['spread','total'].includes(family)||
   !((family==='spread'&&['home','away'].includes(side))||(family==='total'&&['over','under'].includes(side)))||
   !book||book.length>80||/polymarket|kalshi|exchange|smarkets|betfair|matchbook/i.test(book)||
   /closed|suspend|settled|inactive|expired|halt|cancel/.test(rawStatus)||
   !Number.isFinite(time)||time>now||now-time>maxAgeMs||time>=start||
   line===null||american===null||(family==='spread'&&Math.abs(line)>100)||
   (family==='total'&&(line<15||line>350)))return null;
 if(raw.homeId&&String(raw.homeId)!==String(game.home?.espnId))return null;
 if(raw.awayId&&String(raw.awayId)!==String(game.away?.espnId))return null;
 return {family,side,line,american,book,observedAt,homeSpread:family==='spread'?(side==='home'?line:-line):null,
   marketUrl:typeof raw.marketUrl==='string'&&/^https:\/\//.test(raw.marketUrl)?raw.marketUrl:null};
}
function lowerMedian(values){
 const sorted=[...new Set(values)].sort((a,b)=>a-b);
 return sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null;
}
const bestAtLine=(quotes,family,side,line)=>{
 const matches=quotes.filter(q=>q.family===family&&q.side===side&&Math.abs(q.line-line)<0.00001);
 const byBook=new Map();
 for(const q of matches){
  const key=q.book.toLowerCase(),old=byBook.get(key);
  if(!old||Date.parse(q.observedAt)>Date.parse(old.observedAt)||
     (q.observedAt===old.observedAt&&q.american>old.american))byBook.set(key,q);
 }
 const ranked=[...byBook.values()].sort((a,b)=>b.american-a.american||b.observedAt.localeCompare(a.observedAt));
 return {best:ranked[0]||null,bookCount:ranked.length};
};
export function recoveryLeanShopping(game,{now=Date.now(),maxAgeMs=RECOVERY_QUOTE_TTL_MS}={}){
 const unavailable=(state,extra={})=>({state,lean:null,book:null,bookCount:0,verifiedQuotes:0,...extra});
 if(!game||!SPORT_GAPS[game.sport]||!game.recoveryVerifiedProjection||
   game.projectionUnavailable||game.projectionMaturity!=='RESEARCH'||
   !game.recoveryVerifiedProjection.modelId||!game.recoveryVerifiedProjection.expiresAt||
   now>=Date.parse(game.recoveryVerifiedProjection.expiresAt))return unavailable('NO_CURRENT_MODEL');
 if(game.status!=='scheduled'||now>=Date.parse(game.start))return unavailable('NOT_PREGAME');
 const model=game.recoveryVerifiedProjection,margin=finite(model.margin),total=finite(model.total);
 if(margin===null||total===null)return unavailable('NO_CURRENT_MODEL');
 const quotes=[],dedupe=new Map();
 for(const q of Array.isArray(game.recoveryVerifiedOffers)?game.recoveryVerifiedOffers:[]){
  const x=normalizeQuote(q,game,now,maxAgeMs);
  if(!x)continue;
  const id=[x.book.toLowerCase(),x.family,x.side,x.line].join('|'),old=dedupe.get(id);
  if(!old||Date.parse(x.observedAt)>Date.parse(old.observedAt)||
     (x.observedAt===old.observedAt&&x.american>old.american))dedupe.set(id,x);
 }
 quotes.push(...dedupe.values());
 if(!quotes.length)return unavailable('NO_VERIFIED_PRICES');
 const candidates=[],threshold=SPORT_GAPS[game.sport];
 const spreadLine=lowerMedian(quotes.filter(q=>q.family==='spread').map(q=>q.homeSpread));
 if(spreadLine!==null){
  const gap=margin+spreadLine;
  if(Math.abs(gap)>=threshold.side){
   const side=gap>0?'home':'away',line=side==='home'?spreadLine:-spreadLine;
   const picked=bestAtLine(quotes,'spread',side,line);
   if(picked.best)candidates.push({family:'spread',side,line,modelValue:margin,referenceValue:spreadLine,
     differencePoints:rounded(Math.abs(gap)),normalizedGap:Math.abs(gap)/threshold.side,
     label:(game[side]?.abbr||game[side]?.name||side.toUpperCase())+' '+formatLine(line),...picked});
  }
 }
 const totalLine=lowerMedian(quotes.filter(q=>q.family==='total').map(q=>q.line));
 if(totalLine!==null){
  const gap=total-totalLine;
  if(Math.abs(gap)>=threshold.total){
   const side=gap>0?'over':'under',picked=bestAtLine(quotes,'total',side,totalLine);
   if(picked.best)candidates.push({family:'total',side,line:totalLine,modelValue:total,referenceValue:totalLine,
     differencePoints:rounded(Math.abs(gap)),normalizedGap:Math.abs(gap)/threshold.total,
     label:side.toUpperCase()+' '+rounded(totalLine).toFixed(1),...picked});
  }
 }
 if(!candidates.length)return unavailable('NO_VERIFIED_LEAN', {verifiedQuotes:quotes.length});
 // Display-priority comparison only, never probability, EV, confidence or pick qualification.
 candidates.sort((a,b)=>b.normalizedGap-a.normalizedGap||b.differencePoints-a.differencePoints);
 const choice=candidates[0];
 return {state:'MODEL_MARKET_COMPARISON',verifiedQuotes:quotes.length,
   lean:{family:choice.family,side:choice.side,line:choice.line,label:choice.label,
     differencePoints:choice.differencePoints,differenceLabel:'Model vs market '+signed(choice.side==='home'||choice.side==='over'?choice.differencePoints:-choice.differencePoints)+' pts'},
   book:choice.best,bookCount:choice.bookCount,bookComparison:choice.bookCount>1?'BEST_PRICE_AT_SAME_LINE':'ONLY_VERIFIED_BOOK_AT_LINE',
   canAuthorizeWager:false};
}
