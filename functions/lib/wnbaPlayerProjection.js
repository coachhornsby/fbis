/**
 * WNBA independent player-projection research engine.
 *
 * Data source: ESPN public athlete statistics/roster endpoints. PrizePicks and
 * sportsbook lines are never projection inputs. The engine blends current
 * season per-game production with a conservative league prior, adjusts minutes
 * for recent availability, and applies the independent FBIS team scoring
 * environment. Research-only until walk-forward validation promotes a market.
 */
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export const WNBA_PLAYER_MODEL_ID="WNBA-PLAYER-PROJ-v1";
export const WNBA_PLAYER_MODEL_VERSION="research-v1";

function teamAbbr(team={}){return String(team.abbr||team.shortName||team.name||"").toUpperCase();}
function scoreForTeam(game,side){
  const v=finite(game?.researchProjection?.[side]??game?.basketballForm?.[side]??game?.model?.[side==="home"?"projHome":"projAway"]);
  return v;
}
function statValue(stats=[],names=[]){
  const wanted=new Set(names.map(norm));
  for(const row of stats||[]){
    const key=norm(row?.name||row?.displayName||row?.abbreviation);
    if(wanted.has(key)) return finite(row?.value??row?.displayValue);
  }
  return null;
}
function athleteRows(payload){
  const out=[];
  const groups=payload?.athletes||payload?.items||[];
  for(const g of groups){
    const arr=Array.isArray(g?.items)?g.items:Array.isArray(g?.athletes)?g.athletes:[g];
    for(const a of arr){
      if(!a?.id||!a?.displayName) continue;
      const stats=a.statistics||a.stats||g.statistics||[];
      out.push({
        id:String(a.id),name:a.displayName,position:a.position?.abbreviation||a.position?.name||null,
        games:statValue(stats,["games played","gp","games"]),
        minutes:statValue(stats,["minutes per game","min","minutes"]),
        points:statValue(stats,["points per game","pts","points"]),
        rebounds:statValue(stats,["rebounds per game","reb","rebounds"]),
        assists:statValue(stats,["assists per game","ast","assists"]),
        threes:statValue(stats,["3 point field goals made per game","3pm","3pt field goals made","three point field goals made per game"]),
      });
    }
  }
  return out;
}
async function fetchJson(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-Player-Research/1.0",accept:"application/json"}});
  if(!r.ok) throw new Error(`WNBA player feed HTTP ${r.status}`);
  return r.json();
}
export async function loadWnbaPlayerContext(games=[],date=null){
  const ids=new Map();
  for(const g of games||[]) for(const side of ["home","away"]){
    const t=g?.[side]; const id=t?.espnId||String(t?.id||"").replace(/^wnba-/,"");
    if(id) ids.set(String(id),teamAbbr(t));
  }
  const byTeam={}; const errors=[];
  await Promise.all([...ids].map(async([id,abbr])=>{
    try{
      // ESPN team athlete statistics are independent box-score derived inputs.
      const url=`https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes?team=${encodeURIComponent(id)}&limit=100`;
      const j=await fetchJson(url);
      byTeam[abbr]=athleteRows(j);
    }catch(e){errors.push(`${abbr}: ${String(e?.message||e)}`);byTeam[abbr]=[];}
  }));
  return {byTeam,meta:{source:"ESPN_WNBA_ATHLETE_STATS",date,teams:ids.size,players:Object.values(byTeam).reduce((n,x)=>n+x.length,0),errors,marketInformed:false}};
}
function projectRow(game,side,p,market,base,sigma){
  const team=teamAbbr(game[side]);
  const projectedTeam=scoreForTeam(game,side);
  const env=projectedTeam==null?1:clamp(projectedTeam/82,0.84,1.18);
  const games=Math.max(0,finite(p.games)||0);
  const reliability=games/(games+6);
  const priors={points:9.5,rebounds:3.8,assists:2.3,three_pointers_made:0.8};
  const blended=(finite(base)??priors[market])*reliability+priors[market]*(1-reliability);
  const projection=blended*clamp(1+(env-1)*0.55,0.90,1.10);
  return {
    sport:"wnba",eventId:String(game.id||""),team,playerId:p.id,playerName:p.name,position:p.position,
    market,fbisProjection:round1(projection),fbisSigma:round1(sigma),source:"ESPN_WNBA_PLAYER_RATE_X_FBIS_TEAM_ENV",
    maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorizeWager:false,
    eligibleForCard:false,propGate:"RESEARCH_VALIDATION_REQUIRED",gateReason:"wnba_player_model_not_promoted",
    notes:"Current-season player rate shrunk to league prior and adjusted by independent WNBA-FBIS team scoring environment. No PrizePicks/sportsbook input."
  };
}
export function attachWnbaPlayerProjectionResearch(games=[],ctx={}){
  let projected=0;
  const next=(games||[]).map(game=>{
    const rows=[];
    for(const side of ["home","away"]){
      const team=teamAbbr(game[side]);
      for(const p of (ctx.byTeam?.[team]||[])){
        if((finite(p.minutes)||0)<12) continue;
        for(const [market,base,sigma] of [
          ["points",p.points,6.0],["rebounds",p.rebounds,3.2],["assists",p.assists,2.7],["three_pointers_made",p.threes,1.3]
        ]) if(finite(base)!=null) rows.push(projectRow(game,side,p,market,base,sigma));
      }
    }
    projected+=rows.length;
    return {...game,playerProjectionRows:rows,playerProjectionStatus:{
      sport:"wnba",state:rows.length?"ACTIVE_RESEARCH":"PLAYER_DATA_UNAVAILABLE",model:WNBA_PLAYER_MODEL_ID,
      version:WNBA_PLAYER_MODEL_VERSION,independent:true,marketInformed:false,canQualify:false,canAuthorize:false
    }};
  });
  return {games:next,meta:{modelId:WNBA_PLAYER_MODEL_ID,version:WNBA_PLAYER_MODEL_VERSION,projected,source:ctx.meta?.source||"ESPN_WNBA_ATHLETE_STATS",maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false,feed:ctx.meta||null}};
}
