/** Free ATP/WTA season CSV research adapter — source: TennisMyLife.
 * Does NOT convert third-party scores to official settlements.
 * No execution/trading authorization and no guessed match start times.
 */
export const FREE_TENNIS_SOURCE='TENNISMYLIFE';
const digits=x=>/^\d{8}$/.test(String(x||''));
const integer=x=>x!=null&&String(x).trim()!==''&&/^\d+$/.test(String(x))?Number(x):null;
const id=x=>/^[\w-]{1,100}$/.test(String(x||''))?String(x):null;
const safe=v=>String(v||'').trim();
const required=['tourney_id','tourney_date','match_num','winner_id','loser_id',
 'surface','score','w_svpt','l_svpt','w_1stIn','l_1stIn','w_1stWon','l_1stWon','w_2ndWon','l_2ndWon'];
export function parseTennisCsv(input){
 if(typeof input!=='string'||!input.length||input.length>6_000_000)throw Error('CSV_SIZE_INVALID');
 let rows=[],row=[],field='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'&&input[i+1]==='"'){field+='"';i++}
   else if(c==='"')quoted=false;else field+=c}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(field);field=''}
  else if(c==='\n'){row.push(field);if(row.length>1)rows.push(row);row=[];field=''}
  else if(c!=='\r')field+=c;
 }
 if(quoted)throw Error('CSV_UNTERMINATED_QUOTE');
 if(field||row.length){row.push(field);if(row.length>1)rows.push(row)}
 const columns=rows.shift()?.map(s=>s.replace(/^\uFEFF/,'').trim())||[];
 if(required.some(x=>!columns.includes(x)))throw Error('CSV_STAT_COLUMNS_MISSING');
 if(new Set(columns).size!==columns.length)throw Error('CSV_DUPLICATE_HEADERS');
 return rows.map(r=>Object.fromEntries(columns.map((key,i)=>[key,r[i]??''])));
}
function stats(row,p){
 const fields=['ace','df','svpt','1stIn','1stWon','2ndWon','SvGms','bpSaved','bpFaced'];
 const obj=Object.fromEntries(fields.map(k=>[k,integer(row[p+'_'+k])]));
 if(obj.svpt==null||obj.svpt<=0||obj['1stIn']==null||
  obj['1stWon']==null||obj['2ndWon']==null||
  obj['1stIn']>obj.svpt||obj['1stWon']>obj['1stIn']||
  obj['2ndWon']>obj.svpt-obj['1stIn']||
  (obj.bpFaced!=null&&obj.bpSaved!=null&&obj.bpSaved>obj.bpFaced))
  return null;
 return obj;
}
const retired=/\b(?:RET|RETIRED|W\/O|WALKOVER|DEF|DEFAULT|ABD|ABANDONED|SUSPENDED)\b/i;
export function parseTennisCurrentRow(r,{tour,asOfDay}={}){
 if(!['atp','wta'].includes(tour)||!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay||''))
  throw Error('TOUR_OR_CLOCK_INVALID');
 const ti=id(r.tourney_id),mi=id(r.match_num),w=id(r.winner_id),l=id(r.loser_id),
  dt=safe(r.tourney_date),surface=safe(r.surface).toLowerCase();
 if(!ti||!mi||!w||!l||w===l||!digits(dt)||
  !['hard','clay','grass','carpet'].includes(surface))return null;
 const label=dt.slice(0,4)+'-'+dt.slice(4,6)+'-'+dt.slice(6,8);
 if(!Number.isFinite(Date.parse(label+'T00:00:00Z'))||label>=asOfDay)return null;
 const score=safe(r.score);
 if(!score||retired.test(score))return null;
 const wstats=stats(r,'w'),lstats=stats(r,'l');
 if(!wstats||!lstats)return null;
 // TML's tournament_date is not a verified match start time. A valid score
 // here is research evidence only, never a source for official grading.
 return {sourceEventKey:tour+'|'+ti+'|'+mi,tour,tournamentId:ti,matchNum:mi,
  dateLabel:label,winnerSourceId:w,loserSourceId:l,
  winnerName:safe(r.winner_name),loserName:safe(r.loser_name),surface,
  score,winnerStats:wstats,loserStats:lstats,provider:FREE_TENNIS_SOURCE,
  eventStartVerified:false,officialResultVerified:false,
  researchOnly:true,contractTradingAuthorized:false};
}
export function selectCurrentTennisRows(rows,{tour,now=new Date(),lookbackDays=35,maxRows=600}={}){
 const day=now.toISOString().slice(0,10);
 const floor=new Date(+now-lookbackDays*86400000).toISOString().slice(0,10);
 const kept=[],reasons={};let seen=0;
 const ids=new Set();
 for(const row of rows){
  const date=String(row.tourney_date||'');
  if(!digits(date)){reasons.INVALID_DATE=(reasons.INVALID_DATE||0)+1;continue}
  const label=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8);
  if(label<floor||label>=day)continue;
  seen++;
  const parsed=parseTennisCurrentRow(row,{tour,asOfDay:day});
  if(!parsed){reasons.INCOMPLETE_OR_INVALID_STATS=(reasons.INCOMPLETE_OR_INVALID_STATS||0)+1;continue}
  if(ids.has(parsed.sourceEventKey)){reasons.DUPLICATE=(reasons.DUPLICATE||0)+1;continue}
  ids.add(parsed.sourceEventKey);kept.push(parsed);
 }
 if(kept.length>maxRows)throw Error('CURRENT_TOUR_READ_EXCEEDS_SAFE_LIMIT');
 return {matches:kept,seen,reasons,dateFloor:floor,dateCeiling:day,
  source:FREE_TENNIS_SOURCE,official:false,contractTradingAuthorized:false};
}
