/** Deterministic PinnOdds collection slot, shared by primary and backup cron.
 * Hourly backup attempts reuse an existing slot: they never create a new
 * billable reservation simply because GitHub ran the job again.
 */
export function pinnoddsWindow(now=new Date()){
 const t=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(t.getTime()))throw Error('PINNODDS_INVALID_SCHEDULE_TIME');
 const hour=Math.floor(t.getUTCHours()/3)*3,scope=hour%6===0?'full':'drops';
 const start=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate(),hour));
 const day=start.toISOString().slice(0,10).replaceAll('-','');
 return {scope,runId:`pinnodds-${day}-${String(hour).padStart(2,'0')}-${scope}`,windowStart:start.toISOString(),windowEnd:new Date(+start+3*3600000).toISOString(),hour};
}
export function pinnoddsWindowComplete(status,window,now=new Date()){
 if(status?.ok!==true||!Array.isArray(status.results))throw Error('PINNODDS_STATUS_REQUIRED_BEFORE_PAID_COLLECTION');
 const checked=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(checked.getTime()))throw Error('PINNODDS_INVALID_SCHEDULE_TIME');
 const recent=status.results.filter(s=>s.kind===(window.scope==='full'?'board':'drops')&&s.status==='RECENT_CAPTURE'&&s.reconciled===true&&
    Date.parse(s.collectedAt)>=Date.parse(window.windowStart)&&Date.parse(s.collectedAt)<=checked.getTime());
 const keys=new Set(recent.map(s=>window.scope==='full'?String(s.sportId)+':'+s.feed:s.feed));
 const expected=window.scope==='full'?
  Array.from({length:6},(_,i)=>[i+1+':prematch',i+1+':live']).flat():
  ['prematch','live'];
 return expected.every(k=>keys.has(k));
}
