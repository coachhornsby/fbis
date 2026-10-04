/**
 * nflverse feature feed for NFL-PRO.
 *
 * Free public data only. Market prices are never projection inputs.
 * Current-season evidence is shrunk toward the prior season so early-season
 * samples do not masquerade as stable signal.
 *
 * v2 additions:
 * - Next Gen passing/rushing/receiving
 * - snap counts / snap share
 * - player-level tracking + usage attached to NFL player projections
 */
import { readCache, writeCache } from "./cache.js";

const TTL_MS = 3 * 60 * 60 * 1000;
const ERR_TTL_MS = 20 * 60 * 1000;
const PRIOR_GAMES = 8;
const PLAYER_PRIOR_GAMES = 4;
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";
const SNAPSHOT_KEY = "nfl/features/latest.json";
const SNAPSHOT_SCHEMA = "nflverse-features-v2";

const ABBR = {
  JAC:"JAX",JAX:"JAX",LA:"LAR",LAR:"LAR",LV:"LV",OAK:"LV",
  WAS:"WAS",WSH:"WAS",SD:"LAC",LAC:"LAC",STL:"LAR"
};

function canon(v){ const s=String(v||"").trim().toUpperCase(); return ABBR[s]||s; }
function num(v){ if(v==null||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function pick(row,...keys){ for(const k of keys){ const v=row?.[k]; if(v!=null&&v!=="") return v; } return null; }
function pickNum(row,...keys){ return num(pick(row,...keys)); }
function normName(v){ return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }

function seasonYear(date=new Date()){
  const iso=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit"}).format(date);
  const y=Number(iso.slice(0,4)),m=Number(iso.slice(5,7)); return m>=8?y:y-1;
}
function splitCsvLine(line){
  const out=[]; let cur="",quoted=false;
  for(let i=0;i<line.length;i++){ const ch=line[i];
    if(ch==='"'){ if(quoted&&line[i+1]==='"'){cur+='"';i+=1;} else quoted=!quoted; }
    else if(ch===","&&!quoted){out.push(cur);cur="";} else cur+=ch;
  }
  out.push(cur); return out;
}
export function parseCsv(text=""){
  const lines=String(text).replace(/^\uFEFF/,"").trim().split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return[];
  const headers=splitCsvLine(lines[0]);
  return lines.slice(1).map(line=>{const cells=splitCsvLine(line);return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??""]));});
}
async function fetchCsv(url,fetchFn=fetch){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("source-timeout"), 25000);
  let res;
  try {
    res=await fetchFn(url,{headers:{Accept:"text/csv,application/gzip,*/*","User-Agent":"FBIS/2.0"},signal:controller.signal});
  } finally {
    clearTimeout(timer);
  }
  if(!res.ok)return{ok:false,status:res.status,rows:[],url};
  let text;
  if (/\.gz(?:$|\?)/i.test(url)) {
    if (typeof DecompressionStream === "undefined" || !res.body) {
      return {ok:false,status:415,rows:[],url,error:"gzip_decompression_unavailable"};
    }
    text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  } else {
    text = await res.text();
  }
  return{ok:true,status:res.status,rows:parseCsv(text),url};
}
function teamUrl(y){return `${RELEASE}/stats_team/stats_team_week_${y}.csv`;}
function playerUrl(y){return `${RELEASE}/stats_player/stats_player_week_${y}.csv`;}
function ngsUrl(type){return `${RELEASE}/nextgen_stats/ngs_${type}.csv.gz`;}
function snapUrl(y){return `${RELEASE}/snap_counts/snap_counts_${y}.csv`;}

function mean(xs=[]){const v=xs.map(num).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function sd(xs=[]){const v=xs.map(num).filter(x=>x!=null);if(v.length<2)return null;const m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1));}
function blend(prior,current,n,priorGames=PRIOR_GAMES){
  const p=num(prior),c=num(current); if(p==null)return c;if(c==null)return p;
  const w=Math.max(0,Number(n)||0)/(Math.max(0,Number(n)||0)+priorGames); return p*(1-w)+c*w;
}

