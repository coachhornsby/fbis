// CBB read-only spread shopping. Model winner is NOT an ATS pick.
// Rejected quotes are never replaced with inferred or stale prices.


function cbbValidNumber(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}

function cbbAmericanOdds(q){
 const a=cbbValidNumber(q?.americanOdds);
 if(a!==null&&Number.isInteger(a)&&Math.abs(a)>=100&&Math.abs(a)<=100000)return a;
 const d=cbbValidNumber(q?.decimalOdds);
 if(d!==null&&d>1.001&&d<=1000)return d>=2?Math.round((d-1)*100):-Math.round(100/(d-1));
 return null;
}

function cbbNormalizedQuote(q,game,now,maxAgeMs){
 if(!q||typeof q!=='object')return null;
 const side=String(q.side||'').toLowerCase(),source=String(q.source||q.provider||'').trim();
 const family=String(q.marketFamily||q.market_family||'').toLowerCase();
 const period=String(q.period||'').toLowerCase();
 const id=String(q.canonicalEventId||q.canonical_event_id||q.eventId||q.gameId||'');
 const time=String(q.sourceObservedAt||q.capturedAt||q.collectedAt||q.fetchedAt||'');
 const timestamp=Date.parse(time),line=cbbValidNumber(q.line),american=cbbAmericanOdds(q);
 const active=String(q.marketState||q.status||'').toLowerCase();
 if(id!==String(game.id)||family!=='spread'||!['full_game','fg'].includes(period)||!['home','away'].includes(side))return null;
 if(q.sport&&String(q.sport).toLowerCase()!=='cbb')return null;
 if(!source||/polymarket|kalshi|exchange|smarkets|betfair|matchbook/i.test(source))return null;
 if(/closed|suspend|settled|inactive|expired|halt|cancel/.test(active))return null;
 if(!Number.isFinite(timestamp)||timestamp>now||now-timestamp>maxAgeMs||timestamp>=Date.parse(game.start))return null;
 if(line===null||Math.abs(line)>80||american===null)return null;
 return {side,source,line,american,capturedAt:time,marketUrl:typeof q.marketUrl==='string'&&/^https:\/\//.test(q.marketUrl)?q.marketUrl:null,
  homeSpread:side==='home'?line:-line};
}

export function cbbLineShopping(game,projection,clock=Date.now(),maxAgeMs=300000){
 const unavailable=(state,fields={})=>({state,projectedWinner:null,side:null,fairHomeSpread:null,referenceHomeSpread:null,referenceEdgePoints:null,offers:[],bestPriceAtReference:null,bestLine:null,...fields});
 if(game?.sport!=='cbb'||!projection?.primary)return unavailable('NO_PROJECTION');
 const margin=cbbValidNumber(projection.primary.margin);
 if(margin===null||Math.abs(margin)>80)return unavailable('INVALID_MODEL');
 const projectedWinner=margin>0?'home':margin<0?'away':null,fairHomeSpread=-margin;
 const baseline={projectedWinner,fairHomeSpread};
 if(projection.historical||projection.expired||clock>=Date.parse(projection.expiresAt))return unavailable('HISTORICAL_PROJECTION',baseline);
 if(game.status!=='scheduled'||!Number.isFinite(Date.parse(game.start))||Date.parse(game.start)<=clock)return unavailable('GAME_NOT_PREGAME',baseline);
 const offersRaw=[...(Array.isArray(game.cbbVerifiedOffers)?game.cbbVerifiedOffers:[]),...(Array.isArray(game.market?.venueOffers)?game.market.venueOffers:[]),...(Array.isArray(game.pinnoddsResearch?.offers)?game.pinnoddsResearch.offers:[])];
 const dedupe=new Map();
 for(const raw of offersRaw){
  const q=cbbNormalizedQuote(raw,game,clock,maxAgeMs);
  if(!q)continue;
  const key=[q.source,q.side,q.line].join('|');
  const previous=dedupe.get(key);
  if(!previous||Date.parse(q.capturedAt)>Date.parse(previous.capturedAt)||Date.parse(q.capturedAt)===Date.parse(previous.capturedAt)&&q.american>previous.american)dedupe.set(key,q);
 }
 const offers=[...dedupe.values()];
 if(!offers.length)return unavailable('NO_VERIFIED_CURRENT_PRICES',baseline);
 const spreadValues=offers.map(o=>o.homeSpread).sort((a,b)=>a-b);
 const referenceHomeSpread=spreadValues[Math.floor((spreadValues.length-1)/2)]; // observed lower median, never interpolate an unquoted line
 const homeEdge=margin+referenceHomeSpread;
 if(Math.abs(homeEdge)<0.05)return unavailable('MODEL_MARKET_ALIGNED',{...baseline,referenceHomeSpread,referenceEdgePoints:0,offers});
 const side=homeEdge>0?'home':'away',referenceSideLine=side==='home'?referenceHomeSpread:-referenceHomeSpread;
 const relevant=offers.filter(o=>o.side===side).sort((a,b)=>b.line-a.line||b.american-a.american);
 const atReference=relevant.filter(o=>Math.abs(o.line-referenceSideLine)<1e-7).sort((a,b)=>b.american-a.american);
 const bestPriceAtReference=atReference[0]||null;
 const bestLine=relevant[0]||null;
 return {state:relevant.length?'REFERENCE_COMPARISON':'NO_MATCHED_SIDE_QUOTE',...baseline,side,referenceHomeSpread,referenceSideLine,referenceEdgePoints:Math.round(Math.abs(homeEdge)*10)/10,offers,matchedBooks:new Set(relevant.map(o=>o.source)).size,referenceBooks:new Set(atReference.map(o=>o.source)).size,bestPriceAtReference,bestLine,marketKind:'SPORTSBOOK_REFERENCE_ONLY',canAuthorizeWager:false};
}
