import kboTeams from "../../data/teams/kbo.js";\nimport npbTeams from "../../data/teams/npb.js";\nimport { persistNormalizedMarketBatch } from "./marketObservationLedger.js";

export const ASIAN_BASEBALL_ODDS_SPORT = Object.freeze({ npb:"baseball_npb", kbo:"baseball_kbo" });
export const ASIAN_BASEBALL_MARKETS = Object.freeze(["h2h","spreads","totals"]);
export const ASIAN_BASEBALL_MARKET_GOVERNANCE = Object.freeze({
  marketDataOnly:true, projectionAuthority:"INDEPENDENT_ASIAN_BASEBALL_MODEL_ONLY",
  canQualify:false, canAuthorizeWager:false, paidHistoricalBackfill:false
});
const BOOK_ROLE=Object.freeze({pinnacle:"SHARP_REFERENCE_CANDIDATE",draftkings:"SOFT_MARKET",fanduel:"SOFT_MARKET",betmgm:"SOFT_MARKET"});
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const iso=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?new Date(t).toISOString():null};
const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");
export function theOddsQuota(headers){
 const g=k=>headers?.get?headers.get(k):(headers?.[k]??headers?.[k.toLowerCase()]);
 return {remaining:n(g("x-requests-remaining")),used:n(g("x-requests-used")),last:n(g("x-requests-last"))};
}
export function asianBaseballCollectionGate({remaining,lastEmptyAt,lastSuccessAt,now=new Date(),eventStarts=[]}={}){
 const rem=n(remaining); if(rem!=null&&rem<=12)return{ok:false,reason:"quota-reserve"};
 const nowMs=+new Date(now),starts=eventStarts.map(Date.parse).filter(Number.isFinite),next=starts.length?Math.min(...starts):null;
 const mins=next==null?null:(next-nowMs)/60000;
 const last=Date.parse(lastSuccessAt||lastEmptyAt||""); const age=Number.isFinite(last)?(nowMs-last)/60000:Infinity;
 const wait=mins==null?360:mins>720?360:mins>180?120:mins>45?60:20;
 return age<wait?{ok:false,reason:"cadence",nextEligibleMinutes:Math.ceil(wait-age)}:{ok:true,reason:"eligible",nextStartMinutes:mins,minimumIntervalMinutes:wait};
}
function matchCanonical(event,games,league){
 const candidates=(games||[]).filter(g=>String(g.league||"").toUpperCase()===league&&norm(g.home_team_name||g.homeTeam||g.home)===norm(event.home_team)&&norm(g.away_team_name||g.awayTeam||g.away)===norm(event.away_team));
 if(candidates.length!==1)return{canonicalEventId:null,reason:candidates.length?"ambiguous-canonical-match":"canonical-match-missing"};
 const g=candidates[0],a=Date.parse(g.scheduled_start||g.start||""),b=Date.parse(event.commence_time||"");
 if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)>6*3600000)return{canonicalEventId:null,reason:"canonical-start-mismatch"};
 return{canonicalEventId:String(g.canonical_game_id||g.id),reason:null};
}
export function normalizeAsianBaseballTheOdds(events,{league,canonicalGames=[],collectedAt=new Date().toISOString()}={}){
 const L=String(league||"").toUpperCase(); if(!["NPB","KBO"].includes(L))return{offers:[],warnings:["invalid-league"]};
 const offers=[],warnings=[];
 for(const e of events||[]){
  const m=matchCanonical(e,canonicalGames,L); if(m.reason)warnings.push({eventId:e.id,reason:m.reason});
  for(const b of e.bookmakers||[]){const book=String(b.key||"").toLowerCase(),role=BOOK_ROLE[book]||"MARKET_REFERENCE";
   for(const market of b.markets||[]){if(!ASIAN_BASEBALL_MARKETS.includes(market.key))continue;
    for(const o of market.outcomes||[]){let side=null,line=null,family=null;
     if(market.key==="h2h"){family="moneyline";side=norm(o.name)===norm(e.home_team)?"home":norm(o.name)===norm(e.away_team)?"away":null;}
     if(market.key==="spreads"){family="spread";side=norm(o.name)===norm(e.home_team)?"home":norm(o.name)===norm(e.away_team)?"away":null;line=n(o.point);}
     if(market.key==="totals"){family="total";side=/^over$/i.test(o.name)?"over":/^under$/i.test(o.name)?"under":null;line=n(o.point);}
     if(!side){warnings.push({eventId:e.id,book,market:market.key,reason:"unresolved-side"});continue}
     offers.push({source:book,sourceType:"sportsbook",sport:L.toLowerCase(),league:L,eventId:m.canonicalEventId,eventStart:e.commence_time,homeTeam:e.home_team,awayTeam:e.away_team,
       marketFamily:family,side,line,americanOdds:n(o.price),standardOrAlt:"standard",promo:false,period:"full_game",sourceMarketId:market.key,sourceOutcomeId:o.sid||null,
       fetchedAt:iso(market.last_update||b.last_update)||collectedAt,executionEligible:false,
       raw:{provider:"theodds",providerEventId:e.id,providerSportKey:e.sport_key,bookmakerKey:book,bookmakerTitle:b.title,bookRole:role,providerCollectedAt:collectedAt}});
    }
   }
  }
 }
 return{offers,warnings,pinnacleObserved:offers.some(x=>x.source==="pinnacle"),governance:ASIAN_BASEBALL_MARKET_GOVERNANCE};
}
export async function fetchAsianBaseballTheOdds({apiKey,league,fetchImpl=fetch,bookmakers="pinnacle,draftkings,fanduel,betmgm,betonlineag,bovada",markets=ASIAN_BASEBALL_MARKETS}={}){
 const key=ASIAN_BASEBALL_ODDS_SPORT[String(league||"").toLowerCase()]; if(!key)return{ok:false,reason:"invalid-league"};
 if(!apiKey)return{ok:false,reason:"no-api-key",quota:{remaining:null,used:null,last:null}};
 const u=new URL("https://api.the-odds-api.com/v4/sports/"+key+"/odds");u.searchParams.set("apiKey",apiKey);u.searchParams.set("markets",markets.join(","));u.searchParams.set("bookmakers",bookmakers);u.searchParams.set("oddsFormat","american");u.searchParams.set("dateFormat","iso");
 try{const r=await fetchImpl(String(u),{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});const quota=theOddsQuota(r.headers);const body=await r.json().catch(()=>null);
  if(!r.ok)return{ok:false,reason:r.status===429?"quota-or-rate-limit":"http-error",status:r.status,quota,events:[]};
  return{ok:true,status:r.status,quota,events:Array.isArray(body)?body:[],empty:Array.isArray(body)&&body.length===0};
 }catch(e){return{ok:false,reason:e?.name==="TimeoutError"?"timeout":"fetch-error",quota:{remaining:null,used:null,last:null},events:[]}}
}
async function canonicalGames(db,league,events){
 if(!db?.prepare||!events.length)return[];const dates=[...new Set(events.map(e=>String(e.commence_time||"").slice(0,10)).filter(Boolean))];if(!dates.length)return[];
 const from=dates.sort()[0],to=dates.sort().at(-1);const q=await db.prepare("SELECT canonical_game_id,league,game_date,scheduled_start,home_team_id,away_team_id FROM asian_baseball_games WHERE league=? AND game_date BETWEEN ? AND ?").bind(String(league).toUpperCase(),from,to).all().catch(()=>({results:[]}));return q?.results||[];
}
export async function collectAsianBaseballMarket({env,league,now=new Date(),snapshotType="CURRENT"}={}){
 const db=env?.DB;if(!db?.prepare)return{ok:false,reason:"d1-unbound"};
 const L=String(league||"").toUpperCase();if(!["NPB","KBO"].includes(L))return{ok:false,reason:"invalid-league"};
 const meta=async k=>(await db.prepare("SELECT v FROM store_meta WHERE k=?").bind(k).first().catch(()=>null))?.v||null;
 const remaining=await meta("theodds_requests_remaining"),lastEmptyAt=await meta("asian_baseball_"+L.toLowerCase()+"_market_empty_at"),lastSuccessAt=await meta("asian_baseball_"+L.toLowerCase()+"_market_success_at");
 const gate=asianBaseballCollectionGate({remaining,lastEmptyAt,lastSuccessAt,now});if(!gate.ok)return{ok:true,skipped:true,...gate,league:L,remaining:n(remaining)};
 const live=await fetchAsianBaseballTheOdds({apiKey:env?.THEODDS_API_KEY,league:L});const at=new Date(now).toISOString();
 if(live.quota?.remaining!=null)await db.prepare("INSERT OR REPLACE INTO store_meta(k,v) VALUES(?,?)").bind("theodds_requests_remaining",String(live.quota.remaining)).run();
 if(!live.ok)return{...live,league:L,governance:ASIAN_BASEBALL_MARKET_GOVERNANCE};
 if(live.empty){await db.prepare("INSERT OR REPLACE INTO store_meta(k,v) VALUES(?,?)").bind("asian_baseball_"+L.toLowerCase()+"_market_empty_at",at).run();return{ok:true,league:L,empty:true,quota:live.quota,offers:0,pinnacleObserved:false};}
 const games=await canonicalGames(db,L,live.events);const normalized=normalizeAsianBaseballTheOdds(live.events,{league:L,canonicalGames:games,collectedAt:at});
 const safe=normalized.offers.filter(o=>o.eventId);const persisted=await persistNormalizedMarketBatch(db,safe,{snapshotType,collectedAt:at});
 await db.prepare("INSERT OR REPLACE INTO store_meta(k,v) VALUES(?,?)").bind("asian_baseball_"+L.toLowerCase()+"_market_success_at",at).run();
 return{ok:true,league:L,events:live.events.length,offers:normalized.offers.length,persisted:persisted.inserted,unmatched:normalized.offers.filter(o=>!o.eventId).length,postStartRejected,pinnacleObserved:normalized.pinnacleObserved,quota:live.quota,warnings:normalized.warnings,governance:ASIAN_BASEBALL_MARKET_GOVERNANCE};
}