function addAgg(map,key,values={}){
  if(!key)return;
  const out=map[key]||(map[key]={games:new Set(),passEpa:0,passPlays:0,rushEpa:0,rushPlays:0,qbHits:0,sacks:0,oppDropbacks:0});
  if(values.gameKey)out.games.add(values.gameKey);
  for(const k of ["passEpa","passPlays","rushEpa","rushPlays","qbHits","sacks","oppDropbacks"])out[k]+=values[k]||0;
}
export function aggregateTeamWeeks(rows=[]){
  const offense={},defense={},byGame=new Map();
  for(const row of rows){
    if(String(row.season_type||"REG").toUpperCase()!=="REG")continue;
    const team=canon(row.team),opp=canon(row.opponent_team),week=num(row.week); if(!team||!opp||week==null)continue;
    const attempts=num(row.attempts)||0,sacks=num(row.sacks_suffered)||0,carries=num(row.carries)||0;
    const vals={gameKey:`${week}:${team}:${opp}`,passEpa:num(row.passing_epa)||0,passPlays:attempts+sacks,rushEpa:num(row.rushing_epa)||0,rushPlays:carries,qbHits:num(row.def_qb_hits)||0,sacks:num(row.def_sacks)||0};
    addAgg(offense,team,vals);byGame.set(`${week}:${team}`,{team,opp,...vals});
  }
  for(const g of byGame.values()){
    const ownOpp=byGame.get(`${String(g.gameKey).split(":")[0]}:${g.opp}`);
    addAgg(defense,g.opp,{gameKey:g.gameKey,passEpa:g.passEpa,passPlays:g.passPlays,rushEpa:g.rushEpa,rushPlays:g.rushPlays,qbHits:ownOpp?.qbHits||0,sacks:ownOpp?.sacks||0,oppDropbacks:g.passPlays});
  }
  const finish=(src,def=false)=>Object.fromEntries(Object.entries(src).map(([team,a])=>{
    const pass=a.passPlays?a.passEpa/a.passPlays:null,rush=a.rushPlays?a.rushEpa/a.rushPlays:null,plays=a.passPlays+a.rushPlays,total=plays?(a.passEpa+a.rushEpa)/plays:null;
    return[team,{games:a.games.size,...(def?{defenseEpa:total,passEpaAllowed:pass,rushEpaAllowed:rush}:{offenseEpa:total,passEpa:pass,rushEpa:rush}),...(def?{pressureRate:a.oppDropbacks?a.qbHits/a.oppDropbacks:null}:{pressureRateAllowed:null})}];
  }));
  return{offense:finish(offense),defense:finish(defense,true)};
}

export function aggregatePlayerWeeks(rows=[]){
  const byKey=new Map(),fields=["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds"];
  for(const row of rows){
    if(String(row.season_type||"REG").toUpperCase()!=="REG")continue;
    const team=canon(row.team),id=String(row.player_id||row.player_id_name||row.player_name||"").trim();if(!team||!id)continue;
    const key=team+"|"+id;
    if(!byKey.has(key))byKey.set(key,{id,name:row.player_display_name||row.player_name||row.player_name_short||id,position:String(row.position||row.position_group||"").toUpperCase(),team,appearances:0,values:Object.fromEntries(fields.map(f=>[f,[]])),recentGames:[]});
    const p=byKey.get(key);p.appearances+=1;
    const game={season:num(row.season)||0,week:num(row.week)||0,opponent:canon(row.opponent_team),stats:{}};
    for(const f of fields){const v=num(row[f])||0;p.values[f].push(v);game.stats[f]=v;}
    game.stats.total_tds=(game.stats.rushing_tds||0)+(game.stats.receiving_tds||0);
    p.recentGames.push(game);
  }
  const byTeam={};
  for(const p of byKey.values()){
    const out={id:p.id,name:p.name,position:p.position,team:p.team,games:p.appearances,sd:{},recentGames:p.recentGames.sort((a,b)=>(b.season-a.season)||(b.week-a.week)).slice(0,8)};
    for(const [f,v] of Object.entries(p.values)){out[f]=mean(v);out.sd[f]=sd(v);}
    out.total_tds=(out.rushing_tds||0)+(out.receiving_tds||0);
    out.sd.total_tds=sd(p.values.rushing_tds.map((x,i)=>(x||0)+(p.values.receiving_tds[i]||0)));
    (byTeam[p.team]||(byTeam[p.team]=[])).push(out);
  }
  for(const team of Object.keys(byTeam))byTeam[team]=byTeam[team].filter(p=>["QB","RB","WR","TE"].includes(p.position)).sort((a,b)=>((b.attempts||0)+(b.carries||0)+(b.targets||0))-((a.attempts||0)+(a.carries||0)+(a.targets||0))).slice(0,16);
  return byTeam;
}

