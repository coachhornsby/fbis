import {readCache,writeCache} from './cache.js';
import {isFbsVsFbsGame} from './cfbGameVisibility.js';
import FITTED from '../../data/models/cfb-fbis-v2-fitted-aa.js';
import {attachDetailedCfbRankings} from './cfbRankingMetrics.js';
export const SDV_SUMMARY_SOURCE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_team_summaries/cfb_team_summaries_2026.csv';
export const SDV_INTELLIGENCE_VERSION='cfb-sdv-intelligence-v2';
export function parseCsv(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Truncated CSV quote');
  if(field||row.length){row.push(field);rows.push(row);}
  const columns=rows.shift()||[];
  if(new Set(columns).size!==columns.length)throw Error('Duplicate CSV columns');
  return {columns,rows:rows.map(values=>{if(values.length!==columns.length)throw Error('CSV width mismatch');return Object.fromEntries(columns.map((k,i)=>[k,values[i]]));})};
}
export function nullableNumber(value) {
  if(value==null||String(value).trim()===''||['NA','NAN','NULL','NONE'].includes(String(value).toUpperCase()))return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function rank(teams,key,ascending=false){
  const sorted=teams.filter(t=>t.stats[key]!=null&&t.games>0).sort((a,b)=>(ascending?1:-1)*(a.stats[key]-b.stats[key])||a.teamId.localeCompare(b.teamId));
  let previous=null,current=0;
  return Object.fromEntries(sorted.map((t,i)=>{if(t.stats[key]!==previous){current=i+1;previous=t.stats[key];}return [t.teamId,current];}));
}
export function buildSdvIntelligence(csv,receipt={}) {
  const parsed=parseCsv(csv),seen=new Set();
  const teams=parsed.rows.filter(r=>String(r.season)==='2026' && String(r.division).toLowerCase()==='fbs').map(r=>{
    if(!/^\d+$/.test(r.team_id)||seen.has(r.team_id))throw Error('Ambiguous canonical summary identity');seen.add(r.team_id);
    if(!isFbsVsFbsGame({sport:'cfb',season:2026,home:{espnId:r.team_id},away:{espnId:r.team_id}}))throw Error('Summary outside verified FBS universe');
    const stats=Object.fromEntries(parsed.columns.filter(k=>!['team_id','pos_team','division','conference','season'].includes(k)).map(k=>[k,nullableNumber(r[k])]));
    return {teamId:`cfb:espn:${r.team_id}`,espnId:r.team_id,name:r.pos_team,conference:r.conference||null,games:nullableNumber(r.valid_games),stats,
      missingMetrics:Object.values(stats).filter(v=>v==null).length,availableMetrics:Object.values(stats).filter(v=>v!=null).length};
  });
  const net=rank(teams,'net_adj_epa'),offense=rank(teams,'adj_off_epa'),defense=rank(teams,'adj_def_epa',true);
  for(const t of teams){t.rank=net[t.teamId]??null;t.offenseRank=offense[t.teamId]??null;t.defenseRank=defense[t.teamId]??null;}
  teams.sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.name.localeCompare(b.name));
  const conferences=[...new Set(teams.map(t=>t.conference).filter(Boolean))].map(name=>{
    const members=teams.filter(t=>t.conference===name),metrics={};
    for(const key of ['net_adj_epa','adj_off_epa','adj_def_epa','success_off','success_def','EPAplay_off_pass','EPAplay_def_pass','EPAplay_off_rush','EPAplay_def_rush','explosive_off','explosive_def','havoc_def','pts_per_opp_off','pts_per_opp_def','playsgame_off','yardsplay_off','yardsplay_def']){
      const weightField=key.includes('_def')?'plays_def':'plays_off';
      const valid=members.filter(t=>t.games>0&&t.stats[key]!=null&&t.stats[weightField]>0);
      const weight=valid.reduce((n,t)=>n+t.stats[weightField],0);
      metrics[key]={value:weight?valid.reduce((n,t)=>n+t.stats[key]*t.stats[weightField],0)/weight:null,teams:valid.length,weight,weightField};
    }
    const values=members.filter(t=>t.rank!=null).map(t=>t.stats.net_adj_epa);
    const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
    return {name,teams:members.length,rankedTeams:values.length,teamGameSamples:members.reduce((n,t)=>n+(t.games||0),0),metrics,
      withinConferenceSd:values.length>1?Math.sqrt(values.reduce((n,x)=>n+(x-mean)**2,0)/(values.length-1)):null,
      bestTeam:members.find(t=>t.rank!=null)?.name||null,unranked:members.filter(t=>t.rank==null).length};
  }).sort((a,b)=>(b.metrics.net_adj_epa.value??-Infinity)-(a.metrics.net_adj_epa.value??-Infinity)||a.name.localeCompare(b.name));
  for(const [i,c] of conferences.entries())c.rank=c.metrics.net_adj_epa.value==null?null:i+1;
  return attachDetailedCfbRankings({ok:true,season:2026,version:SDV_INTELLIGENCE_VERSION,teams,conferences,source:receipt,
    methodology:{team:'FBS ranks from SDV opponent-adjusted EPA: offense higher is better; defense lower is better; net offense minus defense. Ties share rank. Other category ranks use the named source metric and declared orientation.',conference:'Headline metrics use the corresponding offensive or defensive play count. Detailed category ranks use equal-weight team means so conference depth is visible. Neither is an independently fitted conference-strength coefficient.',authority:'Research/display only; these rankings do not alter champion forecasts or wagering gates.',limitation:'Current season summaries are retrospective at acquisition. Provider latency and missing recent games can affect ranks; no historical PIT claim.'},
    coverage:{teams:teams.length,expectedFbsTeams:138,columns:parsed.columns.length,numericMetricColumns:parsed.columns.length-5,rankedTeams:teams.filter(t=>t.rank!=null).length},
    model:{id:FITTED.modelId,version:FITTED.version,marginFeatures:FITTED.margin.features,totalFeatures:FITTED.total.features,allStatsConsumed:false,canQualify:false,canAuthorizeWager:false,
      explanation:'Production retains fitted A/A features. All SDV statistics are exposed for analysis; adding features requires chronological challenger tests and separate production approval.'}});
}
export async function loadSdvIntelligence(env={},fetchFn=fetch) {
  const key='cfb-sdv-intelligence-2026-v2';
  const cached=await readCache(key,env.caches,30*60_000);if(cached)return cached;
  const response=await fetchFn(SDV_SUMMARY_SOURCE,{headers:{Accept:'text/csv'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`SDV summary ${response.status}`);
  const buffer=await response.arrayBuffer();if(buffer.byteLength>4*1024*1024)throw Error('SDV summary exceeds bound');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const result=buildSdvIntelligence(new TextDecoder().decode(buffer),{url:SDV_SUMMARY_SOURCE,sha256:hash,bytes:buffer.byteLength,observedAt:new Date().toISOString(),lastModified:response.headers.get('Last-Modified'),providerPublicationAt:null});
  const scheduleUrl='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_schedules/cfb_schedule_2026.csv';
  try {
    const scheduleResponse=await fetchFn(scheduleUrl,{signal:AbortSignal.timeout(15000)});
    if(!scheduleResponse.ok)throw Error(`SDV schedule ${scheduleResponse.status}`);
    const bytes=await scheduleResponse.arrayBuffer();if(bytes.byteLength>4*1024*1024)throw Error('SDV schedule exceeds bound');
    attachSdvResults(result,new TextDecoder().decode(bytes));
    result.resultSource={url:scheduleUrl,observedAt:new Date().toISOString(),sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')};
    result.coverage.summaryGameGaps=result.teams.filter(t=>t.summaryGameGap>0).length;
  }catch(error){result.coverage.resultState='UNAVAILABLE';result.coverage.resultError=String(error?.message||error);}
  await writeCache(key,result,env.caches,30*60_000);return result;
}
export function attachSdvResults(intelligence,scheduleCsv){
  const schedule=parseCsv(scheduleCsv),byId=new Map();
  for(const row of schedule.rows){
    if(row.season!=='2026'||!['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(row.status))continue;
    const signature=JSON.stringify(row);if(byId.has(row.game_id)&&byId.get(row.game_id).signature!==signature)throw Error('Conflicting schedule result versions');
    byId.set(row.game_id,{row,signature});
  }
  for(const team of intelligence.teams){
    const games=[];let wins=0,losses=0,ties=0,pending=0;
    for(const {row} of byId.values()){
      const home=row.home_id===team.espnId,away=row.away_id===team.espnId;if(!home&&!away)continue;
      const scored=nullableNumber(home?row.home_score:row.away_score),allowed=nullableNumber(home?row.away_score:row.home_score);
      if(scored==null||allowed==null)pending++;else if(scored>allowed)wins++;else if(scored<allowed)losses++;else ties++;
      games.push({gameId:row.game_id,start:row.game_date,opponentId:`cfb:espn:${home?row.away_id:row.home_id}`,opponent:home?row.away_team:row.home_team,home,scored,allowed,status:row.status});
    }
    team.record={wins,losses,ties,pending,sourceFinalGames:games.length};team.results=games.sort((a,b)=>String(a.start).localeCompare(String(b.start)));
    team.summaryGameGap=team.games==null?null:Math.max(0,games.length-team.games);
  }
  const identities=new Map(intelligence.teams.map(t=>[t.espnId,t]));
  for(const conference of intelligence.conferences){
    const record={games:0,wins:0,losses:0,ties:0,pending:0,pointsFor:0,pointsAgainst:0,
      scope:'Official-final FBS-versus-FBS games between different source-season conferences; no predictive authority'};
    for(const {row} of byId.values()){
      const home=identities.get(row.home_id),away=identities.get(row.away_id);
      if(!home||!away||!home.conference||!away.conference||home.conference===away.conference)continue;
      const isHome=home.conference===conference.name,isAway=away.conference===conference.name;
      if(!isHome&&!isAway)continue;
      const scored=nullableNumber(isHome?row.home_score:row.away_score),allowed=nullableNumber(isHome?row.away_score:row.home_score);
      record.games++;
      if(scored==null||allowed==null){record.pending++;continue;}
      record.pointsFor+=scored;record.pointsAgainst+=allowed;
      if(scored>allowed)record.wins++;else if(scored<allowed)record.losses++;else record.ties++;
    }
    if(record.games===record.pending){record.pointsFor=null;record.pointsAgainst=null;}
    conference.interconference=record;
  }
  return intelligence;
}
