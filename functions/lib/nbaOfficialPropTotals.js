/** NBA official final boxscore parser: only exact ESPN event/athlete IDs. */
const canonical=x=>({SA:'SAS',GS:'GSW',NO:'NOP',NY:'NYK'}[String(x||'').toUpperCase()]||String(x||'').toUpperCase());
const int=v=>v!=null&&v!==''&&/^\d+$/.test(String(v).trim())?Number(v):null;
const made=v=>{if(typeof v==='string'&&/^\d+-\d+$/.test(v.trim()))return int(v.split('-')[0]);return int(v);};
const stat=(labels,values,name)=>{
 const i=labels.findIndex(x=>String(x||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase()===name);
 return i<0?null: name==='3PT'?made(values[i]):int(values[i]);
};
export const nbaActualForMarket=(totals,market)=>{
 if(!totals)return null;
 const m=market==='pra'?'points_rebounds_assists':market;
 const parts={points:['points'],rebounds:['rebounds'],assists:['assists'],three_pointers_made:['three_pointers_made'],
 points_rebounds:['points','rebounds'],points_assists:['points','assists'],rebounds_assists:['rebounds','assists'],
 points_rebounds_assists:['points','rebounds','assists']}[m];
 if(!parts||parts.some(k=>!Number.isInteger(totals[k])||totals[k]<0))return null;
 return parts.reduce((sum,k)=>sum+totals[k],0);
};
export function extractNbaOfficialBoxscore(body,{eventId,homeId,awayId,homeAbbr,awayAbbr}={}){
 const comp=body?.header?.competitions?.[0]||null;
 const got=String(comp?.id||body?.header?.id||'');
 const status=comp?.status?.type;
 if(!eventId||got!==String(eventId)||status?.completed!==true||
   !['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(String(status?.name||'')))
  return {ok:false,reason:'EVENT_NOT_OFFICIALLY_FINAL'};
 const competitors=comp?.competitors||[];
 const ids=competitors.map(c=>String(c?.team?.id||c?.id||'')).sort();
 const codes=competitors.map(c=>canonical(c?.team?.abbreviation));
 const expectedCodes=[canonical(homeAbbr),canonical(awayAbbr)];
 const verifiedById=homeId&&awayId&&ids.length===2&&ids[0]!==ids[1]&&
  ids.join('|')===[String(homeId),String(awayId)].sort().join('|');
 const verifiedByCode=homeAbbr&&awayAbbr&&codes.length===2&&codes[0]!==codes[1]&&
  codes.slice().sort().join('|')===expectedCodes.sort().join('|');
 if(!verifiedById&&!verifiedByCode)
  return {ok:false,reason:'GAME_TEAM_IDENTITY_MISMATCH'};
 const output=new Map(),bad=new Set();
 for(const team of body?.boxscore?.players||[]){
  if(!ids.includes(String(team?.team?.id||''))&&!codes.includes(canonical(team?.team?.abbreviation)))continue;
  for(const group of team.statistics||[]){
   const labels=group.labels||group.names||[];
   for(const p of group.athletes||[]){
    const playerId=String(p?.athlete?.id||'');
    if(!/^\d+$/.test(playerId)||p.didNotPlay===true||p.dnp===true)continue;
    const values=Array.isArray(p.stats)?p.stats:[];
    const totals={points:stat(labels,values,'PTS'),rebounds:stat(labels,values,'REB'),
     assists:stat(labels,values,'AST'),three_pointers_made:stat(labels,values,'3PT')};
    if(Object.values(totals).every(v=>v===null))continue;
    if(output.has(playerId))bad.add(playerId);
    else output.set(playerId,{canonicalPlayerId:'nba:espn:'+playerId,eventId:String(eventId),
      ...totals,officialVerified:true,source:'ESPN_NBA_FINAL_BOXSCORE',
      resultStatus:'FINAL'});
   }
  }
 }
 for(const id of bad)output.delete(id);
 return {ok:true,rows:[...output.values()],status:'FINAL',source:'ESPN_NBA_FINAL_BOXSCORE',
  rejectedDuplicateAthletes:bad.size};
}