export function aggregatePositionDefense(rows=[]){
  const fields=["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds"];
  const gamePos=new Map();
  for(const row of rows){
    if(String(row.season_type||"REG").toUpperCase()!=="REG")continue;
    const defense=canon(row.opponent_team),position=String(row.position||row.position_group||"").toUpperCase(),week=num(row.week),season=num(row.season);
    if(!defense||!["QB","RB","WR","TE"].includes(position)||week==null)continue;
    const k=`${defense}|${season||0}|${week}|${position}`;
    const g=gamePos.get(k)||{defense,position,season:season||0,week,stats:Object.fromEntries(fields.map(f=>[f,0]))};
    for(const f of fields)g.stats[f]+=num(row[f])||0;
    gamePos.set(k,g);
  }
  const byTeam={};
  for(const g of gamePos.values()){
    const t=byTeam[g.defense]||(byTeam[g.defense]={});
    const p=t[g.position]||(t[g.position]={games:0,values:Object.fromEntries(fields.map(f=>[f,[]]))});
    p.games+=1;for(const f of fields)p.values[f].push(g.stats[f]||0);
  }
  return Object.fromEntries(Object.entries(byTeam).map(([team,positions])=>[team,Object.fromEntries(Object.entries(positions).map(([position,p])=>{
    const out={games:p.games};
    for(const [f,vals] of Object.entries(p.values))out[f]=mean(vals);
    out.total_tds=(out.rushing_tds||0)+(out.receiving_tds||0);
    return[position,out];
  }))]));
}

export function aggregateQbWeeks(rows=[]){
  const byTeam={};
  for(const row of rows){
    if(String(row.season_type||"REG").toUpperCase()!=="REG")continue;
    const team=canon(row.team);if(!team)continue;
    const attempts=num(row.attempts)||0,sacks=num(row.sacks_suffered)||0;if(attempts<5)continue;
    const dropbacks=attempts+sacks,q=byTeam[team]||(byTeam[team]={epa:0,dropbacks:0,cpoeNumerator:0,cpoeWeight:0,sacks:0,games:new Set()});
    q.epa+=num(row.passing_epa)||0;q.dropbacks+=dropbacks;
    const cpoe=num(row.passing_cpoe);if(cpoe!=null){q.cpoeNumerator+=cpoe*attempts;q.cpoeWeight+=attempts;}
    q.sacks+=sacks;q.games.add(`${row.week}:${team}`);
  }
  return Object.fromEntries(Object.entries(byTeam).map(([team,q])=>[team,{games:q.games.size,qbEpa:q.dropbacks?q.epa/q.dropbacks:null,qbCpoe:q.cpoeWeight?q.cpoeNumerator/q.cpoeWeight:null,qbSackRate:q.dropbacks?q.sacks/q.dropbacks:null}]));
}

function ngsPlayerKey(row){
  return String(pick(row,"player_gsis_id","player_id","gsis_id","playerId","player_name","player_display_name")||"").trim();
}
function ngsTeam(row){return canon(pick(row,"team_abbr","team","teamAbbr","club_code"));}
function ngsSeason(row){return pickNum(row,"season","season_year","seasonYear");}
function ngsWeek(row){return pickNum(row,"week","week_number","weekNumber");}
function ngsName(row){return pick(row,"player_display_name","player_name","playerName")||ngsPlayerKey(row);}

