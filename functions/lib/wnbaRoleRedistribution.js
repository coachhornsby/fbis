const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const fam=p=>{const s=String(p||"").toUpperCase();if(s.includes("C"))return"C";if(s.includes("G"))return"G";if(s.includes("F"))return"F";return"U"};
const miss=s=>{const x=String(s||"AVAILABLE").toUpperCase();return x==="OUT"?1:x==="DOUBTFUL"?0.8:x==="QUESTIONABLE"?0.45:x==="PROBABLE"?0.12:0};

export function buildWnbaRoleRedistribution({targetPlayerId,rosterImpacts={},unavailablePlayers=[],maxMinutesDelta=7}={}){
  const id=String(targetPlayerId||""),target=rosterImpacts[id];if(!target)return null;
  const tf=fam(target.position);
  let lostMinutes=0,lostUsage=0,lostReb=0,lostAst=0,lost3=0;
  for(const u of unavailablePlayers){
    const p=rosterImpacts[String(u.playerId||u.id||"")],m=miss(u.status);if(!p||!m)continue;
    const s=p.skill||{};
    lostMinutes+=(finite(s.minutes)||0)*m;lostUsage+=(finite(s.usage)||0)*m;
    lostReb+=(finite(s.reboundsPer40)||0)*m;lostAst+=(finite(s.assistsPer40)||0)*m;lost3+=(finite(s.threesPer40)||0)*m;
  }
  const active=Object.entries(rosterImpacts).filter(([pid])=>pid!==id&&!unavailablePlayers.some(u=>String(u.playerId||u.id)===pid&&miss(u.status)>=.8));
  const weight=p=>(fam(p.position)===tf?1.55:fam(p.position)==="U"||tf==="U"?1:.68)*Math.max(4,finite(p.skill?.minutes)||12);
  const tw=weight(target),den=tw+active.reduce((s,[,p])=>s+weight(p),0);
  const minutesDelta=den?clamp(lostMinutes*tw/den,0,maxMinutesDelta):0;
  const s=target.skill||{},usage=finite(s.usage)||17,rebs=finite(s.reboundsPer40)||6,asts=finite(s.assistsPer40)||3,threes=finite(s.threesPer40)||1.3;
  const rosterUsage=Object.values(rosterImpacts).reduce((a,p)=>a+(finite(p.skill?.usage)||0),0)||1;
  const usageMultiplier=clamp(1+(lostUsage*clamp(usage/rosterUsage,.03,.38)*.60)/Math.max(usage,8),.92,1.24);
  return {
    playerId:id,minutesDelta:round(minutesDelta),usageMultiplier:round(usageMultiplier),
    pointsMultiplier:round(clamp(.75*usageMultiplier+.25*(1+lost3*Math.max(threes,.4)/(threes+5)*.015),.92,1.22)),
    reboundsMultiplier:round(clamp(1+lostReb*Math.max(rebs,1)/(rebs+12)*.011,.94,1.18)),
    assistsMultiplier:round(clamp(1+lostAst*Math.max(asts,1)/(asts+8)*.014,.94,1.20)),
    threesMultiplier:round(clamp(1+lost3*Math.max(threes,.4)/(threes+5)*.018,.94,1.20)),
    lostTeamMinutes:round(lostMinutes),lostTeamUsage:round(lostUsage),
    unavailableCount:unavailablePlayers.filter(u=>miss(u.status)>0).length,method:"FBIS_WNBA_ROLE_REDISTRIBUTION_v1"
  };
}
export function wnbaLineupModifier({playerId,lineupEffects=[],expectedTeammates=[]}={}){
  const id=String(playerId||""),mates=expectedTeammates.map(String);
  const rs=lineupEffects.filter(x=>{const ids=String(x.key||"").split("|");return ids.includes(id)&&ids.every(x=>x===id||mates.includes(x))});
  if(!rs.length)return{multiplier:1,netDelta:0,samplePossessions:0};
  let n=0,d=0;
  for(const r of rs){const p=finite(r.possessions)||0,v=finite(r.shrunkNet100??r.net100);if(!p||v==null)continue;const w=p/(p+60);n+=v*w*p;d+=w*p}
  const net=d?n/d:0;
  return{multiplier:round(clamp(1+net/260,.95,1.05)),netDelta:round(net),samplePossessions:round(d)};
}
