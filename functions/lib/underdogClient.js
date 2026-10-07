import { mapUnderdogStat, normalizeUnderdogSport } from "./underdogStatMaps.js";

export const UNDERDOG_ENDPOINT="https://api.underdogfantasy.com/beta/v3/over_under_lines";
export const UNDERDOG_SOURCE="UNDERDOG_UNOFFICIAL_V3";
const UA="FBIS-MarketData/1.0 (+market-ingestion; no-auth)";
const DEFAULT_TIMEOUT_MS=8000;
const CACHE_TTL_MS=20_000;
let memoryCache=null;

const s=v=>{const x=String(v??"").trim();return x||null};
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const arr=(o,...keys)=>{for(const k of keys)if(Array.isArray(o?.[k]))return o[k];return []};
const first=(o,paths)=>{for(const p of paths){let v=o;for(const k of p.split(".")){v=v?.[k];if(v==null)break}if(v!=null&&v!=="")return v}return null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

function classifyLineType(line={}){
  const explicit=String(first(line,["line_type","lineType","type","variant","option_type"])||"").toLowerCase();
  const title=String(first(line,["title","display_name","label","appearance_stat.display_stat","appearance_stat.stat"])||"").toLowerCase();
  const promo=Boolean(first(line,["promo","is_promo","promotional","is_promotional"]))||/promo|special|boost/.test(explicit+" "+title);
  const discounted=Boolean(first(line,["discounted","is_discounted"]))||/discount/.test(explicit+" "+title);
  const alternate=Boolean(first(line,["alternate","is_alternate","alt"]))||/alternate|\balt\b/.test(explicit+" "+title);
  if(promo)return "promo"; if(discounted)return "discounted"; if(alternate)return "alternate";
  if(/standard|normal|regular/.test(explicit))return "standard";
  return "unknown";
}
function availability(line={}){
  const opts=arr(line,"options","over_under_options","choices");
  const tokens=opts.map(x=>String(first(x,["choice","side","option","label","type"])||"").toLowerCase());
  return {over:tokens.some(x=>/over|higher|more/.test(x)),under:tokens.some(x=>/under|lower|less/.test(x)),raw:opts};
}
function payout(line={}){
  const v=first(line,["payout_multiplier","multiplier","payout","boost_multiplier","options.0.payout_multiplier"]);
  return finite(v);
}
function buildIndexes(payload){
  const players=arr(payload,"players"),appearances=arr(payload,"appearances"),games=arr(payload,"games"),leagues=arr(payload,"leagues");
  return {
    players,appearances,games,leagues,
    playerById:new Map(players.map(x=>[String(x.id),x])),
    appearanceById:new Map(appearances.map(x=>[String(x.id),x])),
    gameById:new Map(games.map(x=>[String(x.id),x])),
    leagueById:new Map(leagues.map(x=>[String(x.id),x])),
  };
}
function deriveTeamOpponent(player,appearance,game){
  const team=s(first(appearance,["team_abbr","team","team_name"])||first(player,["team_abbr","team","team_name"]));
  const home=s(first(game,["home_team.abbreviation","home_team.name","home_team","homeTeam"]));
  const away=s(first(game,["away_team.abbreviation","away_team.name","away_team","awayTeam"]));
  let opponent=s(first(appearance,["opponent","opponent_abbr"]));
  if(!opponent&&team&&home&&norm(team)===norm(home))opponent=away;
  if(!opponent&&team&&away&&norm(team)===norm(away))opponent=home;
  return {team,opponent};
}

export function normalizeUnderdogPayload(payload,{fetchedAt=new Date().toISOString()}={}){
  const warnings=[];
  if(!payload||typeof payload!=="object")return {ok:false,rawCount:0,normalizedCount:0,warnings:["MALFORMED_PAYLOAD"],lines:[]};
  const ix=buildIndexes(payload);
  const rawLines=arr(payload,"over_under_lines","overUnderLines");
  if(!Array.isArray(payload.players))warnings.push("MISSING_PLAYERS_ARRAY");
  if(!Array.isArray(payload.appearances))warnings.push("MISSING_APPEARANCES_ARRAY");
  if(!Array.isArray(payload.over_under_lines)&&!Array.isArray(payload.overUnderLines))warnings.push("MISSING_OVER_UNDER_LINES_ARRAY");
  const lines=[],seen=new Map();
  for(const raw of rawLines){
    const lineId=s(first(raw,["id","over_under_line_id","line_id"]));
    const appearanceId=s(first(raw,["appearance_id","appearance.id","appearance_stat.appearance_id"]));
    const appearance=appearanceId?ix.appearanceById.get(appearanceId):null;
    const playerId=s(first(raw,["player_id","player.id"])||first(appearance,["player_id","player.id"]));
    const player=playerId?ix.playerById.get(playerId):null;
    const gameId=s(first(raw,["game_id","event_id","game.id"])||first(appearance,["game_id","event_id","game.id"]));
    const game=gameId?ix.gameById.get(gameId):null;
    const leagueId=s(first(raw,["league_id"])||first(game,["league_id"])||first(appearance,["league_id"]));
    const leagueObj=leagueId?ix.leagueById.get(leagueId):null;
    const league=s(first(raw,["league","league_name"])||first(leagueObj,["name","abbreviation"])||first(game,["league","league_name"]));
    const sport=normalizeUnderdogSport(first(raw,["sport","sport_id"])||first(leagueObj,["sport","name"])||league);
    const statLabel=s(first(raw,["stat","stat_type","display_stat","appearance_stat.stat","appearance_stat.display_stat"]));
    const mapped=mapUnderdogStat(sport,statLabel);
    const value=finite(first(raw,["stat_value","line","value"]));
    const playerName=s(first(player,["full_name","name","display_name"])||first(appearance,["player_name","name"])||first(raw,["player_name"]));
    const start=s(first(game,["scheduled_at","start_time","starts_at","game_date"])||first(appearance,["scheduled_at","start_time"]));
    const {team,opponent}=deriveTeamOpponent(player,appearance,game);
    const lineType=classifyLineType(raw),avail=availability(raw);
    const usable=Boolean(player&&appearance&&playerName&&value!=null&&mapped.statFamily);
    if(value==null)warnings.push("INVALID_STAT_VALUE:"+String(lineId||"unknown"));
    if(appearanceId&&!appearance)warnings.push("UNRESOLVED_APPEARANCE:"+appearanceId);
    if(!player)warnings.push("UNRESOLVED_PLAYER:"+String(playerId||lineId||"unknown"));
    const row={
      platform:"underdog",source:UNDERDOG_SOURCE,sport,league:league||null,
      playerName,playerId:playerId||null,team,opponent,eventId:gameId||null,eventStartTime:start||null,
      statLabel,statFamily:mapped.statFamily,modelSupported:mapped.modelSupported,line:value,
      availability:{over:avail.over,under:avail.under},payoutMultiplier:payout(raw),lineType,
      alternateOrPromo:["alternate","promo","discounted"].includes(lineType),
      rawIds:{lineId,appearanceId,playerId,gameId,leagueId},timestamp:fetchedAt,
      usableForAutomatedComparison:usable,
      unusableReasons:[!player?"UNRESOLVED_PLAYER":null,!appearance?"UNRESOLVED_APPEARANCE":null,value==null?"INVALID_STAT_VALUE":null,!mapped.statFamily?"UNSUPPORTED_STAT":null].filter(Boolean),
      raw:{line:raw,appearance:appearance||null,player:player||null,game:game||null,league:leagueObj||null},
    };
    const key=[playerId||norm(playerName),gameId||"",mapped.statFamily||norm(statLabel),value,lineType].join("|");
    if(seen.has(key)){warnings.push("DUPLICATE_LINE:"+String(lineId||key));continue}
    seen.set(key,row);lines.push(row);
  }
  const conflictGroups=new Map();
  for(const row of lines){const k=[row.playerId||norm(row.playerName),row.eventId||"",row.statFamily||norm(row.statLabel),row.lineType].join("|");const a=conflictGroups.get(k)||[];a.push(row);conflictGroups.set(k,a)}
  for(const [k,a] of conflictGroups)if(new Set(a.map(x=>x.line)).size>1)warnings.push("CONFLICTING_LINES:"+k);
  return {ok:!warnings.some(x=>x.startsWith("MISSING_OVER_UNDER_LINES")||x==="MALFORMED_PAYLOAD"),rawCount:rawLines.length,normalizedCount:lines.length,warnings:[...new Set(warnings)],lines};
}

export async function fetchUnderdogLines({fetchImpl=fetch,timeoutMs=DEFAULT_TIMEOUT_MS,cache=true,force=false}={}){
  const now=Date.now();
  if(cache&&!force&&memoryCache&&now-memoryCache.at<CACHE_TTL_MS)return {...memoryCache.value,cache:{hit:true,ttlMs:CACHE_TTL_MS}};
  const fetchedAt=new Date().toISOString(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetchImpl(UNDERDOG_ENDPOINT,{headers:{"user-agent":UA,accept:"application/json"},signal:controller.signal});
    if(!res?.ok)return {ok:false,fetchedAt,source:UNDERDOG_SOURCE,endpoint:UNDERDOG_ENDPOINT,rawCount:0,normalizedCount:0,warnings:["HTTP_"+String(res?.status||"UNKNOWN")],lines:[],cache:{hit:false,ttlMs:CACHE_TTL_MS}};
    let payload;try{payload=await res.json()}catch{return {ok:false,fetchedAt,source:UNDERDOG_SOURCE,endpoint:UNDERDOG_ENDPOINT,rawCount:0,normalizedCount:0,warnings:["MALFORMED_JSON"],lines:[],cache:{hit:false,ttlMs:CACHE_TTL_MS}}}
    const normalized=normalizeUnderdogPayload(payload,{fetchedAt});
    const schemaKeys=Object.keys(payload||{}).sort();
    const expected=["appearances","over_under_lines","players"];
    const missing=expected.filter(k=>!schemaKeys.includes(k));
    const value={...normalized,fetchedAt,source:UNDERDOG_SOURCE,endpoint:UNDERDOG_ENDPOINT,schema:{keys:schemaKeys,expectedMissing:missing,version:s(first(payload,["schema_version","version"]))||"unknown"},cache:{hit:false,ttlMs:CACHE_TTL_MS}};
    if(value.rawCount>0&&value.rawCount<10)value.warnings=[...value.warnings,"FEED_COUNT_COLLAPSE_SUSPECTED"];
    if(value.schema.version==="unknown")value.warnings=[...value.warnings,"UNKNOWN_SCHEMA_VERSION"];
    memoryCache={at:now,value};return value;
  }catch(e){
    const code=e?.name==="AbortError"?"TIMEOUT":"FETCH_ERROR";
    return {ok:false,fetchedAt,source:UNDERDOG_SOURCE,endpoint:UNDERDOG_ENDPOINT,rawCount:0,normalizedCount:0,warnings:[code],diagnostic:String(e?.message||e).slice(0,200),lines:[],cache:{hit:false,ttlMs:CACHE_TTL_MS}};
  }finally{clearTimeout(timer)}
}

export function filterUnderdogLines(result,{sport,league,statFamily,player,event,date}={}){
  const rows=(result?.lines||[]).filter(r=>{
    if(sport&&String(r.sport)!==String(normalizeUnderdogSport(sport)||sport).toLowerCase())return false;
    if(league&&!norm(r.league).includes(norm(league)))return false;
    if(statFamily&&String(r.statFamily)!==String(statFamily))return false;
    if(player&&!norm(r.playerName).includes(norm(player)))return false;
    if(event&&String(r.eventId)!==String(event))return false;
    if(date&&String(r.eventStartTime||"").slice(0,10)!==String(date).slice(0,10))return false;
    return true;
  });
  return {...result,normalizedCount:rows.length,lines:rows};
}

export async function archiveUnderdogSnapshot(env,result,{sport="all"}={}){
  if(!env?.ARCHIVE?.put||!result?.lines?.length)return {archived:false,reason:"archive-unavailable-or-empty"};
  const ts=String(result.fetchedAt||new Date().toISOString()).replace(/[:.]/g,"-");
  const key=`raw/underdog/${String(sport||"all").toLowerCase()}/${ts}.json`;
  const rows=result.lines.map(r=>({timestamp:r.timestamp,platform:r.platform,sport:r.sport,event:r.eventId,player:r.playerName,stat:r.statLabel,statFamily:r.statFamily,line:r.line,lineType:r.lineType,sourceIds:r.rawIds,startTime:r.eventStartTime}));
  await env.ARCHIVE.put(key,JSON.stringify({schemaVersion:1,source:UNDERDOG_SOURCE,fetchedAt:result.fetchedAt,rows}),{httpMetadata:{contentType:"application/json"},customMetadata:{source:"underdog",appendOnly:"true"}});
  return {archived:true,key,rows:rows.length};
}
