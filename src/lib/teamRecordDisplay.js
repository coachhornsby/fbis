// Never calculate ATS from a scoreboard result or from captured prices.
export function teamRecordDisplay(team,clock=Date.now()){
 const out=[],id=String(team?.espnId||team?.providerTeamId||'');
 for(const [key,label] of [['su','S/U'],['ats','ATS']]){
  const r=team?.verifiedRecords?.[key],at=Date.parse(r?.capturedAt);
  if(!id||!r||r.verified!==true||r.recordType!==(key==='su'?'SU':'ATS')||String(r.teamId)!==id||typeof r.source!=='string'||!r.source.trim()||!Number.isFinite(clock)||!Number.isFinite(at)||at>clock||!Number.isSafeInteger(r.wins)||r.wins<0||!Number.isSafeInteger(r.losses)||r.losses<0)continue;
  if(key==='su'&&(r.source!=='ESPN_SCOREBOARD'||r.sourceScope!=='overall'))continue;
  const third=key==='ats'?r.pushes:r.ties;if(third!=null&&(!Number.isSafeInteger(third)||third<0))continue;
  if(key==='ats'&&(!Number.isSafeInteger(r.pushes)||r.sourceScope!=='against_the_spread'))continue;
  out.push({label,text:[r.wins,r.losses,...(third!=null?[third]:[])].join('-'),title:r.source+' · '+r.sourceScope+' · captured '+r.capturedAt+(r.season?' · season '+r.season:'')});
 }
 return out;
}
