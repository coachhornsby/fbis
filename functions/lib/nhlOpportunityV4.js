/**
 * NHL-OPPORTUNITY-v4 — live game-roster/scratch/deployment layer.
 *
 * Uses official NHL gamecenter rosterSpots + boxscore scratches when available.
 * It never uses market prices. It is bounded and fail-soft: missing gamecenter
 * data leaves the baseline projection unchanged.
 */
export const NHL_OPPORTUNITY_V4_ID="NHL-OPPORTUNITY-v4";
export const NHL_OPPORTUNITY_V4_VERSION="research-v4.0-scratch-role-redistribution";

const WEB="https://api-web.nhle.com/v1";
const CACHE=new Map();
const CACHE_MS=5*60*1000;
const DEFAULT_TIMEOUT_MS=1800;
const DEFAULT_TOTAL_BUDGET_MS=3200;

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=4){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**n;return Math.round(Number(v)*p)/p;}
function nameOf(p){const f=p?.firstName?.default||p?.firstName||"",l=p?.lastName?.default||p?.lastName||"";return String(p?.name?.default||p?.name||`${f} ${l}`).trim()||null;}
function timeoutFetcher(fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS){
  return async(url,options={})=>{
    const c=new AbortController(),t=setTimeout(()=>c.abort("nhl-opportunity-timeout"),timeoutMs);
    try{return await fetcher(url,{...options,signal:c.signal,headers:{accept:"application/json","user-agent":"FBIS-NHL-OPPORTUNITY-v4/1.0",...(options.headers||{})}});}
    finally{clearTimeout(t);}
  };
}
async function json(url,fetcher){const r=await fetcher(url);if(!r.ok)throw new Error("NHL_OPPORTUNITY_HTTP_"+r.status);return r.json();}
function officialGameFor(boardGame,schedule=[]){
  const home=String(boardGame?.home?.abbr||"").toUpperCase(),away=String(boardGame?.away?.abbr||"").toUpperCase();
  const target=Date.parse(boardGame?.start||"");
  const candidates=(schedule||[]).filter(g=>g.home===home&&g.away===away);
  if(!candidates.length)return null;
  if(!Number.isFinite(target))return candidates[0];
  return candidates.slice().sort((a,b)=>Math.abs(Date.parse(a.start||"")-target)-Math.abs(Date.parse(b.start||"")-target))[0]||null;
}
function scratchIds(box={}){
  const out=new Set();
  const s=box?.boxscore?.scratches??box?.scratches??{};
  const scan=v=>{
    if(!v)return;
    if(Array.isArray(v)){for(const x of v)scan(x);return;}
    if(typeof v!=="object")return;
    const id=v.playerId??v.id;if(id!=null)out.add(String(id));
    for(const x of Object.values(v))if(x&&typeof x==="object")scan(x);
  };
  scan(s);return out;
}
function rosterRows(pbp={}){
  return (pbp?.rosterSpots||[]).map(p=>({
    playerId:String(p.playerId||""),
    teamId:p.teamId==null?null:String(p.teamId),
    name:nameOf(p),
    position:String(p.positionCode||"").toUpperCase(),
  })).filter(p=>p.playerId);
}
function baselineRole(p={}){
  const shots=Math.max(0,finite(p.shotsPerGame)||0),points=Math.max(0,finite(p.pointsPerGame)||0);
  const toi=finite(p.toiPerGame);
  const pp=finite(p.powerPlayToiPerGame);
  return {
    shots,points,
    toi:toi!=null?toi:720+shots*80+points*90,
    pp:pp!=null?pp:Math.max(0,(points*.55+shots*.12)*90),
    weight:Math.max(.15,shots*.75+points*1.35+(String(p.position||"").toUpperCase()==="D"?.10:.20))
  };
}
function redistribution(teamSkaters=[],scratchSet=new Set(),activeSet=null){
  const skaters=(teamSkaters||[]).map(p=>({...p,_role:baselineRole(p)}));
  const scratched=skaters.filter(p=>scratchSet.has(String(p.id)));
  const active=skaters.filter(p=>!scratchSet.has(String(p.id))&&(!activeSet||activeSet.has(String(p.id))));
  const missingShot=scratched.reduce((s,p)=>s+p._role.shots,0);
  const missingPts=scratched.reduce((s,p)=>s+p._role.points,0);
  const missingToi=scratched.reduce((s,p)=>s+p._role.toi,0);
  const missingPp=scratched.reduce((s,p)=>s+p._role.pp,0);
  const denom=active.reduce((s,p)=>s+p._role.weight,0)||1;
  const inheritors={};
  for(const p of active){
    const share=p._role.weight/denom;
    const pos=String(p.position||"").toUpperCase();
    const positional=pos==="D"?.88:1.05;
    const toiBoost=clamp((missingToi*share*positional)/Math.max(600,p._role.toi),0,.22);
    const ppBoost=clamp((missingPp*share*positional)/Math.max(60,p._role.pp||60),0,.40);
    const shotBoost=clamp((missingShot*share*.72)/Math.max(.5,p._role.shots),0,.28);
    const pointBoost=clamp((missingPts*share*.70)/Math.max(.15,p._role.points),0,.30);
    inheritors[String(p.id)]={
      playerId:String(p.id),name:p.name||null,share:round(share),
      toiMultiplier:round(1+toiBoost),ppMultiplier:round(1+ppBoost),
      shotMultiplier:round(1+shotBoost),pointMultiplier:round(1+pointBoost),
      inheritedToiSeconds:round(missingToi*share,1),inheritedPpSeconds:round(missingPp*share,1)
    };
  }
  const lostOffense=scratched.reduce((s,p)=>s+p._role.points*.18+p._role.shots*.025,0);
  const recovered=clamp(.55+.25*(active.length/Math.max(1,skaters.length)),.50,.80);
  const goalAdjustment=-clamp(lostOffense*(1-recovered),0,.22);
  return {
    scratched:scratched.map(p=>({playerId:String(p.id),name:p.name||null,position:p.position||null,role:p._role})),
    activeCount:active.length,
    missing:{shots:round(missingShot),points:round(missingPts),toiSeconds:round(missingToi,1),ppSeconds:round(missingPp,1)},
    inheritors,
    goalAdjustment:round(goalAdjustment,3)
  };
}
export function buildNhlOpportunityGame(game,base,{pbp=null,box=null}={}){
  const official=officialGameFor(game,base?.schedule||[]);
  if(!official)return {available:false,reason:"official-game-id-unresolved",modelId:NHL_OPPORTUNITY_V4_ID};
  const roster=rosterRows(pbp||{}),scratches=scratchIds(box||{});
  const home=String(game?.home?.abbr||"").toUpperCase(),away=String(game?.away?.abbr||"").toUpperCase();
  const idsByTeam={};
  for(const tm of [home,away])idsByTeam[tm]=new Set();
  // rosterSpots has teamId but schedule context does not expose NHL team ids;
  // match roster ids back to known team skaters to avoid guessing team-id crosswalks.
  for(const tm of [home,away]){
    const known=new Set((base?.skatersByTeam?.[tm]||[]).map(p=>String(p.id)));
    for(const p of roster)if(known.has(p.playerId))idsByTeam[tm].add(p.playerId);
  }
  const homeR=redistribution(base?.skatersByTeam?.[home]||[],scratches,idsByTeam[home].size?idsByTeam[home]:null);
  const awayR=redistribution(base?.skatersByTeam?.[away]||[],scratches,idsByTeam[away].size?idsByTeam[away]:null);
  return {
    available:Boolean(roster.length||scratches.size),
    modelId:NHL_OPPORTUNITY_V4_ID,version:NHL_OPPORTUNITY_V4_VERSION,
    officialGameId:String(official.id),gameType:finite(official.gameType),source:"NHL_OFFICIAL_GAMECENTER",
    rosterCount:roster.length,scratchCount:scratches.size,
    home:{team:home,...homeR},away:{team:away,...awayR},
    marketInformed:false,researchOnly:true,canQualify:false,canAuthorizeWager:false
  };
}
export async function loadNhlOpportunitySnapshot(base,games=[],{fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS,totalBudgetMs=DEFAULT_TOTAL_BUDGET_MS}={}){
  const tf=timeoutFetcher(fetcher,timeoutMs);
  const jobs=(games||[]).map(async game=>{
    const official=officialGameFor(game,base?.schedule||[]);
    if(!official)return [String(game.id),buildNhlOpportunityGame(game,base,{})];
    const key=String(official.id),cached=CACHE.get(key);
    if(cached&&Date.now()-cached.at<CACHE_MS)return [String(game.id),cached.value];
    const [pbp,box]=await Promise.all([
      json(`${WEB}/gamecenter/${key}/play-by-play`,tf).catch(()=>null),
      json(`${WEB}/gamecenter/${key}/boxscore`,tf).catch(()=>null),
    ]);
    const value=buildNhlOpportunityGame(game,base,{pbp,box});
    CACHE.set(key,{at:Date.now(),value});
    return [String(game.id),value];
  });
  const result=await Promise.race([
    Promise.all(jobs),
    new Promise(resolve=>setTimeout(()=>resolve([]),totalBudgetMs))
  ]);
  const byGame=Object.fromEntries(result);
  const available=Object.values(byGame).filter(x=>x?.available).length;
  return {modelId:NHL_OPPORTUNITY_V4_ID,version:NHL_OPPORTUNITY_V4_VERSION,byGame,requested:(games||[]).length,available,coverage:(games||[]).length?round(available/(games||[]).length):0,researchOnly:true,marketInformed:false};
}
export function opportunityForGame(ctx,gameId){return ctx?.opportunity?.byGame?.[String(gameId)]||null;}
export function opportunityForPlayer(opportunity,side,playerId){
  const s=opportunity?.[side];if(!s)return null;
  if((s.scratched||[]).some(p=>String(p.playerId)===String(playerId)))return {scratched:true,active:false};
  return {scratched:false,active:true,...(s.inheritors?.[String(playerId)]||{})};
}
