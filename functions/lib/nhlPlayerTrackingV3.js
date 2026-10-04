/**
 * NHL player-level EDGE snapshot layer.
 *
 * Bounded live research feed only. Historical EDGE is not treated as point-in-time
 * evidence because the official API exposes season aggregates/current snapshots,
 * not frozen pregame snapshots. The loader caps player subrequests and times out
 * independently so it cannot kill the NHL board.
 */

export const NHL_PLAYER_TRACKING_V3_ID = "NHL-PLAYER-TRACKING-v3";
export const NHL_PLAYER_TRACKING_V3_VERSION = "research-v3.0-edge-bounded";

const WEB="https://api-web.nhle.com/v1";
const CACHE=new Map();
const CACHE_MS=15*60*1000;
const DEFAULT_PLAYER_CAP=28;
const DEFAULT_TIMEOUT_MS=1600;

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function round(v,n=4){if(v==null)return null;const p=10**n;return Math.round(Number(v)*p)/p;}
function timeoutFetcher(fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS){
  return async (url,options={})=>{
    const c=new AbortController(),t=setTimeout(()=>c.abort("nhl-player-edge-timeout"),timeoutMs);
    try{return await fetcher(url,{...options,signal:c.signal});}finally{clearTimeout(t);}
  };
}
async function json(url,fetcher){
  const r=await fetcher(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PLAYER-TRACKING-v3/1.0"}});
  if(!r.ok)throw new Error("NHL_PLAYER_EDGE_HTTP_"+r.status);
  return r.json();
}
function walkNumbers(raw){
  const out=[];
  function walk(v,path="",depth=0){
    if(v==null||depth>6)return;
    if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,24);i++)walk(v[i],path+"["+i+"]",depth+1);return;}
    if(typeof v!=="object")return;
    for(const [k,val] of Object.entries(v)){
      const p=path?path+"."+k:k;
      if(val&&typeof val==="object"){walk(val,p,depth+1);continue;}
      const n=finite(val);if(n!=null)out.push({path:p,key:String(k),value:n});
    }
  }
  walk(raw);return out;
}
function firstMetric(rows,patterns){
  for(const p of patterns){
    const r=rows.find(x=>p.test(x.key)||p.test(x.path));
    if(r)return r.value;
  }
  return null;
}
export function normalizeNhlPlayerEdge(raw){
  const rows=walkNumbers(raw);
  const m={
    maxSkatingSpeed:firstMetric(rows,[/max.*skating.*speed/i,/max.*speed/i]),
    bursts22Plus:firstMetric(rows,[/22.*burst/i,/burst.*22/i]),
    bursts20Plus:firstMetric(rows,[/20.*burst/i,/burst.*20/i]),
    totalDistance:firstMetric(rows,[/total.*distance/i,/distance.*total/i]),
    distancePer60:firstMetric(rows,[/distance.*per.?60/i,/per.?60.*distance/i]),
    maxShotSpeed:firstMetric(rows,[/max.*shot.*speed/i,/shot.*speed.*max/i]),
    avgShotSpeed:firstMetric(rows,[/avg.*shot.*speed/i,/average.*shot.*speed/i]),
    highDangerShots:firstMetric(rows,[/high.*danger.*shot/i,/shot.*high.*danger/i]),
    slotShots:firstMetric(rows,[/slot.*shot/i,/shot.*slot/i]),
    offensiveZonePct:firstMetric(rows,[/offensive.*zone.*pct/i,/oz.*pct/i]),
  };
  const present=Object.values(m).filter(v=>v!=null).length;
  return {...m,coverage:round(present/Object.keys(m).length),available:present>0};
}
function involvedTeams(games=[]){
  return new Set(games.flatMap(g=>[String(g?.home?.abbr||"").toUpperCase(),String(g?.away?.abbr||"").toUpperCase()]).filter(Boolean));
}
function candidatePlayers(base,games,cap){
  const teams=involvedTeams(games),all=[];
  for(const team of teams){
    for(const p of base?.skatersByTeam?.[team]||[]){
      const priority=(finite(p.shotsPerGame)||0)*1.25+(finite(p.pointsPerGame)||0)*1.5+(String(p.position||"").toUpperCase()==="D"?0.15:0);
      all.push({...p,team,_priority:priority});
    }
  }
  const seen=new Set();
  return all.sort((a,b)=>b._priority-a._priority).filter(p=>{
    const id=String(p.id||"");if(!id||seen.has(id))return false;seen.add(id);return true;
  }).slice(0,Math.max(1,cap));
}
export async function loadNhlPlayerEdgeSnapshot(base,games=[],{
  fetcher=fetch,
  playerCap=DEFAULT_PLAYER_CAP,
  timeoutMs=DEFAULT_TIMEOUT_MS,
}={}){
  const players=candidatePlayers(base,games,playerCap),now=Date.now(),tf=timeoutFetcher(fetcher,timeoutMs);
  const rows=await Promise.all(players.map(async p=>{
    const id=String(p.id),cached=CACHE.get(id);
    if(cached&&now-cached.at<CACHE_MS)return cached.value;
    let value;
    try{
      const raw=await json(`${WEB}/edge/skater-detail/${id}/now`,tf);
      value={playerId:id,playerName:p.name||null,team:p.team,position:p.position||null,source:"NHL_EDGE_SKATER_DETAIL",...normalizeNhlPlayerEdge(raw)};
    }catch(err){
      value={playerId:id,playerName:p.name||null,team:p.team,position:p.position||null,source:"NHL_EDGE_SKATER_DETAIL",available:false,coverage:0,error:String(err?.message||err)};
    }
    CACHE.set(id,{at:Date.now(),value});return value;
  }));
  const byPlayer=Object.fromEntries(rows.map(r=>[String(r.playerId),r]));
  const ok=rows.filter(r=>r.available).length;
  return {
    modelId:NHL_PLAYER_TRACKING_V3_ID,version:NHL_PLAYER_TRACKING_V3_VERSION,
    researchOnly:true,marketInformed:false,canQualify:false,canAuthorizeWager:false,
    requested:players.length,available:ok,coverage:players.length?round(ok/players.length):0,
    capped:players.length>=playerCap,byPlayer
  };
}

