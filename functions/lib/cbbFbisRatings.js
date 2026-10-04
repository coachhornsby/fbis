/**
 * FBIS-CBB-RATINGS-v1
 * Independent opponent-adjusted CBB rating system.
 * Inputs: prior completed game/team box scores only.
 * Forbidden inputs: KenPom ratings/projections, Torvik ratings/projections, sportsbook markets.
 */
import { cbbdGet, cbbSeasonYear } from "./collegeApi.js";
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";
import { buildIndependentHca, hcaForTeam, FBIS_CBB_HISTORICAL_GLOBAL_HCA } from "./cbbFbisHca.js";

export const FBIS_CBB_MODEL_ID = "FBIS-CBB-RATINGS-v2";
export const FBIS_CBB_MODEL_VERSION = "v2.0.0";
export const FBIS_CBB_NATIONAL_EFF = 104.5;
export const FBIS_CBB_NATIONAL_TEMPO = 68.0;
export const FBIS_CBB_GLOBAL_HCA = FBIS_CBB_HISTORICAL_GLOBAL_HCA;

const CACHE_TTL = 2 * 60 * 60 * 1000;
const EPS = 1e-9;
const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const key = (v) => String(v || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const weightedMean = (rows, fn, priorValue = 0, priorWeight = 0) => {
  let sw = priorWeight, sx = priorWeight * priorValue;
  for (const r of rows) {
    const x = fn(r);
    if (!Number.isFinite(x)) continue;
    const w = Number(r.weight) || 0;
    sw += w; sx += w * x;
  }
  return sw > 0 ? sx / sw : priorValue;
};

function firstText(obj, paths = []) {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, part) => acc == null ? null : acc[part], obj);
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}
function firstNum(obj, paths = []) {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, part) => acc == null ? null : acc[part], obj);
    const n = num(value);
    if (n != null) return n;
  }
  return null;
}
function conferenceOf(row) {
  return firstText(row, [
    "conference","conferenceAbbreviation","conference.abbreviation","conference.name",
    "teamConference","teamConference.abbreviation","teamConference.name",
    "team.conference","team.conference.abbreviation","team.conference.name"
  ]);
}
function normalizeStats(row = {}) {
  const s = row.teamStats ?? row.team_stats ?? row.stats ?? {};
  const o = row.opponentStats ?? row.opponent_stats ?? {};
  const reb = s.rebounds ?? {};
  const ff = s.fourFactors ?? s.four_factors ?? {};
  const fgm = firstNum(s, ["fieldGoals.made","field_goals.made"]) ?? firstNum(row, ["fgm"]);
  const fga = firstNum(s, ["fieldGoals.attempted","field_goals.attempted"]) ?? firstNum(row, ["fga"]);
  const tpm = firstNum(s, ["threePointFieldGoals.made","three_point_field_goals.made"]) ?? firstNum(row, ["threeMade"]);
  const tpa = firstNum(s, ["threePointFieldGoals.attempted","three_point_field_goals.attempted"]) ?? firstNum(row, ["threeAtt"]);
  const ftm = firstNum(s, ["freeThrows.made","free_throws.made"]) ?? firstNum(row, ["ftm"]);
  const fta = firstNum(s, ["freeThrows.attempted","free_throws.attempted"]) ?? firstNum(row, ["fta"]);
  const orb = firstNum(reb, ["offensive"]) ?? firstNum(row, ["orb"]);
  const drb = firstNum(reb, ["defensive"]) ?? firstNum(row, ["drb"]);
  const tov = firstNum(s, ["turnovers.total"]) ?? firstNum(row, ["turnovers"]);
  const poss = firstNum(s, ["possessions"]) ?? firstNum(row, ["possessions"]) ??
    (fga != null && orb != null && tov != null && fta != null ? fga - orb + tov + 0.475 * fta : null);
  const points = firstNum(row, ["points","score","teamPoints","team_points"]) ??
    (fgm != null && tpm != null && ftm != null ? 2 * fgm + tpm + ftm : null);
  const twoMade = firstNum(s, ["twoPointFieldGoals.made","two_point_field_goals.made"]) ?? (fgm != null && tpm != null ? fgm - tpm : null);
  const twoAtt = firstNum(s, ["twoPointFieldGoals.attempted","two_point_field_goals.attempted"]) ?? (fga != null && tpa != null ? fga - tpa : null);
  return {
    fgm,fga,twoMade,twoAtt,threeMade:tpm,threeAtt:tpa,ftm,fta,orb,drb,tov,poss,points,
    efgPct:firstNum(ff, ["effectiveFieldGoalPct","effective_field_goal_pct"]) ?? (fgm != null && tpm != null && fga ? 100 * (fgm + .5*tpm) / fga : null),
    orbRate:firstNum(ff, ["offensiveReboundPct","offensive_rebound_pct"]),
    tovRate:firstNum(ff, ["turnoverRatio","turnover_ratio"]) ?? (tov != null && poss ? 100*tov/poss : null),
    ftr:firstNum(ff, ["freeThrowRate","free_throw_rate"]) ?? (fta != null && fga ? 100*fta/fga : null),
    oppDrb:firstNum(o, ["rebounds.defensive"]),
  };
}

