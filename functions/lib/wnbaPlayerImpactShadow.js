import { pGreater } from "./metrics.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;

export const WNBA_PROP_IMPACT_CHALLENGER_ID="WNBA-PLAYER-PROP-IMPACT-v1";
export const WNBA_GAME_IMPACT_CHALLENGER_ID="WNBA-FBIS-IMPACT-v1";

function roleMultiplier(market,role={}){
  if(market==="points")return finite(role.pointsMultiplier)??1;
  if(market==="rebounds")return finite(role.reboundsMultiplier)??1;
  if(market==="assists")return finite(role.assistsMultiplier)??1;
  if(market==="three_pointers_made")return finite(role.threesMultiplier)??1;
  return 1;
}
export function applyWnbaPropImpactShadow(row,{impact=null,role=null,lineup=null,availabilityVerified=false}={}){
  const base=finite(row?.fbisProjection),sigma=finite(row?.fbisSigma);
  if(base==null)return {...row,impactShadow:null};
  const directImpact=impact?.offense==null?1:clamp(1+Number(impact.offense)/400,.97,1.035);
  const adjusted=base*roleMultiplier(row.market,role)*(finite(lineup?.multiplier)??1)*directImpact;
  const minutes=finite(row?.role?.minutes);
  const projectedMinutes=minutes==null?null:clamp(minutes+(finite(role?.minutesDelta)||0),0,40);
  return {
    ...row,
    impactShadow:{
      modelId:WNBA_PROP_IMPACT_CHALLENGER_ID,modelVersion:"research-v1-shadow",
      projection:round1(adjusted),sigma:round1((sigma??1)*(availabilityVerified?.98:1.04)),
      baselineProjection:base,projectedMinutes,
      playerImpact:impact?{offense:impact.offense,defense:impact.defense,net:impact.net}:null,
      roleContext:role||null,lineupContext:lineup||null,availabilityVerified:Boolean(availabilityVerified),
      independent:true,marketInformed:false,canQualify:false,canAuthorize:false
    }
  };
}
export function applyWnbaGameImpactShadow(game,{homeAdjustment=0,awayAdjustment=0,availabilityVerified=false}={}){
  const base=game?.wnbaV2||game?.researchProjection;
  if(!base?.ok&&base?.home==null)return null;
  const home=Number(base.home)+(finite(homeAdjustment)||0),away=Number(base.away)+(finite(awayAdjustment)||0);
  const margin=home-away,total=home+away;
  return {
    ok:true,modelId:WNBA_GAME_IMPACT_CHALLENGER_ID,modelVersion:"research-v1-shadow",
    home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
    sigmaMargin:base.sigmaMargin??10.2,sigmaTotal:base.sigmaTotal??12.1,
    pHomeWin:pGreater(margin,0,base.sigmaMargin??10.2),
    adjustments:{home:finite(homeAdjustment)||0,away:finite(awayAdjustment)||0,availabilityVerified:Boolean(availabilityVerified)},
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false
  };
}


function parseJson(v){if(v&&typeof v==="object")return v;try{return JSON.parse(v||"{}")}catch{return{}}}

async function d1AllWithRetry(db,sql,{attempts=3,baseDelayMs=120}={}){
  let lastError=null;
  for(let i=0;i<attempts;i++){
    try{return await db.prepare(sql).all();}
    catch(err){
      lastError=err;
      if(i<attempts-1)await new Promise(resolve=>setTimeout(resolve,baseDelayMs*(i+1)));
    }
  }
  throw lastError;
}