function pushMetric(p,key,value,weight=null){
  const v=num(value); if(v==null)return;
  const w=num(weight);
  const arr=p.ngsSeries[key]||(p.ngsSeries[key]=[]);
  arr.push({value:v,weight:w!=null&&w>0?w:1});
}
function finishMetric(p,key){
  const arr=p.ngsSeries?.[key]||[]; if(!arr.length)return null;
  const total=arr.reduce((s,x)=>s+x.weight,0);
  return total>0?arr.reduce((s,x)=>s+x.value*x.weight,0)/total:mean(arr.map(x=>x.value));
}
export function aggregateNextGen(rowsByType={},season=null){
  const players=new Map();
  const teamRows={};
  for(const [type,rows] of Object.entries(rowsByType||{})){
    for(const row of rows||[]){
      if(season!=null&&ngsSeason(row)!=null&&ngsSeason(row)!==Number(season))continue;
      const team=ngsTeam(row),id=ngsPlayerKey(row),week=ngsWeek(row);
      // week=0 is the full-season summary in nflverse NGS; using it during
      // the season would leak future games and double count weekly evidence.
      if(!team||!id||week==null||week<=0)continue;
      const key=team+"|"+id,p=players.get(key)||{id,name:ngsName(row),team,position:type==="passing"?"QB":type==="rushing"?"RB":"WR",ngs:{},ngsSeries:{},games:new Set()};
      p.games.add(week);
      if(type==="passing"){
        const attempts=pickNum(row,"attempts","pass_attempts");
        pushMetric(p,"avgTimeToThrow",pickNum(row,"avg_time_to_throw","avgTimeToThrow"),attempts);
        pushMetric(p,"aggressiveness",pickNum(row,"aggressiveness"),attempts);
        pushMetric(p,"cpoe",pickNum(row,"completion_percentage_above_expectation","completionPercentageAboveExpectation","cpoe"),attempts);
        pushMetric(p,"passerRating",pickNum(row,"passer_rating","passerRating"),attempts);
      }else if(type==="rushing"){
        const carries=pickNum(row,"attempts","carries","rush_attempts");
        pushMetric(p,"ryoePerAtt",pickNum(row,"rush_yards_over_expected_per_att","rushYardsOverExpectedPerAtt","ryoe_per_att"),carries);
        pushMetric(p,"rushEfficiency",pickNum(row,"efficiency","rush_efficiency"),carries);
        pushMetric(p,"avgTimeToLos",pickNum(row,"avg_time_to_los","avgTimeToLos"),carries);
      }else{
        const targets=pickNum(row,"targets");
        pushMetric(p,"avgSeparation",pickNum(row,"avg_separation","avgSeparation"),targets);
        pushMetric(p,"avgCushion",pickNum(row,"avg_cushion","avgCushion"),targets);
        pushMetric(p,"avgIntendedAirYards",pickNum(row,"avg_intended_air_yards","avgIntendedAirYards"),targets);
        const ay=pickNum(row,"avg_yac","avgYac"),ey=pickNum(row,"avg_expected_yac","avgExpectedYac");
        pushMetric(p,"yacOverExpected",pickNum(row,"avg_yac_above_expectation","avgYacAboveExpectation") ?? (ay!=null&&ey!=null?ay-ey:null),targets);
        pushMetric(p,"catchPct",pickNum(row,"catch_percentage","catchPercentage"),targets);
      }
      players.set(key,p);
      (teamRows[team]||(teamRows[team]=[])).push(p);
    }
  }
  const byTeam={};
  for(const p of players.values()){
    p.games=p.games.size;
    for(const key of ["avgTimeToThrow","aggressiveness","cpoe","passerRating","ryoePerAtt","rushEfficiency","avgTimeToLos","avgSeparation","avgCushion","avgIntendedAirYards","yacOverExpected","catchPct"]){
      p.ngs[key]=finishMetric(p,key);
    }
    delete p.ngsSeries;
    (byTeam[p.team]||(byTeam[p.team]=[])).push(p);
  }
  const teamFeatures={};
  for(const [team,arr] of Object.entries(byTeam)){
    const qbs=arr.filter(p=>p.position==="QB"),rush=arr.filter(p=>p.ngs.ryoePerAtt!=null),recv=arr.filter(p=>p.ngs.avgSeparation!=null);
    teamFeatures[team]={
      ngsGames:Math.max(0,...arr.map(p=>p.games||0)),
      qbNgsCpoe:mean(qbs.map(p=>p.ngs.cpoe)),
      qbTimeToThrow:mean(qbs.map(p=>p.ngs.avgTimeToThrow)),
      qbAggressiveness:mean(qbs.map(p=>p.ngs.aggressiveness)),
      rushYoePerAtt:mean(rush.map(p=>p.ngs.ryoePerAtt)),
      rushEfficiency:mean(rush.map(p=>p.ngs.rushEfficiency)),
      receivingSeparation:mean(recv.map(p=>p.ngs.avgSeparation)),
      receivingYacOe:mean(recv.map(p=>p.ngs.yacOverExpected)),
    };
  }
  return{byTeam,teamFeatures};
}