export function normalizeFbisCbbGameTeamRows(rows = [], seasonStart = null) {
  return (rows || []).map((row) => {
    const team = firstText(row, ["team.school","team.name","team","school"]);
    const opponent = firstText(row, ["opponent.school","opponent.name","opponent"]);
    const mapped = mapSourceTeam("cbb", { team, school:team, conference:conferenceOf(row) }, seasonStart);
    const stats = normalizeStats(row);
    return {
      gameId:String(row.gameId ?? row.game_id ?? row.id ?? ""),
      startDate:row.startDate ?? row.start_date ?? row.date ?? null,
      season:Number(row.season ?? seasonStart),
      team, opponent,
      teamId:mapped.ok ? mapped.canonicalId : "name:" + key(team),
      conference:conferenceOf(row),
      neutral:Boolean(row.neutralSite ?? row.neutral_site ?? row.neutral),
      isHome:Boolean(row.isHome ?? row.is_home ?? String(row.homeAway || row.home_away || "").toLowerCase()==="home"),
      ...stats,
    };
  }).filter(r => r.gameId && r.startDate && r.team && r.opponent && r.points != null && r.poss != null && r.poss > 0);
}

function pairObservations(rows, asOf) {
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const grouped = new Map();
  for (const r of rows) {
    const t = Date.parse(r.startDate);
    if (!Number.isFinite(t) || t >= cutoff) continue;
    if (!grouped.has(r.gameId)) grouped.set(r.gameId, []);
    grouped.get(r.gameId).push(r);
  }
  const out = [];
  for (const [gameId, g] of grouped) {
    if (g.length < 2) continue;
    for (const r of g) {
      const opp = g.find(x => key(x.team) === key(r.opponent)) || g.find(x => x.teamId !== r.teamId);
      if (!opp) continue;
      const poss = mean([r.poss, opp.poss].filter(Number.isFinite));
      if (!poss || poss <= 0) continue;
      out.push({
        gameId,date:r.startDate,team:r.team,teamId:r.teamId,opponent:opp.team,opponentId:opp.teamId,
        conference:r.conference,opponentConference:opp.conference,neutral:r.neutral,isHome:r.isHome,
        points:r.points,oppPoints:opp.points,possessions:poss,rawOE:100*r.points/poss,rawDE:100*opp.points/poss,rawTempo:poss,
        margin:r.points-opp.points,efgPct:r.efgPct,
        twoPtPct:r.twoAtt ? 100*r.twoMade/r.twoAtt : null,
        threePtPct:r.threeAtt ? 100*r.threeMade/r.threeAtt : null,
        orbRate:r.orbRate ?? ((r.orb != null && opp.drb != null && r.orb+opp.drb>0) ? 100*r.orb/(r.orb+opp.drb) : null),
        tovRate:r.tovRate,ftr:r.ftr,efgPctD:opp.efgPct,
        twoPtPctD:opp.twoAtt ? 100*opp.twoMade/opp.twoAtt : null,
        threePtPctD:opp.threeAtt ? 100*opp.threeMade/opp.threeAtt : null,
        tovRateD:opp.tovRate,ftrD:opp.ftr,
      });
    }
  }
  return out;
}
function gameWeight(obs, asOf, { halfLifeDays = 35, blowoutStart = 15, blowoutScale = 25 } = {}) {
  const ageDays = Math.max(0, (Date.parse(asOf) - Date.parse(obs.date)) / 86400000);
  const recency = Math.pow(0.5, ageDays / halfLifeDays);
  const excess = Math.max(0, Math.abs(obs.margin) - blowoutStart);
  const blowout = 1 / Math.sqrt(1 + excess / blowoutScale);
  return recency * blowout;
}
function weightedSd(rows, fn, mu) {
  let sw=0,ss=0;
  for(const r of rows){const x=fn(r);if(!Number.isFinite(x))continue;const w=r.weight||0;sw+=w;ss+=w*(x-mu)*(x-mu)}
  return sw>0?Math.sqrt(ss/sw):null;
}

