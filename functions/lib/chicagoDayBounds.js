export function chicagoDayBounds(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('INVALID_CHICAGO_DAY');
 const midnight=value=>{const utc=Date.parse(value+'T00:00:00Z');let at=utc;
  for(let i=0;i<3;i++){const zone=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',timeZoneName:'shortOffset'}).formatToParts(new Date(at)).find(p=>p.type==='timeZoneName')?.value;const m=/GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(zone||'');if(!m)throw Error('CHICAGO_OFFSET_UNAVAILABLE');const offset=(Number(m[2])*60+Number(m[3]||0))*(m[1]==='-'?-1:1);at=utc-offset*60000;}
  return new Date(at).toISOString();};
 return {start:midnight(day),end:midnight(new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10))};
}