export function aggregateSnapCounts(rows=[],season=null){
  const byTeam={};
  for(const row of rows){
    if(season!=null&&pickNum(row,"season")!=null&&pickNum(row,"season")!==Number(season))continue;
    const team=canon(pick(row,"team","team_abbr","teamAbbr")),id=String(pick(row,"player_id","pfr_player_id","gsis_id","player","player_name")||"").trim();
    if(!team||!id)continue;
    const name=pick(row,"player","player_name","player_display_name")||id;
    const key=team+"|"+id;
    const arr=byTeam[team]||(byTeam[team]=new Map());
    const p=arr.get(key)||{id,name,team,offensePct:[],offenseSnaps:[],weeks:new Set()};
    const pct=pickNum(row,"offense_pct","offense_percent","offense_percentage","off_pct");
    p.offensePct.push(pct!=null&&pct>1?pct/100:pct);
    p.offenseSnaps.push(pickNum(row,"offense_snaps","offensive_snaps","off_snaps"));
    const w=pickNum(row,"week");if(w!=null)p.weeks.add(w);arr.set(key,p);
  }
  return Object.fromEntries(Object.entries(byTeam).map(([team,map])=>[team,[...map.values()].map(p=>({id:p.id,name:p.name,team:p.team,games:p.weeks.size,snapShare:mean(p.offensePct),offenseSnaps:mean(p.offenseSnaps)}))]));
}

function playerJoinKey(p){return String(p?.id||"").trim()||normName(p?.name);}
function enrichPlayers(base={},ngs={},snaps={}){
  const teams=new Set([...Object.keys(base),...Object.keys(ngs),...Object.keys(snaps)]),out={};
  for(const team of teams){
    const nMap=new Map((ngs[team]||[]).map(p=>[playerJoinKey(p),p]));
    const nName=new Map((ngs[team]||[]).map(p=>[normName(p.name),p]));
    const sMap=new Map((snaps[team]||[]).map(p=>[playerJoinKey(p),p]));
    const sName=new Map((snaps[team]||[]).map(p=>[normName(p.name),p]));
    out[team]=(base[team]||[]).map(p=>{
      const key=playerJoinKey(p),name=normName(p.name),n=nMap.get(key)||nName.get(name),s=sMap.get(key)||sName.get(name);
      return{...p,ngs:n?.ngs||null,snapShare:s?.snapShare??null,offenseSnaps:s?.offenseSnaps??null,trackingGames:n?.games||0,snapGames:s?.games||0};
    });
  }
  return out;
}

