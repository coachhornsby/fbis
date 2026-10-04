import { pGreater } from "./metrics.js";
export const NBA_PROP_MODEL_ID="NBA-PLAYER-PROP-v1";
export const NBA_PROP_MODEL_VERSION="research-v1";
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
function weighted(rows,key,halfLife=6){
  let n=0,d=0;const xs=[...(rows||[])].sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));
  xs.forEach((r,i)=>{const v=finite(r[key]);if(v==null)return;const w=Math.pow(.5,i/halfLife);n+=v*w;d+=w;});return d?n/d:null;
}
function sampleSd(rows,key){
  const xs=(rows||[]).map(r=>finite(r[key])).filter(v=>v!=null);if(xs.length<2)return null;
  const m=xs.reduce((a,b)=>a+b,0)/xs.length;return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
}
function statusMinutesFactor(status){
  const s=String(status||"AVAILABLE").toUpperCase();
  if(s==="OUT")return 0;if(s==="DOUBTFUL")return .25;if(s==="QUESTIONABLE")return .72;if(s==="PROBABLE")return .94;return 1;
}
export function projectNbaPlayer(player,{history=[],teamProjection=null,teamBaseline=114.5,gamePossessions=99.5,teamBaselinePossessions=99.5,status="AVAILABLE"}={}){
  const rows=(history||[]).filter(r=>finite(r.minutes)!=null&&finite(r.minutes)>0);
  if(!player?.id&&!player?.name)return {ok:false,reason:"player-identity-missing"};
  if(!rows.length)return {ok:false,reason:"player-history-missing",playerId:player.id||null,playerName:player.name||null};
  const recentMin=weighted(rows,"minutes"),starts=weighted(rows,"starter");
  const minutes=clamp((recentMin??24)*(0.94+0.06*(starts??0))*statusMinutesFactor(status),0,40);
  const envScore=teamProjection==null?1:clamp(teamProjection/teamBaseline,.86,1.16);
  const envPace=clamp(gamePossessions/teamBaselinePossessions,.90,1.10);
  const markets={};
  const defs=[
    ["points","points",6.2],["rebounds","rebounds",3.4],["assists","assists",2.9],["three_pointers_made","threes",1.35]
  ];
  for(const [market,key,priorSigma] of defs){
    const perMin=weighted(rows,key)/Math.max(weighted(rows,"minutes")||minutes,1);
    if(!Number.isFinite(perMin))continue;
    let projection=perMin*minutes;
    if(market==="points"||market==="three_pointers_made")projection*=.55*envScore+.45*envPace;
    else projection*=.25*envScore+.75*envPace;
    const empirical=sampleSd(rows,key);
    const sigma=clamp((empirical??priorSigma)*(rows.length/(rows.length+8))+priorSigma*(8/(rows.length+8)),priorSigma*.7,priorSigma*1.8);
    markets[market]={projection:round1(projection),sigma:round1(sigma)};
  }
  if(markets.points&&markets.rebounds&&markets.assists){
    const projection=markets.points.projection+markets.rebounds.projection+markets.assists.projection;
    const sigma=Math.sqrt(markets.points.sigma**2+markets.rebounds.sigma**2+markets.assists.sigma**2);
    markets.pra={projection:round1(projection),sigma:round1(sigma)};
  }
  return {ok:true,modelId:NBA_PROP_MODEL_ID,modelVersion:NBA_PROP_MODEL_VERSION,playerId:player.id||null,playerName:player.name||null,
    minutes:round1(minutes),status,markets,independent:true,marketInformed:false,maturity:"RESEARCH",canQualify:false,canAuthorize:false,
    provenance:{games:rows.length,marketUsed:false}};
}
export function compareNbaProp(projection,market,line){
  const p=projection?.markets?.[market]; if(!p||finite(line)==null)return {ok:false,reason:"projection-or-line-missing"};
  const over=pGreater(p.projection,line,p.sigma),under=over==null?null:1-over;
  return {ok:true,market,line:Number(line),fbisProjection:p.projection,sigma:p.sigma,difference:round1(p.projection-Number(line)),
    probabilityOver:over,probabilityUnder:under,candidateSide:over==null?null:(over>=under?"MORE":"LESS"),
    projectionUnchanged:true,decisionEligible:false,reason:"NBA_PLAYER_PROP_MODEL_RESEARCH_ONLY"};
}
export function buildPlayerHistories(boxGames=[]){
  const map=new Map();
  for(const g of boxGames||[])for(const p of g.players||[]){
    const id=String(p.id||p.playerId||p.name||""); if(!id)continue;
    if(!map.has(id))map.set(id,[]);
    map.get(id).push({...p,date:g.date||g.start,gameId:g.id});
  }
  return map;
}