export async function loadWnbaImpactContext(db){
  if(!db?.prepare)return {players:{},roles:{},meta:{available:false,reason:"db_unavailable",partial:false}};
  const impactSql=`
    WITH ranked AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY as_of DESC) rn
      FROM wnba_player_impact_snapshots
    )
    SELECT * FROM ranked WHERE rn=1
  `;
  const roleSql=`
    WITH ranked AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY feature_cutoff_timestamp DESC) rn
      FROM wnba_player_role_contexts
    )
    SELECT * FROM ranked WHERE rn=1
  `;
  let impactRes={results:[]},roleRes={results:[]},impactError=null,roleError=null;
  try{impactRes=await d1AllWithRetry(db,impactSql);}catch(err){impactError=String(err?.message||err);}
  try{roleRes=await d1AllWithRetry(db,roleSql);}catch(err){roleError=String(err?.message||err);}

  const players={},roles={};
  for(const r of impactRes?.results||[]){
    players[String(r.player_id)]={
      modelId:r.model_id,version:r.model_version,playerId:String(r.player_id),name:r.player_name,teamId:r.team_id,position:r.position,
      offense:finite(r.offense_impact),defense:finite(r.defense_impact),net:finite(r.net_impact),
      rapm:r.rapm_net==null?null:{net:finite(r.rapm_net)},
      diagnostics:{bpmStyle:finite(r.bpm_style),vorpStylePerGame:finite(r.vorp_style),ws48Style:finite(r.ws48_style)},
      skill:parseJson(r.dynamic_skill_json)
    };
  }
  for(const r of roleRes?.results||[]){
    const x=parseJson(r.context_json);
    roles[String(r.player_id)]={
      featureCutoffTimestamp:r.feature_cutoff_timestamp,
      role:{
        minutesDelta:finite(r.minutes_delta),usageMultiplier:finite(r.usage_multiplier),pointsMultiplier:finite(r.points_multiplier),
        reboundsMultiplier:finite(r.rebounds_multiplier),assistsMultiplier:finite(r.assists_multiplier),threesMultiplier:finite(r.threes_multiplier),
        unavailableCount:Number(r.unavailable_count||0)
      },
      lineup:{multiplier:finite(r.lineup_multiplier)??1},
      availabilityVerified:Number(r.availability_verified||0)===1,
      unavailable:x.unavailable||[]
    };
  }
  const playerN=Object.keys(players).length,roleN=Object.keys(roles).length;
  const available=playerN>0;
  return {
    players,roles,
    meta:{
      available,partial:Boolean(impactError||roleError),players:playerN,roles:roleN,
      impactError,roleError,
      roleContextAvailable:roleN>0,
      playerBankAvailable:playerN>0
    }
  };
}

function teamAbbr(team={}){return String(team.abbr||team.shortName||team.name||"").toUpperCase();}
function statusWeight(s){const x=String(s||"").toUpperCase();return x==="OUT"?1:x==="DOUBTFUL"?0.8:x==="QUESTIONABLE"?0.45:x==="PROBABLE"?0.12:0}

export function attachWnbaImpactShadows(games=[],ctx={players:{},roles:{}}){
  let propRows=0,gameRows=0,verified=0;
  const next=(games||[]).map(game=>{
    const rows=(game.playerProjectionRows||[]).map(row=>{
      const impact=ctx.players?.[String(row.playerId)]||null;
      const rc=ctx.roles?.[String(row.playerId)]||null;
      const out=applyWnbaPropImpactShadow(row,{
        impact,role:rc?.role||null,lineup:rc?.lineup||null,availabilityVerified:Boolean(rc?.availabilityVerified)
      });
      if(out.impactShadow)propRows++;
      if(out.impactShadow?.availabilityVerified)verified++;
      return out;
    });
    const teamAdj={};
    for(const side of ["home","away"]){
      const abbr=teamAbbr(game[side]);
      let adjustment=0,teamVerified=false;
      const teamPlayers=Object.values(ctx.players||{}).filter(p=>String(p.teamId||"")===String(game?.[side]?.espnId||String(game?.[side]?.id||"").replace(/^wnba-/,""))||String(p.team||"").toUpperCase()===abbr);
      const unavailable=new Map();
      for(const p of teamPlayers){
        const rc=ctx.roles?.[String(p.playerId)]||{};
        for(const u of rc.unavailable||[])unavailable.set(String(u.playerId),u);
        if(rc.availabilityVerified)teamVerified=true;
      }
      for(const [pid,u] of unavailable){
        const p=ctx.players?.[pid];if(!p)continue;
        const mins=finite(p.skill?.minutes)||26;
        adjustment-=clamp((finite(p.net)||0)*mins/40*statusWeight(u.status)*.55,-6,6);
      }
      teamAdj[side]={adjustment,verified:teamVerified};
    }
    const gShadow=applyWnbaGameImpactShadow(game,{
      homeAdjustment:teamAdj.home.adjustment,awayAdjustment:teamAdj.away.adjustment,
      availabilityVerified:teamAdj.home.verified||teamAdj.away.verified
    });
    if(gShadow)gameRows++;
    return {...game,playerProjectionRows:rows,wnbaImpactGameShadow:gShadow};
  });
  return {games:next,meta:{modelId:WNBA_PROP_IMPACT_CHALLENGER_ID,propRows,gameRows,availabilityVerifiedRows:verified,canQualify:false,canAuthorize:false,marketInformed:false}};
}
