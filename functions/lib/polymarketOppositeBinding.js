// Only validate source-authored complementary metadata. Never manufacture it.
export function verifiedOppositeBinding(binding,family,sport){
 const b=binding;
 if(!b||b.version!==1||b.contractLong!==true||typeof b.sourceOutcomeId!=='string'||!b.sourceOutcomeId.length)return null;
 const id=b.oppositeSourceOutcomeId;
 if(typeof id!=='string'||!id.length||id.length>160||id===b.sourceOutcomeId)return null;
 if(b.period==='first_half')return sport==='cbb'&&family==='total'&&b.side==='over'&&b.oppositeSide==='under'
  ?{side:'under',line:b.line,sourceOutcomeId:id}:null;
 if(b.period!=='full_game')return null;
 const complement={home:'away',away:'home',over:'under',under:'over'};
 if(complement[b.side]!==b.oppositeSide)return null;
 if(family==='moneyline'){
  if(!['home','away'].includes(b.side)||b.line!==null||b.oppositeLine!==null)return null;
 }else if(family==='spread'){
  if(!['home','away'].includes(b.side)||!Number.isFinite(b.line)||Math.abs(b.line)>1000||!Number.isFinite(b.oppositeLine)||b.oppositeLine!==-b.line)return null;
 }else if(family==='total'){
  if(!['over','under'].includes(b.side)||!Number.isFinite(b.line)||b.line<=0||b.line>1000||b.oppositeLine!==b.line)return null;
 }else return null;
 return {side:b.oppositeSide,line:b.oppositeLine,sourceOutcomeId:id};
}
