import { scorePitcherVsBatter } from "./mlbPitchMatchup.js";

export const MLB_PLAYER_PROP_MODEL_VERSION="research-v1-persistent-props";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const round1=v=>Math.round(Number(v)*10)/10;
const teamAbbr=t=>String(t?.abbr||t?.shortName||t?.name||"").toUpperCase();

function recentIpSigma(p={}){
  const xs=(p?.recentStarter?.rows||[]).map(x=>finite(x?.innings)).filter(Number.isFinite);
  if(xs.length<2)return 1.05;
  const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
  const v=xs.reduce((s,x)=>s+(x-mean)**2,0)/(xs.length-1);
  return clamp(Math.sqrt(v),0.65,1.65);
}
function expectedPa(h={},teamRuns=null){
  const season=finite(h.plateAppearances),games=finite(h.games);
  const base=season!=null&&games>0?season/games:4.05;
  const env=teamRuns==null?1:clamp(Math.pow(Math.max(2,teamRuns)/4.45,.16),.92,1.08);
  return clamp(base*env,3.0,5.1);
}
function hitterFallbackRates(h={}){
  const sc=h?.statcastProfile||{};
  const g=sc.global||{};
  const x=finite(g.xwoba)??.320,bar=finite(g.barrelRate)??.055,contact=finite(g.contactPerSwing)??.76;
  return {
    k:finite(h.strikeoutRate)??finite(sc.kRate)??.225,
    hit:finite(h.hitPerPa)??clamp(.205+(x-.320)*.36+(contact-.76)*.10,.12,.34),
    tb:finite(h.totalBasesPerPa)??clamp(.335+(x-.320)*.72+(bar-.055)*1.15,.18,.72),
    hr:finite(h.homeRunPerPa)??clamp(.030+(bar-.055)*.38+(x-.320)*.08,.004,.12),
    bb:finite(h.walkRate)??clamp(.083+(0.50-(finite(g.swingRate)??.47))*.12,.035,.18),
  };
}
function lineupWalkRate(state,side){
  const rows=Object.values(state?.teamHitters?.[side]||{});
  const xs=rows.map(h=>finite(h?.walkRate)).filter(Number.isFinite);
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:.083;
}
function pitcherRows(game,state,side){
  const profile=side==="home"?state?.homeStarter:state?.awayStarter;
  const sp=game?.[side==="home"?"homeSp":"awaySp"]||{};
  if(!profile||!sp?.id)return[];
  const team=teamAbbr(game?.[side]);
  const oppSide=side==="home"?"away":"home";
  const matchup=side==="home"?game?.mlbPitchMatchup?.awayOffense:game?.mlbPitchMatchup?.homeOffense;
  const deepK=game?.mlbDeepShadow?.pitcherKs?.[side]||null;
  const ip=finite(deepK?.expectedInnings)??finite(profile.expectedInnings)??finite(profile.inningsPerStart)??5.35;
  const bfpi=finite(profile.battersFacedPerInning)??4.25;
  const expectedBf=clamp(ip*bfpi,12,36);
  const runFactor=finite(matchup?.runFactor)??1;
  const xw=finite(matchup?.xwoba),contact=finite(matchup?.contactPerSwing);
  const contactFactor=clamp((xw==null?1:xw/.320)*.65+(contact==null?1:contact/.76)*.35,.78,1.24);
  const oppBb=lineupWalkRate(state,oppSide);
  const walkFactor=clamp(.55+.45*(oppBb/.083),.78,1.22);
  const h9=finite(profile.h9);
  const bb9=finite(profile.bb9);
  const er9=finite(profile.er9)??finite(profile.era);
  const whip=finite(profile.whip);
  const hitLambda=h9!=null?(h9/9)*ip*contactFactor:whip!=null?Math.max(.5,whip*ip-(bb9!=null?(bb9/9)*ip:ip*.32))*contactFactor:null;
  const walkLambda=bb9!=null?(bb9/9)*ip*walkFactor:finite(profile.bbRate)!=null?profile.bbRate*expectedBf*walkFactor:null;
  const env=clamp((finite(game?.mlbContext?.palParkRunFactor)??1)*(finite(game?.mlbContext?.weatherRunFactor)??1),.82,1.22);
  const erLambda=er9!=null?(er9/9)*ip*runFactor*env:null;
  const outSigma=recentIpSigma(profile)*3;
  const rows=[];
  const add=(market,projection,sigma,source)=>{
    if(projection==null||!Number.isFinite(Number(projection)))return;
    rows.push({market,projection:round1(projection),sigma:round1(sigma),source});
  };
  add("pitcher_outs",ip*3,outSigma,"MLB_PERSISTENT_WORKLOAD_EXPECTED_IP_V1");
  add("hits_allowed",hitLambda,Math.sqrt(Math.max(.4,hitLambda??0)),"MLB_PERSISTENT_H9_X_MATCHUP_CONTACT_V1");
  add("earned_runs",erLambda,Math.sqrt(Math.max(.5,(erLambda??0)*1.18)),"MLB_PERSISTENT_ERA_X_MATCHUP_RUN_ENV_V1");
  add("walks_allowed",walkLambda,Math.sqrt(Math.max(.35,walkLambda??0)),"MLB_PERSISTENT_BB_X_OPPONENT_WALK_V1");
  return rows.map(r=>({
    ...r,playerId:String(sp.id),playerName:sp.name||profile.name||null,position:"P",team,
    expectedInnings:round1(ip),expectedBattersFaced:round1(expectedBf),modelVersion:MLB_PLAYER_PROP_MODEL_VERSION,
    maturity:"RESEARCH_UNVALIDATED",independent:true,marketInformed:false
  }));
}