function recentWeightedMean(games=[],field){
  const weights=[0.35,0.25,0.18,0.13,0.09];
  let nume=0,den=0;
  for(let i=0;i<Math.min(5,games.length);i++){
    const v=num(games[i]?.stats?.[field]);if(v==null)continue;
    const w=weights[i];nume+=v*w;den+=w;
  }
  return den>0?nume/den:null;
}
function weightedParts(parts=[]){
  let n=0,d=0;for(const [v,w] of parts){const x=num(v);if(x==null)continue;n+=x*w;d+=w;}return d>0?n/d:null;
}
function blendPlayerRows(priorByTeam={},currentByTeam={}){
  const teams=new Set([...Object.keys(priorByTeam),...Object.keys(currentByTeam)]),out={};
  for(const team of teams){
    const priorMap=new Map((priorByTeam[team]||[]).map(p=>[p.id,p])),current=currentByTeam[team]||[],currentMap=new Map(current.map(p=>[p.id,p])),ids=new Set([...priorMap.keys(),...currentMap.keys()]);
    out[team]=[...ids].map(id=>{
      const p=priorMap.get(id)||{},q=currentMap.get(id)||{},n=Number(q.games||0);
      const recentGames=[...(q.recentGames||[]),...(p.recentGames||[])].sort((a,b)=>(b.season-a.season)||(b.week-a.week)).slice(0,5);
      const row={id,name:q.name||p.name||id,position:q.position||p.position||"",team,games:n,source:"nflverse-player-v3",sd:{},recent5:{games:recentGames.length},recentGames};
      for(const f of ["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","total_tds"]){
        const recent=recentWeightedMean(recentGames,f);
        row.recent5[f]=recent;
        row[f]=weightedParts([[recent,0.65],[q[f],0.25],[p[f],0.10]]);
        const recentSd=sd(recentGames.map(g=>g?.stats?.[f]));
        const histSd=blend(p.sd?.[f],q.sd?.[f],n,PLAYER_PRIOR_GAMES);
        row.sd[f]=weightedParts([[recentSd,0.60],[histSd,0.40]]) ?? histSd ?? recentSd;
      }
      row.seasonAvg=Object.fromEntries(["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","total_tds"].map(f=>[f,num(q[f])]));
      row.priorAvg=Object.fromEntries(["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","total_tds"].map(f=>[f,num(p[f])]));
      row.snapShare=blend(p.snapShare,q.snapShare,q.snapGames||n,PLAYER_PRIOR_GAMES);
      row.offenseSnaps=blend(p.offenseSnaps,q.offenseSnaps,q.snapGames||n,PLAYER_PRIOR_GAMES);
      row.ngs={};
      for(const f of ["avgTimeToThrow","aggressiveness","cpoe","passerRating","ryoePerAtt","rushEfficiency","avgTimeToLos","avgSeparation","avgCushion","avgIntendedAirYards","yacOverExpected","catchPct"]){
        row.ngs[f]=blend(p.ngs?.[f],q.ngs?.[f],q.trackingGames||n,PLAYER_PRIOR_GAMES);
      }
      row.trackingGames=Number(q.trackingGames||0);
      row.snapGames=Number(q.snapGames||0);
      return row;
    }).filter(p=>["QB","RB","WR","TE"].includes(p.position)).sort((a,b)=>((b.snapShare??0)-(a.snapShare??0))||(((b.attempts||0)+(b.carries||0)+(b.targets||0))-((a.attempts||0)+(a.carries||0)+(a.targets||0)))).slice(0,16);
  }
  return out;
}

function combineTeam(prior={},current={}){
  const n=current.games||0,fields=["offenseEpa","defenseEpa","passEpa","passEpaAllowed","rushEpa","rushEpaAllowed","pressureRate"];
  const out={games:n,priorGames:PRIOR_GAMES,source:"nflverse-team-v2"};for(const f of fields)out[f]=blend(prior[f],current[f],n);return out;
}
function combineQb(prior={},current={}){
  const n=current.games||0;return{games:n,qbEpa:blend(prior.qbEpa,current.qbEpa,n),qbCpoe:blend(prior.qbCpoe,current.qbCpoe,n),qbSackRate:blend(prior.qbSackRate,current.qbSackRate,n),qbPrior:prior.qbEpa,source:"nflverse-player-v2"};
}
function combineTracking(prior={},current={}){
  const n=current.ngsGames||0,out={trackingGames:n,trackingSource:"nflverse-nextgen"};
  for(const f of ["qbNgsCpoe","qbTimeToThrow","qbAggressiveness","rushYoePerAtt","rushEfficiency","receivingSeparation","receivingYacOe"])out[f]=blend(prior[f],current[f],n,PLAYER_PRIOR_GAMES);
  return out;
}

