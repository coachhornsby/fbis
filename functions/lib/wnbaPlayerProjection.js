/**
 * WNBA independent player-projection research engine v2.
 *
 * Uses ESPN current-season player production plus the independent WNBA-FBIS-v2
 * team scoring/pace environment. PrizePicks/sportsbook lines are comparison
 * inputs only after projection and never enter the projection calculation.
 */
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export const WNBA_PLAYER_MODEL_ID="WNBA-PLAYER-PROJ-v2";
export const WNBA_PLAYER_MODEL_VERSION="research-v2-minutes-role-distribution";

function teamAbbr(team={}){return String(team.abbr||team.shortName||team.name||"").toUpperCase();}
function scoreForTeam(game,side){
  return finite(game?.wnbaV2?.[side]??game?.researchProjection?.[side]??game?.basketballForm?.[side]??game?.model?.[side==="home"?"projHome":"projAway"]);
}
function paceForGame(game){
  return finite(game?.wnbaV2?.decomposition?.pace)??79.5;
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
        steals:statValue(stats,["steals per game","stl","steals"]),
        blocks:statValue(stats,["blocks per game","blk","blocks"]),
        turnovers:statValue(stats,["turnovers per game","to","turnovers"]),
      });
    }
  }
  return out;
}
async function fetchJson(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-Player-v2/1.0",accept:"application/json"}});
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
      const url=`https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes?team=${encodeURIComponent(id)}&limit=100`;
      const j=await fetchJson(url);
      byTeam[abbr]=athleteRows(j);
    }catch(e){errors.push(`${abbr}: ${String(e?.message||e)}`);byTeam[abbr]=[];}
  }));
  return {byTeam,meta:{source:"ESPN_WNBA_ATHLETE_STATS",date,teams:ids.size,players:Object.values(byTeam).reduce((n,x)=>n+x.length,0),errors,marketInformed:false}};
}
function priorFor(market){
  return {
    points:8.5,rebounds:3.5,assists:2.0,three_pointers_made:0.7,
    steals:0.8,blocks:0.5,turnovers:1.3,
  }[market]??0;
}
function baseSigma(market,projection){
  const p=Math.max(0,finite(projection)||0);
  const floor={points:3.8,rebounds:2.0,assists:1.7,three_pointers_made:0.9,steals:0.8,blocks:0.7,turnovers:1.1}[market]??1;
  const scale={points:0.28,rebounds:0.38,assists:0.40,three_pointers_made:0.62,steals:0.72,blocks:0.80,turnovers:0.50}[market]??0.35;
  return Math.max(floor,Math.sqrt(Math.max(0.25,p))*scale+floor*0.72);
}
function componentProjection(game,side,p,market,base){
  const games=Math.max(0,finite(p.games)||0);
  const minutes=clamp(finite(p.minutes)||24,8,40);
  const reliability=games/(games+8);
  const prior=priorFor(market);
  const observed=finite(base);
  if(observed==null)return null;
  const rolePrior=prior*(minutes/24);
  const blended=observed*reliability+rolePrior*(1-reliability);
  const teamScore=scoreForTeam(game,side);
  const scoreEnv=teamScore==null?1:clamp(teamScore/82,0.84,1.18);
  const paceEnv=clamp(paceForGame(game)/79.5,0.90,1.10);
  const env=clamp(Math.pow(scoreEnv,0.58)*Math.pow(paceEnv,0.42),0.88,1.13);
  const minuteStability=clamp(0.90+minutes/320,0.92,1.04);
  return blended*env*minuteStability;
}
function row(game,side,p,market,projection,sigma,components=null){
  const team=teamAbbr(game[side]);
  return {
    sport:"wnba",eventId:String(game.id||""),team,playerId:p.id,playerName:p.name,position:p.position,
    market,fbisProjection:round1(projection),fbisSigma:round1(sigma),source:"ESPN_WNBA_PLAYER_RATE_X_FBIS_V2_PACE_SCORE_ROLE",
    maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorizeWager:false,
    eligibleForCard:false,propGate:"RESEARCH_VALIDATION_REQUIRED",gateReason:"wnba_player_v2_walkforward_required",
    modelId:WNBA_PLAYER_MODEL_ID,modelVersion:WNBA_PLAYER_MODEL_VERSION,
    role:{games:finite(p.games),minutes:finite(p.minutes),pace:round1(paceForGame(game)),projectedTeamScore:scoreForTeam(game,side)},
    components,
    notes:"Minutes/role-aware current-season player rates adjusted by independent WNBA-FBIS-v2 pace and scoring environment. PrizePicks lines are never projection inputs."
  };
}
function addCombo(rows,game,side,p,market,parts){
  const hits=parts.map(k=>rows.find(r=>r.playerId===p.id&&r.market===k)).filter(Boolean);
  if(hits.length!==parts.length)return;
  const projection=hits.reduce((s,r)=>s+r.fbisProjection,0);
  const variance=hits.reduce((s,r)=>s+Math.pow(r.fbisSigma,2),0);
  const sigma=Math.sqrt(variance)*0.88;
  rows.push(row(game,side,p,market,projection,sigma,{parts}));
}
export function attachWnbaPlayerProjectionResearch(games=[],ctx={}){
  let projected=0;
  const next=(games||[]).map(game=>{
    const rows=[];
    for(const side of ["home","away"]){
      const team=teamAbbr(game[side]);
      for(const p of (ctx.byTeam?.[team]||[])){
        if((finite(p.minutes)||0)<10||(finite(p.games)||0)<2) continue;
        const map=[
          ["points",p.points],["rebounds",p.rebounds],["assists",p.assists],["three_pointers_made",p.threes],
          ["steals",p.steals],["blocks",p.blocks],["turnovers",p.turnovers],
        ];
        for(const [market,base] of map){
          const projection=componentProjection(game,side,p,market,base);
          if(projection==null)continue;
          rows.push(row(game,side,p,market,projection,baseSigma(market,projection)));
        }
        addCombo(rows,game,side,p,"points_rebounds_assists",["points","rebounds","assists"]);
        addCombo(rows,game,side,p,"points_rebounds",["points","rebounds"]);
        addCombo(rows,game,side,p,"points_assists",["points","assists"]);
        addCombo(rows,game,side,p,"rebounds_assists",["rebounds","assists"]);
      }
    }
    projected+=rows.length;
    return {...game,playerProjectionRows:rows,playerProjectionStatus:{
      sport:"wnba",state:rows.length?"ACTIVE_RESEARCH":"PLAYER_DATA_UNAVAILABLE",model:WNBA_PLAYER_MODEL_ID,
      version:WNBA_PLAYER_MODEL_VERSION,independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
      validationRequired:"walk-forward by market + PrizePicks line bucket"
    }};
  });
  return {games:next,meta:{modelId:WNBA_PLAYER_MODEL_ID,version:WNBA_PLAYER_MODEL_VERSION,projected,source:ctx.meta?.source||"ESPN_WNBA_ATHLETE_STATS",maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false,feed:ctx.meta||null}};
}
