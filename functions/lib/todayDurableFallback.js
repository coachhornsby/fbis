import {hydrateRequestSportRouting,durableSportOwner} from "./sportRequestRouting.js";
import { SPORT_DATABASES, deployedSportDbMode } from "./databaseTopology.js";
/**
 * Durable, read-only board delivery fallback.
 * Existing games + immutable pre-start projection snapshots supply matchups
 * when live scoreboards are unavailable/slow. Never invent scores, fresh odds,
 * game status, prop lines, win probabilities or wagering qualification.
 */
import { resolveTeamExact, espnLogoUrl } from "./teams.js";
const ctDate = value => {
  const d = new Date(value || "");
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("en-CA", {timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)
    : null;
};
const finite = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
/**
 * Durable games are keyed by multiple collector identities. ESPN game IDs are
 * decimal event IDs. Hash/slug acquisition IDs (including ncaaf_*_b2) can
 * repeat a single event and can even collapse distinct schools: production
 * had "North Carolina A&T" as North Carolina/UNC on a hash record. Those
 * records are not canonical board fixtures. The filter applies only to known
 * ESPN-scheduled leagues; non-ESPN sport ID formats are not guessed here.
 */
const ESPN_SCHEDULE_SPORTS = new Set(["cfb","cbb","nfl","nba","wnba","nhl","mlb"]);
export function hasDurableScheduleAuthority(row={}) {
  const sport=String(row.sport||"").toLowerCase();
  if(!row.id || !sport)return false;
  return !ESPN_SCHEDULE_SPORTS.has(sport) || /^[0-9]+$/.test(String(row.id));
}
const cleanAbbr = v => {
  const str=String(v||"").trim();
  return str && !/^[—–−?-]+$/.test(str) ? str : null;
};
/** Only unique name-resolved canonical teams receive official abbreviations/logos. */
function teamFromStoredName(sport,name,rawAbbr) {
  const canonical=resolveTeamExact(sport,{name});
  const logo=canonical?.logo ||
    (canonical?.espnId ? espnLogoUrl(sport,canonical.espnId,canonical.abbr) : null);
  return {
    name,fullName:canonical?.displayName || name,
    abbr:canonical?.abbr || cleanAbbr(rawAbbr),
    logo:logo || null,
    canonicalId:canonical?.id || null,
    sport,
  };
}


/** Pure mapper: rows originate in persisted D1 games + pregame snapshots. */
export function toDurableBoardGame(row, {date,now=Date.now()}={}) {
  if (!hasDurableScheduleAuthority(row) || !row?.home_name || !row?.away_name ||
      ctDate(row.start) !== date || !Number.isFinite(Date.parse(row.start || "")))
    return null;
  const gameStartMs=Date.parse(row.start);
  const frozenMs=Date.parse(row.frozen_at||"");
  const scoreValid=Boolean(Number.isFinite(frozenMs) && frozenMs<gameStartMs &&
    frozenMs<=now && finite(row.proj_home)!=null && finite(row.proj_away)!=null);
  const projHome=scoreValid?finite(row.proj_home):null;
  const projAway=scoreValid?finite(row.proj_away):null;
  return {
    id:String(row.id),sport:String(row.sport).toLowerCase(),date,
    start:row.start,
    home:teamFromStoredName(String(row.sport).toLowerCase(),row.home_name,row.home_abbr),
    away:teamFromStoredName(String(row.sport).toLowerCase(),row.away_name,row.away_abbr),
    status:{state:"unverified",detail:"Stored schedule · live/final status unverified",live:false,completed:false},
    durableFallback:{source:"D1_SCHEDULE_PRESTART_SNAPSHOT",boardDate:date,statusUnverified:true,
      updatedAt:row.updated_at||null,scoreFrozenAt:scoreValid?row.frozen_at:null,
      probabilityUnverified:true,marketUnverified:true},
    projectionKind:scoreValid?"FBIS":"UNAVAILABLE",
    projectionState:scoreValid?"FROZEN_RESEARCH_CONTEXT":"SCHEDULE_ONLY",
    projectionMaturity:"STORED_PIT_CONTEXT",
    projectionDisplayLabel:scoreValid?"STORED PREGAME SCORE · UNVERIFIED LIVE STATE":"NO VERIFIED PREGAME PROJECTION",
    modelVersion:scoreValid?row.model_version||null:null,
    model:{projHome,projAway,projTotal:scoreValid?projHome+projAway:null,
      projMargin:scoreValid?projHome-projAway:null,
      projectionKind:scoreValid?"FBIS":"UNAVAILABLE",
      recipe:{engine:scoreValid?row.engine||"FROZEN_PRESTART":"UNAVAILABLE"},
      pHomeFinal:null,pHome:null,
      maturity:"STORED_PIT_CONTEXT",canQualify:false,canAuthorize:false,
      canShowCalibratedEv:false},
    pureProjectionAvailable:scoreValid,
    quality:{score:null,flags:["durable_schedule_unverified"]},
    rec:null,lean:null,
    qualificationBlocked:true,bettingAllowed:false,canQualify:false,
    canAuthorizeWager:false,bettingAuthority:"NOT_ELIGIBLE",
    noPlayReason:"Stored schedule / score only — live state, odds and wagering unavailable",
    playerMarkets:[],playerProjectionRows:[],
    odds:{},marketLineHistory:[],
  };
}

/**
 * An indexed D1 query over the selected date. It cannot refresh providers,
 * fetch odds, mutate D1, read post-start model data or promote model heads.
 * LIMIT is a safety cap, not a prediction qualifier.
 */
async function queryDurable(db,date,sport,now,excludeSports=[]){
  const exclusion=excludeSports.length ? ` AND g.sport NOT IN (${excludeSports.map(()=>"?").join(",")})` : "";
  const sql=`
      WITH chosen AS (
        SELECT g.id,g.sport,g.date,g.start,g.home_name,g.away_name,g.home_abbr,
               g.away_abbr,g.updated_at,
               p.frozen_at,p.proj_home,p.proj_away,p.engine,p.model_version,
               ROW_NUMBER() OVER (
                 PARTITION BY g.id
                 ORDER BY p.frozen_at DESC,
                    CASE p.checkpoint WHEN 'FINAL_PREGAME' THEN 4
                      WHEN 'DECISION' THEN 3 WHEN 'CURRENT' THEN 2 ELSE 1 END DESC
               ) AS rn
        FROM games g
        LEFT JOIN prediction_snapshots p ON p.game_id=g.id AND p.sport=g.sport
          AND p.date=g.date AND p.frozen_at<g.start AND p.frozen_at<=?
        WHERE g.date=? AND (?='all' OR g.sport=?)${exclusion}
          AND (g.sport NOT IN ('cfb','cbb','nfl','nba','wnba','nhl','mlb')
            OR (length(g.id)>0 AND g.id NOT GLOB '*[^0-9]*'))
      )
      SELECT * FROM chosen WHERE rn=1 ORDER BY start,id LIMIT 700
    `;
  const r=await db.prepare(sql).bind(new Date(now).toISOString(),date,sport,sport,...excludeSports).all();
  const games=(r.results||[]).filter(row=>(sport==="all"||row.sport===sport)&&!excludeSports.includes(row.sport)).map(row=>toDurableBoardGame(row,{date,now})).filter(Boolean);
  return {ok:true,games,source:"D1_SCHEDULE_PRESTART_SNAPSHOT",rowsRead:r.results?.length||0,canQualify:false,canAuthorizeWager:false};
}

export async function loadDurableTodayGames(env={},date,sport="all",{now=Date.now()}={}) {
  sport=String(sport).toLowerCase();
  if(sport!=="all"&&!SPORT_DATABASES[sport])return {ok:false,reason:"UNSUPPORTED_SPORT",games:[]};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))
    return {ok:false,reason:"D1_OR_DATE_UNAVAILABLE",games:[]};
  if(!Number.isFinite(Number(now)))return {ok:false,reason:"INVALID_CUTOFF",games:[]};
  const active=Object.keys(SPORT_DATABASES).filter(key=>deployedSportDbMode(env,key)==="sport"&&(sport==="all"||key===sport));
  if(active.length) {
    try {
      if(!env.__fbisRequestSportRouting)await hydrateRequestSportRouting(env);
      // Validate every selected authority before starting schedule reads. A shard
      // failure returns unavailable, never an old slice of PRIMARY.
      const owners=active.map(key=>({sport:key,...durableSportOwner(env,key)}));
      if(sport!=="all") {
        const result=await queryDurable(owners[0].db,date,sport,now);
        return {...result,source:owners[0].binding+"_DURABLE_CUTOVER"};
      }
      const unmoved=Object.keys(SPORT_DATABASES).filter(key=>!active.includes(key));
      if(unmoved.length&&!env.DB?.prepare)throw Error("PRIMARY_UNBOUND_FOR_UNMOVED_SPORTS");
      const parts=await Promise.all([
        ...(unmoved.length?[queryDurable(env.DB,date,"all",now,active)]:[]),
        ...owners.map(owner=>queryDurable(owner.db,date,owner.sport,now)),
      ]);
      const games=new Map();for(const part of parts)for(const game of part.games)games.set(game.sport+":"+game.id,game);
      const sorted=[...games.values()].sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.sport.localeCompare(b.sport)||a.id.localeCompare(b.id));
      return {ok:true,games:sorted.slice(0,700),truncated:sorted.length>700,source:"D1_SPORT_OWNER_FANOUT",
        bindings:owners.map(o=>({sport:o.sport,binding:o.binding})),rowsRead:parts.reduce((n,p)=>n+p.rowsRead,0),canQualify:false,canAuthorizeWager:false};
    }catch(error){return {ok:false,reason:String(error?.message||error),games:[],canQualify:false,canAuthorizeWager:false};}
  }
  // Preserve the legacy NHL read-only pilot only while production mode is not
  // active. Active sport mode is handled above and never falls back to PRIMARY.
  if(String(sport).toLowerCase()==="nhl"){
    try{
      const {nhlDurableDatabase}=await import("./nhlSportShard.js");
      const routed=await nhlDurableDatabase(env);
      if(routed.database==="NHL_DB" && routed.db?.prepare){
        const out=await queryDurable(routed.db,date,sport,now);
        return {...out,source:"NHL_DB_DURABLE_CUTOVER",cutover:routed.reason,canQualify:false,canAuthorizeWager:false};
      }
    }catch{ /* primary below */ }
  }
  if(!env.DB?.prepare)return {ok:false,reason:"D1_OR_DATE_UNAVAILABLE",games:[]};
  try{
    return await queryDurable(env.DB,date,sport,now);
  }catch(error){
    return {ok:false,reason:String(error?.message||error),games:[]};
  }
}