function hitterIdsForSide(game,state,side){
  const team=teamAbbr(game?.[side]);
  const bpp=(game?.bpp?.batterMatchups||[]).filter(x=>String(x?.batterTeam||"").toUpperCase()===team).map(x=>String(x.batterId)).filter(Boolean);
  if(bpp.length>=5)return [...new Set(bpp)];
  const lineup=(state?.[side+"Team"]?.lineup?.activeHitters||[]).map(x=>String(x.id)).filter(Boolean);
  return [...new Set(lineup)];
}
function hitterRows(game,state,side){
  const team=teamAbbr(game?.[side]);
  const oppSide=side==="home"?"away":"home";
  const pitcher=oppSide==="home"?state?.homeStarter:state?.awayStarter;
  const pitcherProfile=pitcher?.statcastProfile||null;
  const starterIp=finite(pitcher?.expectedInnings)??finite(pitcher?.inningsPerStart)??5.35;
  const starterShare=clamp(starterIp/9+.08,.45,.80);
  const teamRuns=finite(game?.mlbDeepShadow?.[side])??finite(game?.model?.[side==="home"?"projHome":"projAway"]);
  const parkHr=finite(game?.mlbContext?.palParkHrFactor)??1;
  const ids=hitterIdsForSide(game,state,side);
  const all=state?.teamHitters?.[side]||{};
  const rows=[];
  for(const id of ids){
    const h=all[String(id)]||state?.hitters?.[String(id)];
    if(!h||!/active/i.test(String(h.status||"Active")))continue;
    const base=hitterFallbackRates(h);
    const pa=expectedPa(h,teamRuns);
    const scored=pitcherProfile&&h.statcastProfile?scorePitcherVsBatter(pitcherProfile,h.statcastProfile):null;
    const xFactor=clamp(((finite(scored?.xwoba)??.320)/.320)*.62+((finite(scored?.contactPerSwing)??.76)/.76)*.38,.72,1.34);
    const tbFactor=clamp(((finite(scored?.xwoba)??.320)/.320)*.55+((finite(scored?.hardHitRate)??.38)/.38)*.25+((finite(scored?.barrelRate)??.055)/.055)*.20,.68,1.48);
    const hrFactor=clamp(((finite(scored?.barrelRate)??.055)/.055)*.60+((finite(scored?.xwoba)??.320)/.320)*.25+parkHr*.15,.55,1.75);
    const oppBb=finite(pitcher?.bbRate)??.083;
    const starterK=finite(scored?.kRate)??base.k;
    const kRate=clamp(starterShare*starterK+(1-starterShare)*base.k,.05,.50);
    const hitRate=clamp(base.hit*(starterShare*xFactor+(1-starterShare)),.08,.38);
    const tbRate=clamp(base.tb*(starterShare*tbFactor+(1-starterShare)),.10,.85);
    const hrRate=clamp(base.hr*(starterShare*hrFactor+(1-starterShare)),.002,.18);
    const walkStarter=clamp(base.bb*(.55+.45*(oppBb/.083)),.02,.22);
    const bbRate=clamp(starterShare*walkStarter+(1-starterShare)*base.bb,.02,.22);
    const defs=[
      ["strikeouts",pa*kRate,Math.sqrt(Math.max(.25,pa*kRate*(1-kRate))),"MLB_BATTER_K_PITCH_SHAPE_ZONE_V1"],
      ["hits",pa*hitRate,Math.sqrt(Math.max(.25,pa*hitRate*(1-hitRate))),"MLB_BATTER_HITS_XWOBA_CONTACT_V1"],
      ["total_bases",pa*tbRate,Math.sqrt(Math.max(.40,pa*tbRate*1.25)),"MLB_BATTER_TOTAL_BASES_DAMAGE_V1"],
      ["home_runs",pa*hrRate,Math.sqrt(Math.max(.08,pa*hrRate*(1-hrRate))),"MLB_BATTER_HR_BARREL_XWOBA_PARK_V1"],
      ["walks",pa*bbRate,Math.sqrt(Math.max(.15,pa*bbRate*(1-bbRate))),"MLB_BATTER_WALKS_DISCIPLINE_PITCHER_BB_V1"],
    ];
    for(const [market,projection,sigma,source] of defs)rows.push({
      market,projection:round1(projection),sigma:round1(sigma),source,
      playerId:String(h.id||id),playerName:h.name||null,position:h.position||null,team,
      expectedPlateAppearances:round1(pa),starterExposure:round1(starterShare),matchupCoverage:finite(scored?.coverage),
      modelVersion:MLB_PLAYER_PROP_MODEL_VERSION,maturity:"RESEARCH_UNVALIDATED",independent:true,marketInformed:false
    });
  }
  return rows;
}

export function buildMlbPersistentPlayerPropRows(game,state){
  if(!state?.fresh)return[];
  return [
    ...pitcherRows(game,state,"home"),
    ...pitcherRows(game,state,"away"),
    ...hitterRows(game,state,"home"),
    ...hitterRows(game,state,"away"),
  ];
}
