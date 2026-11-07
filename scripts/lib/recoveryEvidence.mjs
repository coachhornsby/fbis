// Bounded recovery evidence. No provider access, model changes or persistence.
export function createRecoverySourceBudget({ESPN=134,KenPom=1}={}) {
 const limits={ESPN,KenPom},counts={ESPN:0,KenPom:0};
 return {counts,limits,reserve(kind){
  if(!Object.hasOwn(limits,kind))throw Error('SOURCE_KIND_NOT_ALLOWED');
  if(counts[kind]>=limits[kind])throw Error('SOURCE_CALL_BUDGET_EXCEEDED');
  counts[kind]++;
 }};
}
export function recoveryCoverage(target,events,expiresAt) {
 const expiry=Date.parse(expiresAt);
 const projected=new Set(events.map(e=>String(e.eventId)));
 const missing=target.filter(g=>!projected.has(String(g.id))).map(g=>String(g.id));
 const expiring=events.filter(e=>!Number.isFinite(expiry)||Date.parse(e.start)>=expiry).map(e=>String(e.eventId));
 return {state:!target.length?'NO_SCHEDULED_GAMES':!events.length?'UNAVAILABLE':missing.length||expiring.length?'PARTIAL':'COMPLETE',
  scheduled:target.length,projected:events.length,missingEventIds:missing,
  expiresBeforeStartEventIds:expiring,expiresAt:expiresAt||null,canAuthorizeWager:false};
}

// Read-only receipt health. A successful job is not proof of usable forecasts.
export function recoveryReceiptDiagnostics(receipt,{nowMs=Date.now(),minCaptureAt=null,deadlineAt=null}={}) {
 if(!Number.isFinite(nowMs))throw Error('INVALID_DIAGNOSTIC_CLOCK');
 const reasons=[],generated=Date.parse(receipt?.generatedAt);
 if(!Number.isFinite(generated))reasons.push('MISSING_CAPTURE_TIME');
 else if(generated>nowMs)reasons.push('FUTURE_CAPTURE_TIME');
 if(minCaptureAt!==null||deadlineAt!==null){
  const min=Date.parse(minCaptureAt),deadline=Date.parse(deadlineAt);
  if(!Number.isFinite(min)||!Number.isFinite(deadline)||min>deadline)throw Error('INVALID_REFRESH_WINDOW');
  if(nowMs>=deadline&&(!Number.isFinite(generated)||generated<min))reasons.push('REFRESH_DEADLINE_MISSED');
 }
 if(receipt?.errors?.length)reasons.push('RUN_ERRORS');
 if(!Array.isArray(receipt?.written))reasons.push('INVALID_PUBLICATION_RECORDS');
 if(!['COMPLETE','PARTIAL'].includes(receipt?.coverageState))reasons.push('INVALID_RECEIPT_STATE');
 const entries=Object.entries(receipt?.forecastCoverage||{});
 if(['cbb','cfb','nba','nfl'].some(s=>!Object.hasOwn(receipt?.forecastCoverage||{},s)))reasons.push('INCOMPLETE_SPORT_COVERAGE');
 if(!entries.length)reasons.push('MISSING_COVERAGE');
 const sports={};
 for(const [sport,c] of entries){
  if(!c||typeof c!=='object'){sports[sport]={flags:['INVALID_COVERAGE']};continue;}
  const flags=[],expiry=Date.parse(c.expiresAt),projected=c.projected,scheduled=c.scheduled;
  if(!['NO_SCHEDULED_GAMES','UNAVAILABLE','PARTIAL','COMPLETE'].includes(c.state))flags.push('INVALID_COVERAGE_STATE');
  if(!Array.isArray(c.missingEventIds)||!Array.isArray(c.expiresBeforeStartEventIds)||
    c.missingEventIds?.length!==scheduled-projected||c.expiresBeforeStartEventIds?.length>projected||
    (c.state==='NO_SCHEDULED_GAMES'&&(scheduled!==0||projected!==0))||
    (c.state==='COMPLETE'&&(scheduled!==projected||!scheduled||c.expiresBeforeStartEventIds?.length)))flags.push('INCONSISTENT_COVERAGE');
  if(c.state==='UNAVAILABLE')flags.push('COVERAGE_UNAVAILABLE');
  if(c.state==='PARTIAL')flags.push('COVERAGE_PARTIAL');
  if((c.missingEventIds?.length||0)>0&&projected===scheduled)flags.push('INCONSISTENT_MISSING_FORECASTS');
  if(!Number.isInteger(projected)||!Number.isInteger(scheduled)||projected<0||scheduled<0||projected>scheduled)flags.push('INVALID_COVERAGE');
  if(scheduled>0&&projected===0)flags.push('NO_FORECASTS');
  else if(projected<scheduled)flags.push('MISSING_FORECASTS');
  if(projected>0){
   if(!Number.isFinite(expiry))flags.push('INVALID_EXPIRY');
   else if(nowMs>=expiry)flags.push('EXPIRED');
   if(!(Array.isArray(receipt?.written)&&receipt.written.some(w=>w?.sport===sport&&w.stored===true&&w.events===projected)))flags.push('PUBLICATION_UNVERIFIED');
  }
  if(c.expiresBeforeStartEventIds?.length)flags.push('EXPIRES_BEFORE_KICKOFF');
  sports[sport]={flags,scheduled,projected,expiresAt:c.expiresAt||null,missingCount:c.missingEventIds?.length||0,expiresBeforeKickoffCount:c.expiresBeforeStartEventIds?.length||0};
 }
 const needsAttention=reasons.length>0||Object.values(sports).some(s=>s.flags.length>0)||receipt?.coverageState==='PARTIAL';
 return {checkedAt:new Date(nowMs).toISOString(),state:needsAttention?'ATTENTION_REQUIRED':'CURRENT',reasons,sports,action:needsAttention?'ALERT_ONLY':'NONE',canDispatch:false,canAuthorizeWager:false};
}