export function buildFbisCbbRatings(rows = [], {
  asOf = new Date().toISOString(), season = null, nationalEff = FBIS_CBB_NATIONAL_EFF,
  nationalTempo = FBIS_CBB_NATIONAL_TEMPO, priorGames = 4, conferencePriorGames = 2,
  iterations = 24, halfLifeDays = 35, globalHca = FBIS_CBB_GLOBAL_HCA,
} = {}) {
  const obs = pairObservations(rows, asOf).map(x => ({...x,weight:gameWeight(x,asOf,{halfLifeDays})}));
  // Dynamic national scoring/tempo environment, shrunk to long-run priors.
  // This prevents fixed-baseline drift across rule/scoring eras and unusual seasons.
  nationalEff = clamp(weightedMean(obs,g=>g.rawOE,nationalEff,200),92,125);
  nationalTempo = clamp(weightedMean(obs,g=>g.rawTempo,nationalTempo,200),58,76);
  const byTeam = new Map();
  for (const o of obs) { if (!byTeam.has(o.teamId)) byTeam.set(o.teamId, []); byTeam.get(o.teamId).push(o); }
  const ratings = new Map();
  for (const [id, games] of byTeam) {
    ratings.set(id,{teamId:id,team:games[0].team,conference:games.map(g=>g.conference).find(Boolean)||null,
      adjOe:weightedMean(games,g=>g.rawOE,nationalEff,priorGames),
      adjDe:weightedMean(games,g=>g.rawDE,nationalEff,priorGames),
      tempo:weightedMean(games,g=>g.rawTempo,nationalTempo,priorGames)});
  }
  for (let it=0; it<iterations; it++) {
    const next=new Map();
    for(const [id,games] of byTeam){
      const prev=ratings.get(id);
      const adjOe=weightedMean(games,g=>{const opp=ratings.get(g.opponentId);return opp?.adjDe?g.rawOE*nationalEff/opp.adjDe:null;},nationalEff,priorGames);
      const adjDe=weightedMean(games,g=>{const opp=ratings.get(g.opponentId);return opp?.adjOe?g.rawDE*nationalEff/opp.adjOe:null;},nationalEff,priorGames);
      const tempo=weightedMean(games,g=>{const opp=ratings.get(g.opponentId);return opp?.tempo?g.rawTempo*nationalTempo/opp.tempo:null;},nationalTempo,priorGames);
      next.set(id,{...prev,adjOe:clamp(adjOe,75,135),adjDe:clamp(adjDe,75,135),tempo:clamp(tempo,55,82)});
    }
    ratings.clear(); for(const [id,r] of next)ratings.set(id,r);
  }

  let confGroups={};
  for(const r of ratings.values()){if(r.conference)(confGroups[r.conference]??=[]).push(r)}
  let conferences=Object.fromEntries(Object.entries(confGroups).map(([c,rs])=>[c,{conference:c,teams:rs.length,
    adjOe:mean(rs.map(x=>x.adjOe)),adjDe:mean(rs.map(x=>x.adjDe)),net:mean(rs.map(x=>x.adjOe-x.adjDe)),tempo:mean(rs.map(x=>x.tempo))}]));

  for(const [id,r] of ratings){
    const games=byTeam.get(id)||[], conf=conferences[r.conference];
    if(!conf||conferencePriorGames<=0)continue;
    const n=Math.max(0,games.reduce((s,g)=>s+(g.weight||0),0));
    const w=conferencePriorGames/(conferencePriorGames+n+EPS);
    r.adjOe=(1-w)*r.adjOe+w*conf.adjOe; r.adjDe=(1-w)*r.adjDe+w*conf.adjDe; r.tempo=(1-w)*r.tempo+w*conf.tempo;
    r.conferencePriorWeight=Number(w.toFixed(4));
  }

  confGroups={};
  for(const r of ratings.values()){if(r.conference)(confGroups[r.conference]??=[]).push(r)}
  conferences=Object.fromEntries(Object.entries(confGroups).map(([c,rs])=>[c,{conference:c,teams:rs.length,
    adjOe:mean(rs.map(x=>x.adjOe)),adjDe:mean(rs.map(x=>x.adjDe)),net:mean(rs.map(x=>x.adjOe-x.adjDe)),tempo:mean(rs.map(x=>x.tempo))}]));

  for(const [id,r] of ratings){
    const games=byTeam.get(id)||[];
    const oppRatings=games.map(g=>ratings.get(g.opponentId)).filter(Boolean);
    const nonConf=games.filter(g=>g.conference&&g.opponentConference&&g.conference!==g.opponentConference).map(g=>ratings.get(g.opponentId)).filter(Boolean);
    r.games=games.length; r.effectiveGames=Number(games.reduce((s,g)=>s+(g.weight||0),0).toFixed(2)); r.net=Number((r.adjOe-r.adjDe).toFixed(3));
    r.sos=oppRatings.length?mean(oppRatings.map(x=>x.adjOe-x.adjDe)):0;
    r.sosO=oppRatings.length?mean(oppRatings.map(x=>x.adjOe)):nationalEff;
    r.sosD=oppRatings.length?mean(oppRatings.map(x=>x.adjDe)):nationalEff;
    r.nonConferenceSos=nonConf.length?mean(nonConf.map(x=>x.adjOe-x.adjDe)):null; r.nonConferenceGames=nonConf.length;
    const paceResiduals=games.map(g=>{const opp=ratings.get(g.opponentId);if(!opp)return null;const expected=(r.tempo*opp.tempo)/nationalTempo;return {...g,paceResidual:g.rawTempo-expected};}).filter(Boolean);
    r.pacePressure=weightedMean(paceResiduals,g=>g.paceResidual,0,10);
    const paceSd=weightedSd(paceResiduals,g=>g.paceResidual,r.pacePressure);
    r.paceControl=paceSd==null?0.35:clamp(1-paceSd/12,0.1,0.9);
    r.conferenceStrength=r.conference&&conferences[r.conference]?conferences[r.conference].net:null;
    for(const f of ["efgPct","twoPtPct","threePtPct","orbRate","tovRate","ftr","efgPctD","twoPtPctD","threePtPctD","tovRateD","ftrD"]){
      const vals=games.filter(g=>Number.isFinite(g[f]));
      r[f]=vals.length?weightedMean(vals,g=>g[f],0,0):null;
    }
    // HCA is assigned after all team ratings are complete by the independent hierarchical HCA model.
    const adjustedGameNets=games.map(g=>{const opp=ratings.get(g.opponentId);if(!opp)return null;
      return {...g,adjNet:(g.rawOE*nationalEff/opp.adjDe)-(g.rawDE*nationalEff/opp.adjOe)};}).filter(Boolean);
    const sd=weightedSd(adjustedGameNets,g=>g.adjNet,r.net);
    const scheduleBreadth=new Set(games.map(g=>g.opponentId)).size;
    const sampleReliability=1-Math.exp(-r.effectiveGames/8), breadthReliability=1-Math.exp(-scheduleBreadth/8);
    const variancePenalty=sd==null?0.6:clamp(1-sd/35,0.1,1);
    r.reliability=clamp(sampleReliability*breadthReliability*variancePenalty,0,1);
    r.uncertainty={adjustedNetSd:sd,scheduleBreadth,reliability:r.reliability,lowSample:r.effectiveGames<5,weakScheduleEvidence:oppRatings.length<5};
  }

  const hcaCatalog=buildIndependentHca(obs,ratings,{nationalEff,nationalTempo,historicalGlobalHca:globalHca});
  for(const [id,r] of ratings) r.hca=hcaForTeam(hcaCatalog,id);

  return {ok:ratings.size>0,modelId:FBIS_CBB_MODEL_ID,modelVersion:FBIS_CBB_MODEL_VERSION,asOf,season,
    methodology:{independent:true,marketInformed:false,kenpomInput:false,torvikInput:false,
      opponentAdjustment:"iterative multiplicative AdjOE/AdjDE/AdjTempo",recencyHalfLifeDays:halfLifeDays,blowoutDownWeighting:true,
      priorGames,conferencePriorGames,scheduleStrength:"average FBIS opponent net; separate offensive/defensive and nonconference SOS",
      conferenceStrength:"mean FBIS net rating of conference members; early-season shrink only",
      teamHca:"FBIS-CBB-HCA-v1 hierarchical residual model; no KenPom/Torvik/market",
      dynamicNationalEnvironment:true,
      paceControl:"team pace-pressure residual + imposition reliability"},
    national:{eff:nationalEff,tempo:nationalTempo,globalHca:hcaCatalog.globalHca},hcaModel:hcaCatalog,conferences,
    byTeamId:Object.fromEntries([...ratings.entries()]),byTeam:Object.fromEntries([...ratings.values()].map(r=>[key(r.team),r])),observations:obs.length};
}

