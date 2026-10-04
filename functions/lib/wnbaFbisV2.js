/**
 * WNBA-FBIS-v2 possession/efficiency research engine.
 *
 * Live context comes from ESPN team schedules + game summaries. It derives
 * estimated possessions, pace, ORtg and DRtg from completed pregame box scores.
 * No sportsbook or PrizePicks line is used as a projection input.
 */
import { pGreater } from "./metrics.js";

export const WNBA_FBIS_V2_ID="WNBA-FBIS-v2";
export const WNBA_FBIS_V2_VERSION="v2-possession-open-authority";

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

function espnTeamId(team={}){
  if(team.espnId!=null)return String(team.espnId);
  const m=String(team.canonicalId||team.id||"").match(/^[a-z]+-(\d+)$/i);
  return m?m[1]:null;
}
function cleanStatName(v){
  return String(v||"").replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function statValue(stats=[],aliases=[]){
  const wanted=new Set(aliases.map(cleanStatName));
  for(const s of stats||[]){
    const k=cleanStatName(s?.name||s?.displayName||s?.abbreviation||s?.label);
    const txt=String(s?.displayValue??"").trim();
    const parts=txt.split("-").map(finite);
    if(wanted.has(k)){
      const direct=finite(s?.value);
      if(direct!=null)return direct;
      const first=finite(txt.split("-")[0]);
      if(first!=null)return first;
    }
    if((wanted.has("field goal attempts")||wanted.has("field goals attempted")||wanted.has("fga")) &&
       k.includes("field goals made")&&k.includes("field goals attempted")&&parts[1]!=null) return parts[1];
    if((wanted.has("free throw attempts")||wanted.has("free throws attempted")||wanted.has("fta")) &&
       k.includes("free throws made")&&k.includes("free throws attempted")&&parts[1]!=null) return parts[1];
    if((wanted.has("offensive rebounds")||wanted.has("off rebounds")||wanted.has("oreb")) &&
       (k==="offensive rebounds"||k==="rebounds offensive")){
      const v=finite(s?.value??txt); if(v!=null)return v;
    }
    if((wanted.has("turnovers")||wanted.has("to"))&&k==="turnovers"){
      const v=finite(s?.value??txt); if(v!=null)return v;
    }
  }
  return null;
}
async function cachedJson(url,env={}){
  const cache=env?.caches;
  if(cache){
    const req=new Request(url);
    const hit=await cache.match(req);
    if(hit)return hit.json();
    const r=await fetch(req,{headers:{"user-agent":"FBIS-WNBA-v2/1.0",accept:"application/json"}});
    if(!r.ok)throw new Error(`WNBA v2 HTTP ${r.status}`);
    const body=await r.clone().json();
    const cached=new Response(JSON.stringify(body),{headers:{"content-type":"application/json","cache-control":"public, max-age=21600"}});
    try{await cache.put(req,cached)}catch{}
    return body;
  }
  const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-v2/1.0",accept:"application/json"}});
  if(!r.ok)throw new Error(`WNBA v2 HTTP ${r.status}`);
  return r.json();
}
function eventRows(schedule,before){
  const cutoff=Date.parse(String(before||""))||Date.now();
  return (schedule?.events||[]).filter(ev=>{
    const t=Date.parse(ev?.date||"");
    const complete=ev?.status?.type?.completed===true||ev?.competitions?.[0]?.status?.type?.completed===true;
    return complete&&Number.isFinite(t)&&t<cutoff;
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
function parseSummary(summary,eventId){
  const comp=summary?.header?.competitions?.[0];
  const competitors=comp?.competitors||[];
  const statsTeams=summary?.boxscore?.teams||[];
  const out=[];
  for(const c of competitors){
    const tid=String(c?.team?.id||c?.id||"");
    if(!tid)continue;
    const box=statsTeams.find(x=>String(x?.team?.id||"")===tid);
    const stats=box?.statistics||[];
    const score=finite(c?.score);
    const fga=statValue(stats,["field goal attempts","field goals attempted","fga"]);
    const fta=statValue(stats,["free throw attempts","free throws attempted","fta"]);
    const orb=statValue(stats,["offensive rebounds","off rebounds","oreb"]);
    const tov=statValue(stats,["turnovers","to"]);
    if(score==null||fga==null||fta==null||orb==null||tov==null)continue;
    const poss=Math.max(1,fga-orb+tov+0.44*fta);
    out.push({eventId:String(eventId),teamId:tid,score,poss});
  }
  if(out.length!==2)return [];
  const a=out[0],b=out[1];
  return [
    {...a,oppId:b.teamId,oppScore:b.score,ortg:a.score/a.poss*100,drtg:b.score/b.poss*100,pace:(a.poss+b.poss)/2},
    {...b,oppId:a.teamId,oppScore:a.score,ortg:b.score/b.poss*100,drtg:a.score/a.poss*100,pace:(a.poss+b.poss)/2},
  ];
}
function weighted(rows,key){
  if(!rows.length)return null;
  let num=0,den=0;
  for(let i=0;i<rows.length;i++){
    const v=finite(rows[i]?.[key]); if(v==null)continue;
    const w=Math.pow(0.90,i);
    num+=v*w; den+=w;
  }
  return den?num/den:null;
}
function teamProfile(rows=[],league={}){
  const n=rows.length;
  if(!n)return null;
  const shrink=n/(n+6);
  const avg=(key,prior)=> {
    const v=weighted(rows,key);
    return (v??prior)*shrink+prior*(1-shrink);
  };
  return {
    games:n,
    ortg:avg("ortg",league.ortg),
    drtg:avg("drtg",league.ortg),
    pace:avg("pace",league.pace),
  };
}
function leagueProfile(rows=[]){
  const ortg=rows.length?rows.reduce((s,r)=>s+(finite(r.ortg)||0),0)/rows.length:101.5;
  const pace=rows.length?rows.reduce((s,r)=>s+(finite(r.pace)||0),0)/rows.length:79.5;
  return {ortg:clamp(ortg,92,112),pace:clamp(pace,72,86)};
}

export async function loadWnbaV2Context(games=[],date=null,env={}){
  const ids=[...new Set((games||[]).flatMap(g=>[espnTeamId(g.home),espnTeamId(g.away)]).filter(Boolean))];
  const before=String(date||games?.[0]?.start||new Date().toISOString());
  const year=new Date(before).getUTCFullYear();
  const schedules=await Promise.all(ids.map(async id=>{
    const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${id}/schedule?season=${year}`;
    try{return [id,await cachedJson(url,env)]}catch{return [id,null]}
  }));
  const eventIds=[...new Set(schedules.flatMap(([,s])=>eventRows(s,before).slice(0,14).map(e=>String(e.id))))];
  const summaries=await Promise.all(eventIds.map(async eid=>{
    const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${eid}`;
    try{return parseSummary(await cachedJson(url,env),eid)}catch{return []}
  }));
  const rows=summaries.flat();
  const league=leagueProfile(rows);
  const byTeam={};
  for(const id of ids){
    const rs=rows.filter(r=>r.teamId===id).slice(0,14);
    byTeam[id]=teamProfile(rs,league);
  }
  return {byTeam,league,rows,meta:{source:"ESPN_WNBA_BOX_POSSESSIONS",teams:ids.length,games:eventIds.length,rows:rows.length,marketInformed:false}};
}

export function projectWnbaV2(game,ctx={}){
  const hId=espnTeamId(game?.home),aId=espnTeamId(game?.away);
  const h=ctx.byTeam?.[hId],a=ctx.byTeam?.[aId],league=ctx.league||{ortg:101.5,pace:79.5};
  if(!h||!a)return {ok:false,modelId:WNBA_FBIS_V2_ID,reason:"possession_context_missing",marketInformed:false,canQualify:false};
  const pace=clamp((h.pace+a.pace+league.pace)/3,72,86);
  const hEff=clamp((h.ortg+a.drtg+league.ortg)/3,88,116);
  const aEff=clamp((a.ortg+h.drtg+league.ortg)/3,88,116);
  const hfa=game?.neutralSite?0:2.1;
  const home=clamp(pace*hEff/100+hfa/2,58,112);
  const away=clamp(pace*aEff/100-hfa/2,58,112);
  const margin=home-away,total=home+away;
  return {
    ok:true,modelId:WNBA_FBIS_V2_ID,modelVersion:WNBA_FBIS_V2_VERSION,
    home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
    pHomeWin:pGreater(margin,0,10.2),sigmaMargin:10.2,sigmaTotal:12.1,
    independent:true,marketInformed:false,maturity:"ACTIVE",canQualify:true,canAuthorize:true,
    decomposition:{
      pace:round1(pace),leagueOrtg:round1(league.ortg),
      home:{games:h.games,ortg:round1(h.ortg),drtg:round1(h.drtg),pace:round1(h.pace),matchupOrtg:round1(hEff)},
      away:{games:a.games,ortg:round1(a.ortg),drtg:round1(a.drtg),pace:round1(a.pace),matchupOrtg:round1(aEff)},
      hfa
    },
    provenance:{source:"ESPN completed game box scores",possessions:"FGA-ORB+TO+0.44*FTA",marketUsed:false}
  };
}

export async function attachWnbaV2Research(games=[],env={},date=null){
  const ctx=await loadWnbaV2Context(games,date,env);
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectWnbaV2(game,ctx);
    if(!p.ok){missing++;return {...game,wnbaV2:p};}
    projected++;
    const priorKind=String(game.projectionKind||game.model?.projectionKind||"").toUpperCase();
    const marketProjHome=priorKind.includes("IMPLIED")?(game.projHomeScore??game.model?.projHome??null):(game.marketProjHome??game.model?.marketProjHome??null);
    const marketProjAway=priorKind.includes("IMPLIED")?(game.projAwayScore??game.model?.projAway??null):(game.marketProjAway??game.model?.marketProjAway??null);
    return {
      ...game,wnbaV2:p,projHomeScore:p.home,projAwayScore:p.away,marketProjHome,marketProjAway,
      projectionKind:"FBIS",projectionEngine:WNBA_FBIS_V2_ID,projectionMaturity:"ACTIVE",
      projectionDisplayLabel:"WNBA FBIS V2 PROJECTION",pureProjectionAvailable:true,
      qualificationBlocked:false,canQualify:true,canAuthorizeWager:true,bettingAllowed:true,publicationStatus:"PUBLISHABLE",
      bettingAuthority:"ELIGIBLE",modelVersion:WNBA_FBIS_V2_VERSION,
      model:{...(game.model||{}),projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,pHomeFinal:p.pHomeWin,pHome:p.pHomeWin,
        projectionKind:"FBIS",marketProjHome,marketProjAway,maturity:"ACTIVE",canQualify:true,canAuthorize:true,canShowCalibratedEv:true,
        recipe:{engine:WNBA_FBIS_V2_ID,version:WNBA_FBIS_V2_VERSION,family:"production",steps:["recent completed box-score possessions","recency-weighted ORtg/DRtg/pace with shrinkage","opponent efficiency matchup","normal FBIS market qualification gates"]}},
      researchProjection:{modelId:WNBA_FBIS_V2_ID,modelVersion:WNBA_FBIS_V2_VERSION,maturity:"ACTIVE",home:p.home,away:p.away,margin:p.margin,total:p.total,
        note:"Independent possession/efficiency WNBA projection. No market input. Normal FBIS integrity gates apply.",canQualify:true,canAuthorize:true},
      challengers:{...(game.challengers||{}),[WNBA_FBIS_V2_ID]:p},
    };
  });
  return {games:next,meta:{modelId:WNBA_FBIS_V2_ID,version:WNBA_FBIS_V2_VERSION,projected,missing,context:ctx.meta,league:ctx.league,independent:true,marketInformed:false,canQualify:true,canAuthorize:true,maturity:"ACTIVE"}};
}
