/**
 * Durable, read-only board delivery fallback.
 * Existing games + immutable pre-start projection snapshots supply matchups
 * when live scoreboards are unavailable/slow. Never invent scores, fresh odds,
 * game status, prop lines, win probabilities or wagering qualification.
 */
const ctDate = value => {
  const d = new Date(value || "");
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("en-CA", {timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)
    : null;
};
const finite = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

/** Pure mapper: rows originate in persisted D1 games + pregame snapshots. */
export function toDurableBoardGame(row, {date,now=Date.now()}={}) {
  if (!row?.id || !row?.sport || !row?.home_abbr || !row?.away_abbr ||
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
    home:{name:row.home_name||row.home_abbr,abbr:row.home_abbr},
    away:{name:row.away_name||row.away_abbr,abbr:row.away_abbr},
    status:{state:"unverified",detail:"Stored schedule · live/final status unverified",live:false,completed:false},
    durableFallback:{source:"D1_SCHEDULE_PRESTART_SNAPSHOT",statusUnverified:true,
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
export async function loadDurableTodayGames(env={},date,sport="all",{now=Date.now()}={}) {
  if(!env.DB?.prepare || !/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))
    return {ok:false,reason:"D1_OR_DATE_UNAVAILABLE",games:[]};
  if(!Number.isFinite(Number(now)))return {ok:false,reason:"INVALID_CUTOFF",games:[]};
  try{
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
        WHERE g.date=? AND (?='all' OR g.sport=?)
      )
      SELECT * FROM chosen WHERE rn=1 ORDER BY start,id LIMIT 700
    `;
    const r=await env.DB.prepare(sql).bind(new Date(now).toISOString(),date,sport,sport).all();
    const games=(r.results||[]).map(row=>toDurableBoardGame(row,{date,now})).filter(Boolean);
    return {ok:true,games,source:"D1_SCHEDULE_PRESTART_SNAPSHOT",rowsRead:r.results?.length||0};
  }catch(error){
    return {ok:false,reason:String(error?.message||error),games:[]};
  }
}