async function seasonBundle(year,fetchFn,ngsAll){
  const [team,player,snaps]=await Promise.all([fetchCsv(teamUrl(year),fetchFn),fetchCsv(playerUrl(year),fetchFn),fetchCsv(snapUrl(year),fetchFn)]);
  const teamAgg=aggregateTeamWeeks(team.rows),ngs=aggregateNextGen(ngsAll,year),snapByTeam=aggregateSnapCounts(snaps.rows,year);
  return{year,teamStatus:team.status,playerStatus:player.status,snapStatus:snaps.status,offense:teamAgg.offense,defense:teamAgg.defense,qb:aggregateQbWeeks(player.rows),tracking:ngs.teamFeatures,positionDefense:aggregatePositionDefense(player.rows),playersByTeam:enrichPlayers(aggregatePlayerWeeks(player.rows),ngs.byTeam,snapByTeam),rows:{team:team.rows.length,player:player.rows.length,snaps:snaps.rows.length}};
}

async function readArchivedSnapshot(env={}, season, now){
  if(!env.ARCHIVE?.get) return null;
  try{
    const obj=await env.ARCHIVE.get(SNAPSHOT_KEY);
    if(!obj) return null;
    const payload=JSON.parse(await obj.text());
    if(!payload?.meta || !payload?.byTeam || !payload?.playersByTeam) return null;
    const builtAt=Date.parse(payload.meta.builtAt||payload.meta.createdAt||"");
    const ageMs=Number.isFinite(builtAt)?Math.max(0,now-builtAt):null;
    return {
      ...payload,
      meta:{
        ...payload.meta,
        snapshotKey:SNAPSHOT_KEY,
        snapshotSchema:payload.meta.snapshotSchema||SNAPSHOT_SCHEMA,
        runtimeSource:"r2-precomputed",
        snapshotAgeHours:ageMs==null?null:Math.round((ageMs/3600000)*10)/10,
        stale:ageMs!=null?ageMs>36*3600000:false,
        requestedSeason:season,
      },
    };
  }catch{return null;}
}