export function playerTrackingFor(ctx,playerId){
  return ctx?.playerEdge?.byPlayer?.[String(playerId)]||null;
}

export function aggregateNhlTrackingMatchup(team,opp,base,playerEdge){
  const aggregate=(abbr)=>{
    const ps=(base?.skatersByTeam?.[abbr]||[]).slice(0,8);
    let w=0,covered=0;
    const sums={maxSkatingSpeed:0,bursts22Plus:0,maxShotSpeed:0,highDangerShots:0,slotShots:0,offensiveZonePct:0};
    const weights={maxSkatingSpeed:0,bursts22Plus:0,maxShotSpeed:0,highDangerShots:0,slotShots:0,offensiveZonePct:0};
    for(const p of ps){
      const e=playerEdge?.byPlayer?.[String(p.id)];if(!e?.available)continue;
      const wt=Math.max(.25,(finite(p.shotsPerGame)||0)+(finite(p.pointsPerGame)||0));w+=wt;covered++;
      for(const k of Object.keys(sums)){const v=finite(e[k]);if(v!=null){sums[k]+=v*wt;weights[k]+=wt;}}
    }
    const metrics=Object.fromEntries(Object.keys(sums).map(k=>[k,weights[k]?round(sums[k]/weights[k]):null]));
    return {...metrics,players:ps.length,covered,coverage:ps.length?round(covered/ps.length):0};
  };
  const a=aggregate(team),b=aggregate(opp);
  const diff=(k)=>a[k]!=null&&b[k]!=null?round(a[k]-b[k]):null;
  return {team:a,opponent:b,differential:{
    maxSkatingSpeed:diff("maxSkatingSpeed"),bursts22Plus:diff("bursts22Plus"),maxShotSpeed:diff("maxShotSpeed"),
    highDangerShots:diff("highDangerShots"),slotShots:diff("slotShots"),offensiveZonePct:diff("offensiveZonePct")
  },researchOnly:true};
}
