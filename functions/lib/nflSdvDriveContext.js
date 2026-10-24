/**
 * nflfastR documented source-drive metadata adapter.
 * Fields are descriptive records, not inferred clock or end-field transitions.
 * Mismatched or missing provider values stay missing. No guessed duration.
 */
const clean=x=>typeof x==="string"?x.trim():"";
const score=x=>Number.isInteger(Number(x))?Number(x):null;
export function parseNflSourcePossessionSeconds(v){
 if(typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=1800)return v;
 const s=clean(v),match=/^(\d{1,2}):([0-5]\d)$/.exec(s);
 if(!match)return null;
 const seconds=Number(match[1])*60+Number(match[2]);
 return seconds<=1800?seconds:null;
}
export function normalizeNflSourceTransition(value){
 const s=clean(value).toUpperCase().replace(/[\s-]+/g,"_");
 return /^[A-Z0-9_]{2,64}$/.test(s)?s:null;
}
export function parseNflSourceYardsToGoal(value,offenseAbbr,home,away){
 const v=clean(value).toUpperCase().replace(/\s+/g," ");
 if(v==="50"||v==="MIDFIELD")return 50;
 const m=/^([A-Z]{2,3})\s+(\d{1,2})$/.exec(v);
 if(!m||![home,away].includes(m[1]))return null;
 const yard=Number(m[2]);
 if(yard>50)return null;
 return m[1]===offenseAbbr?100-yard:yard;
}
function consistentValue(rows,key,parse){
 const vals=rows.map(r=>parse(r[key])).filter(x=>x!==null);
 return vals.length>0&&vals.every(x=>x===vals[0])?vals[0]:null;
}
export function extractNflSourceDriveContext(rows,{home,away,offense}={}){
 if(!Array.isArray(rows)||!rows.length||![home,away].includes(offense))
  throw Error("INVALID_NFL_SOURCE_DRIVE_CONTEXT");
 const officialDurationSeconds=consistentValue(rows,"drive_time_of_possession",parseNflSourcePossessionSeconds);
 const startTransition=consistentValue(rows,"drive_start_transition",normalizeNflSourceTransition);
 const endTransition=consistentValue(rows,"drive_end_transition",normalizeNflSourceTransition);
 const officialStartYardsToGoal=consistentValue(rows,"drive_start_yard_line",
  x=>parseNflSourceYardsToGoal(x,offense,home,away));
 const officialEndYardsToGoal=consistentValue(rows,"drive_end_yard_line",
  x=>parseNflSourceYardsToGoal(x,offense,home,away));
 return {
  ...(officialDurationSeconds!==null?{officialDurationSeconds}:{}),
  ...(startTransition!==null?{startTransition}:{}),
  ...(endTransition!==null?{endTransition}:{}),
  ...(officialStartYardsToGoal!==null?{officialStartYardsToGoal}:{}),
  ...(officialEndYardsToGoal!==null?{officialEndYardsToGoal}:{})
 };
}
