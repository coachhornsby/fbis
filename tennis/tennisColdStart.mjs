// FBIS Tennis cold-start resolver.
// Historical profiles win. Off-index players require an observation-backed live profile.
// No adequate observations => explicit insufficient-data result; no synthetic neutral profile.
const finite=(v)=>Number.isFinite(Number(v))?Number(v):null;
const meanWeighted=(rows,valueKey,weightKey)=>{
  let n=0,d=0;
  for(const r of rows){const v=finite(r[valueKey]),w=Math.max(0,finite(r[weightKey])||0);if(v==null||!w)continue;n+=v*w;d+=w;}
  return d?n/d:null;
};
const sum=(rows,key)=>rows.reduce((s,r)=>s+(finite(r[key])||0),0);

export function buildObservedColdStartProfile(name, recentMatches, {surface='Hard',rank=null,liveSource='live'}={}){
  const rows=(recentMatches||[]).filter(r=>r&&r.date&&finite(r.svGms)>0);
  const sampleMatches=rows.length;
  const serveRows=rows.filter(r=>finite(r.servePtsWonPct)!=null);
  const returnRows=rows.filter(r=>finite(r.returnPtsWonPct)!=null&&finite(r.retGms)>0);
  const aceRows=rows.filter(r=>finite(r.aces)!=null);
  const dfRows=rows.filter(r=>finite(r.doubleFaults)!=null);
  const facedRows=rows.filter(r=>finite(r.acesFaced)!=null&&finite(r.retGms)>0);
  const adequate=sampleMatches>=5&&serveRows.length>=5&&returnRows.length>=3&&aceRows.length>=3&&dfRows.length>=3&&facedRows.length>=3;
  if(!adequate){
    return {player:null,coldStart:false,insufficient:true,reason:'INSUFFICIENT_PLAYER_DATA',
      diagnostics:{sampleMatches,serveRows:serveRows.length,returnRows:returnRows.length,aceRows:aceRows.length,dfRows:dfRows.length,acesFacedRows:facedRows.length}};
  }
  const svGms=sum(rows,'svGms'),retGms=sum(rows,'retGms');
  const acePerSvGm=svGms?sum(aceRows,'aces')/svGms:null;
  const dfPerSvGm=svGms?sum(dfRows,'doubleFaults')/svGms:null;
  const acesFacedPerRetGm=retGms?sum(facedRows,'acesFaced')/retGms:null;
  const servePtsWonPct=meanWeighted(serveRows,'servePtsWonPct','svGms');
  const retPtsWonPct=meanWeighted(returnRows,'returnPtsWonPct','retGms');
  const profile={n:sampleMatches,svGms,retGms,acePerSvGm,dfPerSvGm,servePtsWonPct,retPtsWonPct,
    acesFacedPerRetGm,winPct:null,raw:{observationBacked:true}};
  const lastDate=rows.map(r=>r.date).sort().at(-1)||null;
  return {player:{name,rank:rank??null,lastDate,surfaces:{ALL:profile,[surface]:{...profile}},
      recent:{lastDate,_source:liveSource},_coldStart:true,_sampleMatches:sampleMatches,_liveSource:liveSource,
      _projectionEligible:true},coldStart:true,insufficient:false,liveSource};
}

export async function resolveWithColdStart(source, known, rawName, ctx={}){
  if(known?.surfaces&&(known.surfaces.ALL?.n||0)>0)return {player:known,coldStart:false,insufficient:false};
  if(!source?.fetchRecentMatches)return {player:null,coldStart:false,insufficient:true,reason:'INSUFFICIENT_PLAYER_DATA'};
  const name=known?.name||rawName||'';
  let recent=[];
  try{recent=await source.fetchRecentMatches(name);}catch{return {player:null,coldStart:false,insufficient:true,reason:'INSUFFICIENT_PLAYER_DATA'};}
  return buildObservedColdStartProfile(name,recent,{surface:ctx.surface||'Hard',rank:known?.rank??ctx.rank??null,liveSource:ctx.liveSource||'live'});
}

export default {resolveWithColdStart,buildObservedColdStartProfile};