export async function loadNflVerseFeatures(env={}, {fetchFn=fetch,now=Date.now(),forceNetwork=false}={}){
  const season=seasonYear(new Date(now)),cacheKey=`nflverse-features-v2-${season}`,cached=await readCache(cacheKey,env.caches,TTL_MS);if(cached?.meta)return cached;
  if(!forceNetwork){
    const archived=await readArchivedSnapshot(env,season,now);
    if(archived){
      await writeCache(cacheKey,archived,env.caches,TTL_MS);
      return archived;
    }
    return {
      season,
      byTeam:{},
      playersByTeam:{},
      meta:{
        source:"nflverse+ngs",
        teams:0,
        marketInformed:false,
        runtimeSource:"snapshot-missing",
        runtimeNetworkDisabled:true,
        error:"NFL feature snapshot unavailable; live request fanout disabled to protect board latency.",
      },
    };
  }
  try{
    const [ngsPassing,ngsRushing,ngsReceiving]=await Promise.all([fetchCsv(ngsUrl("passing"),fetchFn),fetchCsv(ngsUrl("rushing"),fetchFn),fetchCsv(ngsUrl("receiving"),fetchFn)]);
    const ngsAll={passing:ngsPassing.rows,rushing:ngsRushing.rows,receiving:ngsReceiving.rows};
    const [current,prior]=await Promise.all([seasonBundle(season,fetchFn,ngsAll),seasonBundle(season-1,fetchFn,ngsAll)]);
    const teams=new Set([...Object.keys(prior.offense),...Object.keys(prior.defense),...Object.keys(prior.qb),...Object.keys(prior.tracking),...Object.keys(current.offense),...Object.keys(current.defense),...Object.keys(current.qb),...Object.keys(current.tracking)]);
    const byTeam={};
    for(const team of teams){
      const positionDefense={};
      for(const pos of ["QB","RB","WR","TE"]){
        const a=prior.positionDefense?.[team]?.[pos]||{},b=current.positionDefense?.[team]?.[pos]||{},n=Number(b.games||0);
        const out={games:n};
        for(const f of ["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","total_tds"])out[f]=blend(a[f],b[f],n,PRIOR_GAMES);
        positionDefense[pos]=out;
      }
      byTeam[team]={...combineTeam({...(prior.offense[team]||{}),...(prior.defense[team]||{})},{...(current.offense[team]||{}),...(current.defense[team]||{})}),...combineQb(prior.qb[team]||{},current.qb[team]||{}),...combineTracking(prior.tracking[team]||{},current.tracking[team]||{}),positionDefense};
    }
    const leaguePositionDefense={};
    for(const pos of ["QB","RB","WR","TE"]){
      leaguePositionDefense[pos]={};
      for(const f of ["completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","total_tds"]){
        leaguePositionDefense[pos][f]=mean([...teams].map(team=>byTeam[team]?.positionDefense?.[pos]?.[f]));
      }
    }
    const currentGames=Math.max(0,...Object.values(current.offense).map(r=>r.games||0)),playersByTeam=blendPlayerRows(prior.playersByTeam||{},current.playersByTeam||{});
    const payload={season,byTeam,playersByTeam,leaguePositionDefense,meta:{source:"nflverse+ngs",snapshotSchema:"nflverse-features-v3",builtAt:new Date(now).toISOString(),runtimeSource:"offline-builder",currentSeason:season,priorSeason:season-1,teams:Object.keys(byTeam).length,currentGames,currentRows:current.rows,priorRows:prior.rows,currentStatus:{team:current.teamStatus,player:current.playerStatus,snaps:current.snapStatus},priorStatus:{team:prior.teamStatus,player:prior.playerStatus,snaps:prior.snapStatus},ngsStatus:{passing:ngsPassing.status,rushing:ngsRushing.status,receiving:ngsReceiving.status},priorWeightGames:PRIOR_GAMES,playerPriorWeightGames:PLAYER_PRIOR_GAMES,recentGameWeights:[0.35,0.25,0.18,0.13,0.09],projectionBlend:{recent5:0.65,currentSeason:0.25,priorSeason:0.10},marketInformed:false,featureFamilies:["team_epa","qb_epa_cpoe","nextgen_passing","nextgen_rushing","nextgen_receiving","snap_share","last5_player_form","position_defense_allowed"],limitation:"Depth-chart and in-week participation remain separate availability inputs; runtime never uses sportsbook lines as features."}};
    await writeCache(cacheKey,payload,env.caches,TTL_MS);return payload;
  }catch(err){
    const payload={season,byTeam:{},playersByTeam:{},meta:{source:"nflverse+ngs",teams:0,error:String(err?.message||err),marketInformed:false}};
    await writeCache(cacheKey,payload,env.caches,ERR_TTL_MS);return payload;
  }
}
function teamFeature(feed,team={}){const key=canon(team.abbr||team.shortName||team.name);return feed.byTeam?.[key]||null;}
export function attachNflVerseFeatures(games=[],feed={}){
  return(games||[]).map(game=>{
    if(game.sport&&game.sport!=="nfl")return game;
    const home=teamFeature(feed,game.home)||{},away=teamFeature(feed,game.away)||{};
    return{...game,nflFeatures:{...(game.nflFeatures||{}),home:{...(game.nflFeatures?.home||{}),...home},away:{...(game.nflFeatures?.away||{}),...away}}};
  });
}
