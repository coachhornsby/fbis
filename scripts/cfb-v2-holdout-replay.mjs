#!/usr/bin/env node
/**
 * Strict 2026-09-25 CFB holdout replay for the corrected production artifact.
 * All predictive features are reconstructed strictly before kickoff.
 * Final scores are attached only after projection for evaluation.
 */
import {
  fetchSeasonFeatureBundle,
  buildPriorCatalog,
  buildFcsConferenceStrength,
  assembleGameFeatures,
} from "../functions/lib/cfbFeaturePipeline.js";
import { projectCfbFbisV2Production } from "../functions/lib/cfbFbisV2.js";

const proxyBase=String(process.env.CFBD_REFIT_PROXY_BASE||"").replace(/\/$/,"");
const proxySecret=String(process.env.CFBD_REFIT_PROXY_SECRET||"");
if(!proxyBase||!proxySecret) throw new Error("CFBD_REFIT_PROXY_BASE and CFBD_REFIT_PROXY_SECRET required");

const targetIds=new Set(["401862779","401862778","401858468","401858461","401858234"]);

async function proxyFetch(url){
  const up=new URL(String(url));
  const p=new URL(`${proxyBase}/api/cfbd-refit-export`);
  p.searchParams.set("endpoint",up.pathname);
  for(const [k,v] of up.searchParams.entries()) p.searchParams.set(k,v);
  const r=await fetch(p,{headers:{"x-harvest-secret":proxySecret,accept:"application/json"}});
  const text=await r.text();
  return new Response(text,{status:r.status,headers:{"content-type":"application/json"}});
}

async function get(path,query={}){
  const p=new URL(`${proxyBase}/api/cfbd-refit-export`);
  p.searchParams.set("endpoint",path);
  for(const [k,v] of Object.entries(query)) if(v!=null) p.searchParams.set(k,String(v));
  const r=await fetch(p,{headers:{"x-harvest-secret":proxySecret,accept:"application/json"}});
  if(!r.ok) throw new Error(`proxy ${r.status} ${path}`);
  const x=await r.json();
  return Array.isArray(x)?x:[];
}

function attachKickoffs(rows,games){
  const byId=new Map((games||[]).map(g=>[String(g.id),g.startDate||g.start_date||null]));
  return (rows||[]).map(r=>({
    ...r,
    startDate:r.startDate||r.start_date||byId.get(String(r.gameId||r.game_id||r.id))||null,
    gameId:r.gameId||r.game_id||r.id||null,
  }));
}

const priorBundle=await fetchSeasonFeatureBundle({CFBD_API_KEY:"proxy-via-fbis"},2025,{
  week:null,fetchFn:proxyFetch
});
const priorCatalog=buildPriorCatalog(priorBundle);
const confMap=buildFcsConferenceStrength(priorCatalog);

const games=await get("/games",{year:2026,seasonType:"regular"});
const targets=games.filter(g=>targetIds.has(String(g.id)));
if(targets.length!==targetIds.size){
  throw new Error(`expected ${targetIds.size} target games, found ${targets.length}`);
}

const ppaRows=[],advRows=[];
for(let week=1;week<=6;week++){
  const [p,a]=await Promise.all([
    get("/ppa/games",{year:2026,week,seasonType:"regular"}),
    get("/stats/game/advanced",{year:2026,week,seasonType:"regular"}),
  ]);
  ppaRows.push(...p.map(x=>({...x,week})));
  advRows.push(...a.map(x=>({...x,week})));
}
const ppa=attachKickoffs(ppaRows,games);
const adv=attachKickoffs(advRows,games);

const projected=[];
for(const game of targets){
  const kickoff=game.startDate||game.start_date;
  if(!kickoff) throw new Error(`missing kickoff for ${game.id}`);
  const asOf=new Date(Date.parse(kickoff)-60_000).toISOString();
  const record=assembleGameFeatures({
    game,
    priorCatalog,
    confMap,
    ppaGameRows:ppa,
    advGameRows:adv,
    qbRows:[],
    usageRows:[],
    playerGameRows:[],
    coreByTeam:null,
    collectionTimestamp:asOf,
    mode:"historical",
  });
  if(!record?.temporalOk) throw new Error(`temporal gate failed for ${game.id}`);
  const home=record.features?.home||{};
  const away=record.features?.away||{};
  const input={
    sport:"cfb",
    home:{name:record.home_team,school:record.home_team},
    away:{name:record.away_team,school:record.away_team},
    neutralSite:Boolean(record.features?.neutralSite),
    featureCutoffOk:true,
    cfbFbisV2Input:{home,away},
  };
  const projection=projectCfbFbisV2Production(input);
  if(!projection?.ok||!projection?.fittedApplied) throw new Error(`projection failed ${game.id}: ${projection?.reason||"unknown"}`);

  // Actual result is read only after the projection is complete.
  const actualHome=Number(game.homePoints??game.home_points);
  const actualAway=Number(game.awayPoints??game.away_points);
  projected.push({
    gameId:String(game.id),
    matchup:`${record.away_team} @ ${record.home_team}`,
    kickoff,
    featureAsOf:asOf,
    sourceGames:{home:home.gamesPlayed||0,away:away.gamesPlayed||0},
    architecture:{Mstar:projection.Mstar,Tstar:projection.Tstar,version:projection.version},
    projected:{
      away:projection.away,home:projection.home,
      marginHome:projection.margin,total:projection.total,
      sigmaMargin:projection.sigmaMargin,
    },
    actual:{
      away:actualAway,home:actualHome,
      marginHome:actualHome-actualAway,total:actualHome+actualAway,
    },
    error:{
      margin:projection.margin-(actualHome-actualAway),
      absMargin:Math.abs(projection.margin-(actualHome-actualAway)),
      total:projection.total-(actualHome+actualAway),
      absTotal:Math.abs(projection.total-(actualHome+actualAway)),
    },
    featureAudit:{
      homeOffensePpa:home.offensePpa??null,awayOffensePpa:away.offensePpa??null,
      homeDefensePpa:home.defensePpa??null,awayDefensePpa:away.defensePpa??null,
      homePaceNorm:home.paceNorm??null,awayPaceNorm:away.paceNorm??null,
      marketUsed:false,
    }
  });
}
projected.sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
console.log(JSON.stringify({ok:true,trainingLeakage:false,holdoutDate:"2026-09-25",games:projected},null,2));
