/**
 * Third-party public GitHub JSON, displayed client-side for research only.
 * No D1 writes, state freezing, model projection, odds validation, or wager authority.
 */
export const FREE_NFL_MIRROR_URL =
  "https://raw.githubusercontent.com/enkday/prizepicks-data-mirror/main/data/prizepicks-nfl-today.json";
export const FREE_NFL_MIRROR_SOURCE_URL =
  "https://github.com/enkday/prizepicks-data-mirror/blob/main/data/prizepicks-nfl-today.json";

export const NFL_MIRROR_CORE_MARKETS=Object.freeze({
  "Pass Yards":"passing_yards",
  "Pass Attempts":"passing_attempts",
  "Pass Completions":"completions",
  "Receiving Yards":"receiving_yards",
  "Receptions":"receptions",
  "Rush Yards":"rushing_yards",
});

export function mirrorChicagoDay(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(date);
}

function validInstant(value){
  if(typeof value!=="string"||!value.trim())return null;
  const n=Date.parse(value);
  return Number.isFinite(n)?n:null;
}

function failed(reason,extra={}){
  return {ok:false,error:reason,rows:[],source:"THIRD_PARTY_GITHUB_MIRROR",
    researchOnly:true,evidenceEligible:false,decisionEligible:false,
    canQualify:false,canAuthorizeWager:false,canCreateStateSnapshots:false,...extra};
}

/**
 * Filter to pregame standard lines for a single Chicago day.
 * Presence in the mirror is not proof of a live PrizePicks offer.
 */
export function normalizeFreeNflMirror(feed,{now=new Date(),date=mirrorChicagoDay(now)}={}){
  const clock=now instanceof Date?now:new Date(now);
  const nowMs=clock.getTime();
  if(!Number.isFinite(nowMs)||!date)return failed("CLOCK_INVALID");
  if(feed?.sport==="NFL"&&feed.totalProps===0&&feed.props==null)feed={...feed,props:[]};
  if(!feed||feed.sport!=="NFL"||!Array.isArray(feed.props))return failed("MIRROR_SCHEMA_INVALID");
  const observedMs=validInstant(feed.collectionStatus?.providerFetchedAt);
  const publishedMs=validInstant(feed.scrapedAt);
  if(feed.collectionStatus?.ok!==true||observedMs==null||publishedMs==null)
    return failed("MIRROR_PROVENANCE_INCOMPLETE");
  if(observedMs>publishedMs||publishedMs>nowMs+60000)
    return failed("MIRROR_TIME_INTEGRITY_FAILED");
  if(mirrorChicagoDay(observedMs)!==date||mirrorChicagoDay(publishedMs)!==date)
    return failed("MIRROR_NOT_TODAY");
  const ageHours=(nowMs-observedMs)/3600000;
  if(ageHours<0||ageHours>20)return failed("MIRROR_TOO_OLD",{observedAt:new Date(observedMs).toISOString()});
  const rows=[],ids=new Set();
  let excludedStarted=0,excludedInvalid=0,excludedOtherDate=0;
  for(const p of feed.props){
    const gameMs=validInstant(p.startTimeIso);
    if(gameMs==null||p.status!=="pre_game"||p.oddsType!=="standard"){
      excludedInvalid++;continue;
    }
    // Validate both absolute start and the publisher's intended CT slate date.
    if(mirrorChicagoDay(gameMs)!==date||p.startDateCST!==date){
      excludedOtherDate++;continue;
    }
    if(gameMs<=nowMs){excludedStarted++;continue;}
    const rowMs=validInstant(p.providerFetchedAt);
    const line=p.line==null||String(p.line).trim()===""?NaN:Number(p.line);
    const id=String(p.projectionId??"");
    const player=String(p.player??"").trim();
    const stat=String(p.stat??"").trim();
    const team=String(p.Team??"").trim();
    const opponent=String(p.Opponent??"").trim();
    if(rowMs==null||rowMs>publishedMs||id===""||ids.has(id)||!player||
       !stat||!team||!opponent||!Number.isFinite(line)){
      excludedInvalid++;continue;
    }
    ids.add(id);
    rows.push({
      id,player,playerId:String(p.playerId??""),stat,market:NFL_MIRROR_CORE_MARKETS[stat]??null,
      line,team,opponent,teamCode:String(p.teamCode??""),
      opponentCode:String(p.opponentCode??""),startAt:new Date(gameMs).toISOString(),
      providerGameId:String(p.gameId??""),oddsType:"standard",
      observedAt:new Date(rowMs).toISOString(),publishedAt:new Date(publishedMs).toISOString(),
      source:"THIRD_PARTY_GITHUB_MIRROR",canonicalEventId:null,
      researchOnly:true,evidenceEligible:false,decisionEligible:false,
      canQualify:false,canAuthorizeWager:false,canCreateStateSnapshots:false,
    });
  }
  rows.sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)||a.player.localeCompare(b.player)||a.stat.localeCompare(b.stat));
  return {ok:true,rows,source:"THIRD_PARTY_GITHUB_MIRROR",
    sourceUrl:FREE_NFL_MIRROR_SOURCE_URL,
    observedAt:new Date(observedMs).toISOString(),
    publishedAt:new Date(publishedMs).toISOString(),
    ageHours:Math.round(ageHours*10)/10,
    originalPublishedRows:feed.props.length,
    excludedStarted,excludedOtherDate,excludedInvalid,
    coreRows:rows.filter(r=>r.market!=null).length,
    games:new Set(rows.map(r=>r.providerGameId)).size,
    researchOnly:true,evidenceEligible:false,decisionEligible:false,
    canQualify:false,canAuthorizeWager:false,canCreateStateSnapshots:false};
}
