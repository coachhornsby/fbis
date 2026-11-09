// Derived, source-backed NFL unit comparisons. No market or wagering authority.
const IDS=['away-run-defense','away-run-offense','away-pass-defense','away-pass-offense'];
const KEYS=['id','available','adjustment','winner','offenseEpa','defenseEpaAllowed','metric','synopsis','evidence','role'];
export function validateNflDirectionalResearch(value){
 if(!value||value.version!==1||value.role!=='RESEARCH_DISPLAY_ONLY'||value.canQualify!==false||value.canAuthorizeWager!==false||!Array.isArray(value.unitMatchups)||value.unitMatchups.length!==4||Object.keys(value).some(k=>!['version','role','canQualify','canAuthorizeWager','unitMatchups'].includes(k)))throw Error('INVALID_NFL_DIRECTIONAL_RESEARCH');
 for(let i=0;i<4;i++){
  const r=value.unitMatchups[i];
  if(!r||r.id!==IDS[i]||Object.keys(r).length!==KEYS.length||KEYS.some(k=>!Object.hasOwn(r,k))||typeof r.available!=='boolean'||r.role!=='research-display-only'||r.evidence!=='point-in-time-team-features'||typeof r.synopsis!=='string'||r.synopsis.length>240)throw Error('INVALID_NFL_DIRECTIONAL_ROW');
  if(r.available){
   if(![r.offenseEpa,r.defenseEpaAllowed,r.adjustment].every(x=>typeof x==='number'&&Number.isFinite(x))||Math.abs(r.offenseEpa)>10||Math.abs(r.defenseEpaAllowed)>10||Math.abs(r.adjustment)>1.5||![null,'home','away'].includes(r.winner)||r.metric!=='EPA per play')throw Error('INVALID_NFL_DIRECTIONAL_VALUES');
   const expected=Math.round(Math.max(-1.5,Math.min(1.5,(r.offenseEpa+r.defenseEpaAllowed)*3))*10)/10;
   const offSide=i%2===0?'home':'away',winner=Math.abs(expected)>=.15?(expected>0?offSide:offSide==='home'?'away':'home'):null;
   if(Math.abs(expected-r.adjustment)>1e-9||r.winner!==winner)throw Error('INVALID_NFL_DIRECTIONAL_DERIVATION');
  }else if([r.offenseEpa,r.defenseEpaAllowed,r.adjustment,r.winner,r.metric].some(x=>x!==null))throw Error('INVALID_NFL_DIRECTIONAL_MISSINGNESS');
 }
 return value;
}
export function prepareNflDirectionalResearch(game){
 const unitMatchups=(game.nflGameMatchup?.unitMatchups||[]).map(r=>Object.fromEntries(KEYS.map(k=>[k,r[k]])));
 return validateNflDirectionalResearch({version:1,role:'RESEARCH_DISPLAY_ONLY',canQualify:false,canAuthorizeWager:false,unitMatchups});
}