export function lookupFbisCbbRating(catalog, team) {
  if(!catalog)return null;
  const id=team?.canonicalId || team?.id;
  return catalog.byTeamId?.[id] || catalog.byTeam?.[key(team?.school||team?.name||team)] || null;
}
function matchupScore(home,away){
  return {efg:(home.efgPct!=null&&away.efgPctD!=null)?home.efgPct-away.efgPctD:null,
    twoPt:(home.twoPtPct!=null&&away.twoPtPctD!=null)?home.twoPtPct-away.twoPtPctD:null,
    threePt:(home.threePtPct!=null&&away.threePtPctD!=null)?home.threePtPct-away.threePtPctD:null,
    turnover:(home.tovRate!=null&&away.tovRateD!=null)?away.tovRateD-home.tovRate:null,
    ftr:(home.ftr!=null&&away.ftrD!=null)?home.ftr-away.ftrD:null};
}
export function projectFbisCbbGame(game, home, away, {
  nationalEff=FBIS_CBB_NATIONAL_EFF,nationalTempo=FBIS_CBB_NATIONAL_TEMPO,globalHca=FBIS_CBB_GLOBAL_HCA,matchupCoefficients=null,
}={}) {
  if(!home||!away)return{ok:false,modelId:FBIS_CBB_MODEL_ID,reason:"missing-fbis-ratings"};
  const basePossessions=(home.tempo*away.tempo)/nationalTempo;
  const paceWeight=(Number(home.paceControl)||0)+(Number(away.paceControl)||0);
  const paceAdjustment=paceWeight>0?
    (((Number(home.pacePressure)||0)*(Number(home.paceControl)||0)+(Number(away.pacePressure)||0)*(Number(away.paceControl)||0))/paceWeight):0;
  const possessions=clamp(basePossessions+clamp(paceAdjustment,-4,4),55,82);
  let homeEff=home.adjOe*away.adjDe/nationalEff, awayEff=away.adjOe*home.adjDe/nationalEff;
  const homeMatch=matchupScore(home,away),awayMatch=matchupScore(away,home);
  let matchupAdjHome=0,matchupAdjAway=0;
  if(matchupCoefficients){for(const [k,b] of Object.entries(matchupCoefficients)){
    if(Number.isFinite(homeMatch[k]))matchupAdjHome+=Number(b)*homeMatch[k];
    if(Number.isFinite(awayMatch[k]))matchupAdjAway+=Number(b)*awayMatch[k];}
    homeEff+=matchupAdjHome;awayEff+=matchupAdjAway;}
  const neutral=Boolean(game?.neutralSite||game?.neutral);
  const hca=neutral?0:clamp((Number(home.hca)||globalHca),0,8);
  const homePts=homeEff*possessions/100+hca/2, awayPts=awayEff*possessions/100-hca/2;
  const reliability=Math.sqrt(Math.max(0,home.reliability||0)*Math.max(0,away.reliability||0));
  return {ok:true,modelId:FBIS_CBB_MODEL_ID,modelVersion:FBIS_CBB_MODEL_VERSION,independent:true,marketInformed:false,kenpomInput:false,torvikInput:false,
    home:Number(homePts.toFixed(1)),away:Number(awayPts.toFixed(1)),total:Number((homePts+awayPts).toFixed(1)),margin:Number((homePts-awayPts).toFixed(1)),
    possessions:Number(possessions.toFixed(1)),basePossessions:Number(basePossessions.toFixed(1)),paceAdjustment:Number(paceAdjustment.toFixed(2)),
    homeEff:Number(homeEff.toFixed(2)),awayEff:Number(awayEff.toFixed(2)),hca:Number(hca.toFixed(2)),
    sigmaTotal:Number(clamp(16-5*reliability,10,16).toFixed(2)),sigmaMargin:Number(clamp(13-4*reliability,9,13).toFixed(2)),
    reliability:Number(reliability.toFixed(3)),
    schedule:{home:{sos:home.sos,sosO:home.sosO,sosD:home.sosD,nonConferenceSos:home.nonConferenceSos,conferenceStrength:home.conferenceStrength},
      away:{sos:away.sos,sosO:away.sosO,sosD:away.sosD,nonConferenceSos:away.nonConferenceSos,conferenceStrength:away.conferenceStrength}},
    matchup:{home:homeMatch,away:awayMatch,coefficientsApplied:Boolean(matchupCoefficients),homeAdjustment:matchupAdjHome,awayAdjustment:matchupAdjAway}};
}

export async function loadFbisCbbCatalog(env={}, {season=cbbSeasonYear(), asOf=new Date().toISOString(), fetchFn=fetch}={}) {
  const cacheKey="fbis-cbb-native-v1-"+season+"-"+String(asOf).slice(0,13);
  const cached=await readCache(cacheKey,env.caches,CACHE_TTL);
  if(cached?.ok&&cached?.byTeamId)return{...cached,cacheHit:true};
  const res=await cbbdGet("/games/teams",env,{query:{season:Number(season)+1},fetchFn});
  if(!res.ok)return{ok:false,modelId:FBIS_CBB_MODEL_ID,error:res.reason||"cbbd-game-teams-unavailable",byTeamId:{},byTeam:{}};
  const rows=normalizeFbisCbbGameTeamRows(res.data||[],season);
  const catalog=buildFbisCbbRatings(rows,{asOf,season});
  const out={...catalog,source:"cbbd-games-teams",sourceRows:rows.length,cacheHit:false};
  await writeCache(cacheKey,out,env.caches,CACHE_TTL);
  return out;
}
