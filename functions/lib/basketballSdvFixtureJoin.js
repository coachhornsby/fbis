/**
 * Link SDV NBA Stats game IDs to the existing immutable ESPN NBA game archive.
 * Never infer tipoff from a date-only NBA Stats schedule. A strict one-to-one,
 * same-matchup, same-final, +/-1-calendar-day candidate match is required.
 */
import {createHash} from "node:crypto";
const hash=x=>createHash("sha256").update(x).digest("hex");
const day=x=>typeof x==="string"?x.slice(0,10):"";
const str=x=>typeof x==="string"?x.trim().toUpperCase():"";
/** ESPN's verified NBA team registry uses GS, NO, NY, SA and UTAH;
 * the NBA Stats provider uses GSW, NOP, NYK, SAS and UTA. Alias only these
 * known equivalent team abbreviations. Never fuzzy-match teams.
 */
const nbaAlias=Object.freeze({
 GSW:"GS",GS:"GS",NOP:"NO",NO:"NO",
 NYK:"NY",NY:"NY",SAS:"SA",SA:"SA",
 UTA:"UTAH",UTAH:"UTAH",WSH:"WAS",WAS:"WAS"
});
const normalized=x=>nbaAlias[str(x)]||str(x);
const tm=x=>Date.parse(x||"");
const n=x=>x===null||x===undefined||x===""?null:Number(x);
export function nbaCanonicalFixtureEvidence(rawCanonicalJsonl){
 if(typeof rawCanonicalJsonl!=="string"||!rawCanonicalJsonl.trim())
  throw Error("NBA_FROZEN_CANONICAL_SOURCE_ABSENT");
 const fingerprint=hash(rawCanonicalJsonl);
 const map=new Map();
 const seen=new Set();
 for(const line of rawCanonicalJsonl.split("\n")){
  if(!line.trim())continue;
  const g=JSON.parse(line);
  const id=String(g.id||"");
  const ha=normalized(g.home?.abbr),aa=normalized(g.away?.abbr);
  const h=n(g.homeScore),a=n(g.awayScore),date=day(g.start);
  if(!id||seen.has(id)||!ha||!aa||!Number.isFinite(tm(g.start))||
    !Number.isInteger(h)||!Number.isInteger(a))continue;
  seen.add(id);
  const k=ha+"|"+aa;
  if(!map.has(k))map.set(k,[]);
  map.get(k).push({gameId:id,tipoff:new Date(tm(g.start)).toISOString(),
   sourceGameDate:date,homeScore:h,awayScore:a});
 }
 return {sourceFingerprint:fingerprint,byTeams:map,distinctGames:seen.size};
}
export function matchNbaStatsScheduleToCanonical(schedule,library,{statsGameId}={}){
 if(!schedule||!library?.byTeams||typeof statsGameId!=="string"||
  !/^[0-9]{8,12}$/.test(statsGameId)||
  String(schedule.game_id)!==statsGameId)
  return {status:"INVALID_NBA_STATS_GAME_ID",tipoff:null,evidence:null};
 const home=normalized(schedule.home_team_abbreviation),
  away=normalized(schedule.away_team_abbreviation),
  d=day(schedule.game_date);
 const scoreH=n(schedule.home_pts),scoreA=n(schedule.away_pts);
 if(!home||!away||!Number.isInteger(scoreH)||!Number.isInteger(scoreA)||
  !Number.isFinite(tm(d+"T00:00:00Z")))
  return {status:"INSUFFICIENT_MATCHUP_DATE_SCORE_EVIDENCE",tipoff:null,evidence:null};
 const target=tm(d+"T00:00:00Z");
 const matches=(library.byTeams.get(home+"|"+away)||[]).filter(g=>
  Math.abs(tm(g.sourceGameDate+"T00:00:00Z")-target)<=86400000&&
  g.homeScore===scoreH&&g.awayScore===scoreA);
 if(matches.length!==1)return {
  status:matches.length?"AMBIGUOUS_CANONICAL_MATCH":"NO_IDENTICAL_CANONICAL_MATCH",
  tipoff:null,evidence:null};
 const g=matches[0];
 return{status:"INDEPENDENT_CANONICAL_EXACT_TIPOFF",tipoff:g.tipoff,
  evidence:{gameId:statsGameId,espnGameId:g.gameId,
   tipoff:g.tipoff,sourceFingerprint:library.sourceFingerprint,verified:true,
   canonicalHome:home,canonicalAway:away,canonicalFinalHome:scoreH,
   canonicalFinalAway:scoreA}};
}
