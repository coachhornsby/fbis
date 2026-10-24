import {parseStatcastCsv} from './mlbPitchMatchupFeed.js';
import {normalizeLabRows,buildMlbStatcastLab} from './mlbStatcastLab.js';
import {validDay,gzipEvidence} from './mlbCompletionEvidence.js';
import {sha256Hex} from './sha256Hex.js';
export const MLB_LEAGUE_VERSION='mlb-league-benchmarks-v1';
const KEYS=['strikeout','walk','zone','chase','swstr','whiff','contact','hardHit','barrel','exitVelocity','xwobacon','velocity','spin','extension'];
export function buildMlbLeagueDay({date,rawCsv,finalGameIds,observedAt=new Date().toISOString()}){
 if(!validDay(date)||date>=observedAt.slice(0,10)||!Array.isArray(finalGameIds)||finalGameIds.length>30||new Set(finalGameIds.map(String)).size!==finalGameIds.length)throw Error('INVALID_LEAGUE_SCOPE');
 if(typeof rawCsv!=='string'||rawCsv.length>18000000)throw Error('LEAGUE_BYTE_BUDGET');
 const parsed=parseStatcastCsv(rawCsv);if(parsed.length>14000)throw Error('LEAGUE_ROW_BUDGET');
 const groups=new Map();for(const r of parsed){const id=String(r.pitcher);if(!/^\d+$/.test(id)||r.game_date!==date)throw Error('LEAGUE_ROW_IDENTITY');if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
 const cutoffDay=new Date(Date.parse(date)+86400000).toISOString().slice(0,10),season=Number(date.slice(0,4)),rows=[];
 for(const [playerId,rs] of groups){const n=normalizeLabRows(rs,{playerId,role:'pitcher',season,cutoffDay,finalGameIds:new Set(finalGameIds.map(String))});if(n.rejections.identity||n.rejections.scope||n.rejections.game)throw Error('LEAGUE_SOURCE_REJECTED');rows.push(...n.rows);}
 rows.sort((a,b)=>Number(a.game_pk)-Number(b.game_pk)||Number(a.at_bat_number)-Number(b.at_bat_number)||Number(a.pitch_number)-Number(b.pitch_number));
 const covered=[...new Set(rows.map(r=>r.game_pk))],missing=finalGameIds.map(String).filter(id=>!covered.includes(id));
 const cohorts=[];for(const scope of ['regular','postseason'])for(const hand of ['all','L','R']){
  const summary=buildMlbStatcastLab([{role:'pitcher',season,rows}],{season,scope,hand});
  cohorts.push({scope,hand,pitches:summary.pitches,plateAppearances:summary.plateAppearances,battedBalls:summary.battedBalls,metrics:Object.fromEntries(KEYS.map(k=>[k,summary.metrics[k]]))});
 }
 const pitcherDays=[...groups.keys()].map(id=>{const sample=rows.filter(r=>r.pitcher===id),summary=buildMlbStatcastLab([{role:'pitcher',season,rows:sample}],{season});return {playerId:id,pitches:summary.pitches,plateAppearances:summary.plateAppearances,metrics:summary.metrics};});
 const batterDays=[...new Set(rows.map(r=>r.batter))].map(id=>{const summary=buildMlbStatcastLab([{role:'batter',season,rows:rows.filter(r=>r.batter===id)}],{season});return {playerId:id,pitches:summary.pitches,plateAppearances:summary.plateAppearances,metrics:summary.metrics};});
 return {rows,summary:{version:MLB_LEAGUE_VERSION,date,season,observedAt,sourceHash:sha256Hex(JSON.stringify(rows)),pitcherDays,batterDays,expectedGameIds:finalGameIds.map(String),coveredGameIds:covered,missingGameIds:missing,complete:missing.length===0,cohorts,coverageBasis:'OFFICIAL_FINAL_GAME_MEMBERSHIP_NOT_PITCH_FOR_PITCH_PARITY'}};
}
export function poolMlbLeagueDays(days){
 const unique=new Map();for(const day of days){if(unique.has(day.date))throw Error('DUPLICATE_LEAGUE_DAY');unique.set(day.date,day);}
 const cohorts=[];for(const scope of ['regular','postseason'])for(const hand of ['all','L','R']){
  const selected=days.map(d=>d.cohorts.find(c=>c.scope===scope&&c.hand===hand)).filter(Boolean);
  cohorts.push({scope,hand,metrics:Object.fromEntries(KEYS.map(k=>{const valid=selected.map(c=>c.metrics[k]).filter(m=>m&&Number.isFinite(m.numerator)&&Number.isFinite(m.denominator)&&m.denominator>0),numerator=valid.reduce((s,m)=>s+m.numerator,0),denominator=valid.reduce((s,m)=>s+m.denominator,0);return[k,{value:denominator?numerator/denominator:null,numerator,denominator}];})),pitches:selected.reduce((s,c)=>s+c.pitches,0),plateAppearances:selected.reduce((s,c)=>s+c.plateAppearances,0)});
 }
 return {version:MLB_LEAGUE_VERSION,days:days.length,sources:days.map(d=>({date:d.date,sourceHash:d.sourceHash,observedAt:d.observedAt})),complete:days.every(d=>d.complete),cohorts,coverageBasis:'ACQUIRED_DAYS_ONLY',canAuthorizeWager:false};
}
export async function persistMlbLeagueDay(env,options){
 const {rows,summary}=buildMlbLeagueDay(options),base=`models/mlb/league/v1/${summary.date}/${summary.sourceHash}`;
 const old=await env.ARCHIVE.get(base+'/summary.json');let saved=old?await old.json():summary;
 if(!old){await env.ARCHIVE.put(base+'/source.json.gz',await gzipEvidence({sourceUrl:'https://baseballsavant.mlb.com/statcast_search/csv',rawCsv:options.rawCsv}),{onlyIf:new Headers({'If-None-Match':'*'})});await env.ARCHIVE.put(base+'/rows.json.gz',await gzipEvidence(rows),{onlyIf:new Headers({'If-None-Match':'*'})});await env.ARCHIVE.put(base+'/summary.json',JSON.stringify(summary),{onlyIf:new Headers({'If-None-Match':'*'})});saved=await (await env.ARCHIVE.get(base+'/summary.json')).json();}
 await env.ARCHIVE.put(`models/mlb/league/v1/${summary.date}/current.json`,JSON.stringify({key:base+'/summary.json',sourceHash:summary.sourceHash}));
 return saved;
}
