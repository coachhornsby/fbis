const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const family=p=>{
  const s=String(p||"").toUpperCase();
  if(s.includes("C"))return"C";
  if(s.includes("G"))return"G";
  if(s.includes("F"))return"F";
  return"U";
};
const statusMiss=s=>{
  const x=String(s||"AVAILABLE").toUpperCase();
  return x==="OUT"?1:x==="DOUBTFUL"?0.8:x==="QUESTIONABLE"?0.45:x==="PROBABLE"?0.12:0;
};

export function buildRoleRedistribution({
  targetPlayerId,rosterImpacts={},unavailablePlayers=[],maxMinutesDelta=9
}={}){
  const id=String(targetPlayerId||"");
  const target=rosterImpacts?.[id];if(!target)return null;
  const active=Object.entries(rosterImpacts).filter(([pid])=>pid!==id&&!unavailablePlayers.some(u=>String(u.playerId||u.id)===String(pid)&&statusMiss(u.status)>=.8));
  let targetMinuteWeight=0,totalMinuteWeight=0,lostMinutes=0,lostUsage=0,lostRebounds=0,lostAssists=0,lostThrees=0;
  const tf=family(target.position);
  for(const u of unavailablePlayers||[]){
    const pid=String(u.playerId||u.id||""),p=rosterImpacts?.[pid],miss=statusMiss(u.status);if(!p||!miss)continue;
    const skill=p.skill||{};
    lostMinutes+=(finite(skill.minutes)||0)*miss;
    lostUsage+=(finite(skill.usage)||0)*miss;
    lostRebounds+=(finite(skill.reboundsPer36)||0)*miss;
    lostAssists+=(finite(skill.assistsPer36)||0)*miss;
    lostThrees+=(finite(skill.threesPer36)||0)*miss;
  }
  const minuteWeight=(p)=>{
    const skill=p.skill||{},same=family(p.position)===tf?1.5:family(p.position)==="U"||tf==="U"?1:0.7;
    return same*Math.max(4,finite(skill.minutes)||12);
  };
  targetMinuteWeight=minuteWeight(target);
  totalMinuteWeight=targetMinuteWeight+active.reduce((s,[,p])=>s+minuteWeight(p),0);
  const minutesDelta=totalMinuteWeight?clamp(lostMinutes*targetMinuteWeight/totalMinuteWeight,0,maxMinutesDelta):0;

  const tSkill=target.skill||{},usage=finite(tSkill.usage)||18,rebs=finite(tSkill.reboundsPer36)||5,asts=finite(tSkill.assistsPer36)||3,threes=finite(tSkill.threesPer36)||1.5;
  const activeUsage=Object.values(rosterImpacts).reduce((s,p)=>s+(finite(p?.skill?.usage)||0),0)||1;
  const usageShare=clamp(usage/activeUsage,.03,.35);
  const redistributedUsage=lostUsage*usageShare*.55;
  const usageMultiplier=clamp(1+(redistributedUsage/Math.max(usage,8)),.92,1.22);
  const assistOpportunity=clamp(1+(lostAssists*Math.max(asts,1)/(Math.max(asts,1)+8))*.012,.94,1.18);
  const reboundOpportunity=clamp(1+(lostRebounds*Math.max(rebs,1)/(Math.max(rebs,1)+12))*.010,.94,1.16);
  const threeOpportunity=clamp(1+(lostThrees*Math.max(threes,.5)/(Math.max(threes,.5)+5))*.015,.94,1.18);

  return {
    playerId:id,
    minutesDelta:round(minutesDelta),
    usageMultiplier:round(usageMultiplier),
    pointsMultiplier:round(clamp(.55*usageMultiplier+.45*threeOpportunity,.92,1.20)),
    assistsMultiplier:round(assistOpportunity),
    reboundsMultiplier:round(reboundOpportunity),
    threesMultiplier:round(threeOpportunity),
    lostTeamMinutes:round(lostMinutes),
    lostTeamUsage:round(lostUsage),
    unavailableCount:(unavailablePlayers||[]).filter(u=>statusMiss(u.status)>0).length,
    method:"FBIS_ROLE_REDISTRIBUTION_v1",
  };
}

export function lineupOpportunityModifier({
  playerId,lineupEffects=[],expectedTeammates=[],historicalBaseline=0
}={}){
  const id=String(playerId||""),mates=(expectedTeammates||[]).map(String);
  const relevant=(lineupEffects||[]).filter(x=>{
    const ids=String(x.key||"").split("|");
    return ids.includes(id)&&ids.every(x=>x===id||mates.includes(x));
  });
  if(!relevant.length)return {netDelta:0,multiplier:1,samplePossessions:0};
  let num=0,den=0;
  for(const r of relevant){
    const poss=finite(r.possessions)||0,w=poss/(poss+80),v=finite(r.shrunkNet100??r.net100);
    if(v==null)continue;num+=v*w*poss;den+=w*poss;
  }
  const net=den?num/den:historicalBaseline;
  return {netDelta:round(net-historicalBaseline),multiplier:round(clamp(1+(net-historicalBaseline)/250,.94,1.06)),samplePossessions:round(den)};
}
