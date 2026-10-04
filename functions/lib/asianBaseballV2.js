/**
 * Shared market-blind baseball v2 math for NPB/KBO.
 * No sportsbook inputs are accepted by this module.
 */

export function finite(v){ if(v==null||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
export function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
export function round2(v){ return Math.round(Number(v)*100)/100; }
export function round3(v){ return Math.round(Number(v)*1000)/1000; }

function avg(xs, fallback=null){
  const ys=(xs||[]).map(finite).filter(v=>v!=null);
  return ys.length ? ys.reduce((a,b)=>a+b,0)/ys.length : fallback;
}

export function deriveReliefEra(pitchers=[], fallback=4.5){
  const rel=(pitchers||[]).filter(p=>{
    const ipg=finite(p?.ipPerGame ?? (finite(p?.innings)!=null&&finite(p?.games)>0 ? p.innings/p.games : null));
    return ipg!=null && ipg < 3.25 && finite(p?.innings)>0 && finite(p?.era)!=null;
  });
  const innings=rel.reduce((s,p)=>s+(finite(p.innings)||0),0);
  if(innings<=0) return fallback;
  const er=rel.reduce((s,p)=>s+((finite(p.era)||0)*(finite(p.innings)||0)/9),0);
  return er*9/innings;
}

export function estimateParkFactors(history=[], {shrinkGames=200}={}){
  const byVenue=new Map();
  let leagueRuns=0, leagueGames=0;
  for(const g of history||[]){
    const venue=String(g?.venue||"").trim();
    const h=finite(g?.homeRuns), a=finite(g?.awayRuns);
    if(!venue||h==null||a==null) continue;
    const total=h+a;
    leagueRuns+=total; leagueGames++;
    const row=byVenue.get(venue)||{games:0,runs:0};
    row.games++; row.runs+=total; byVenue.set(venue,row);
  }
  const lg=leagueGames ? leagueRuns/leagueGames : null;
  const out={};
  if(!lg) return out;
  for(const [venue,row] of byVenue){
    const raw=(row.runs/row.games)/lg;
    const weight=row.games/(row.games+shrinkGames);
    out[venue]=round3(1+(raw-1)*weight);
  }
  return out;
}

export function teamOffenseFactor(team={}, league={}){
  let score=0, weight=0;
  const add=(v,b,w,scale,direction=1)=>{
    v=finite(v); b=finite(b); if(v==null||b==null||!scale) return;
    score += ((v-b)/scale)*w*direction; weight += Math.abs(w);
  };
  add(team.runsPerGame,league.runsPerGame,.42,0.8,1);
  add(team.ops,league.ops,.20,0.07,1);
  add(team.obp,league.obp,.10,0.03,1);
  add(team.slg,league.slg,.10,0.05,1);
  add(team.bbRate,league.bbRate,.07,0.02,1);
  add(team.kRate,league.kRate,.07,0.03,-1);
  add(team.hrRate,league.hrRate,.04,0.01,1);
  return clamp(1+(weight?score/weight:0)*0.11,.84,1.16);
}

export function preventionFactor(team={}, league={}){
  let score=0,weight=0;
  const add=(v,b,w,scale,direction=1)=>{
    v=finite(v); b=finite(b); if(v==null||b==null||!scale) return;
    score += ((v-b)/scale)*w*direction; weight += Math.abs(w);
  };
  add(team.staffEra ?? team.era, league.staffEra ?? league.era,.58,1.0,1);
  add(team.whip,league.whip,.20,.18,1);
  add(team.oppAvg,league.oppAvg,.12,.025,1);
  const qsRate=finite(team.qs)!=null&&finite(team.games)>0 ? team.qs/team.games : null;
  add(qsRate,league.qsRate,.10,.12,-1);
  return clamp(1+(weight?score/weight:0)*0.10,.86,1.14);
}

export function starterExpectedInnings(starter={}, fallback=5.4){
  const pg=finite(starter.pitchesPerGame), pip=finite(starter.pitchesPerInning);
  if(pg!=null&&pip!=null&&pip>0) return clamp(pg/pip,3.2,7.4);
  const ipg=finite(starter.ipPerGame);
  if(ipg!=null) return clamp(ipg,3.2,7.4);
  if(finite(starter.innings)!=null&&finite(starter.games)>0) return clamp(starter.innings/starter.games,3.2,7.4);
  return clamp(fallback,3.2,7.4);
}

export function starterRunRate(starter={}, leagueEra=4.2){
  let weighted=0, weight=0;
  const add=(rate,w)=>{ rate=finite(rate); if(rate==null)return; weighted+=rate*w; weight+=w; };
  add(starter.era,.58);
  if(finite(starter.oppOps)!=null){
    const ops=finite(starter.oppOps);
    add(leagueEra*clamp(ops/0.75,.65,1.35),.18);
  }
  if(finite(starter.kPer9)!=null){
    add(leagueEra*clamp(7.5/Math.max(3,starter.kPer9),.72,1.30),.14);
  }
  if(finite(starter.bbPer9)!=null){
    add(leagueEra*clamp(starter.bbPer9/3.0,.72,1.35),.10);
  }
  return weight?weighted/weight:leagueEra;
}

export function expectedRuns({
  offense={}, defense={}, starter=null, bullpenEra=null, league={},
  parkFactor=1, lineupFactor=1, recentFactor=1, homeEdge=0,
}={}){
  const lgRuns=finite(league.runsPerGame) ?? 4.5;
  const lgEra=finite(league.era ?? league.staffEra) ?? 4.3;
  const offBase=finite(offense.runsPerGame) ?? lgRuns;
  const defBase=finite(defense.runsAllowedPerGame) ?? lgRuns;
  const base=offBase*.56+defBase*.44;
  const offF=teamOffenseFactor(offense,league);
  const defF=preventionFactor(defense,league);
  const spIp=starter ? starterExpectedInnings(starter,5.4) : 5.0;
  const spRate=starter ? starterRunRate(starter,lgEra) : lgEra;
  const bpRate=finite(bullpenEra) ?? finite(defense.staffEra ?? defense.era) ?? lgEra;
  const pitchingRate=(spRate*spIp + bpRate*(9-spIp))/9;
  const pitchF=clamp(lgEra/Math.max(1.5,pitchingRate),.76,1.30);
  const runs=base*offF*defF*pitchF*clamp(parkFactor,.80,1.25)*clamp(lineupFactor,.82,1.18)*clamp(recentFactor,.88,1.12)+homeEdge;
  return {
    runs:clamp(runs,.6,10.5),
    components:{base:round3(base),offenseFactor:round3(offF),preventionFactor:round3(defF),pitchingFactor:round3(pitchF),starterExpectedInnings:round3(spIp),starterRunRate:round3(spRate),bullpenEra:round3(bpRate),parkFactor:round3(parkFactor),lineupFactor:round3(lineupFactor),recentFactor:round3(recentFactor)}
  };
}

function poissonDist(lambda,maxRuns=18){
  const p=new Array(maxRuns+1).fill(0);
  p[0]=Math.exp(-lambda);
  for(let k=1;k<=maxRuns;k++) p[k]=p[k-1]*lambda/k;
  const s=p.reduce((a,b)=>a+b,0)||1;
  return p.map(x=>x/s);
}

function nbDist(mean,dispersion=10,maxRuns=18){
  const r=Math.max(2,Math.round(dispersion));
  const p=r/(r+Math.max(.01,mean));
  const q=1-p;
  const out=[];
  let comb=1;
  for(let k=0;k<=maxRuns;k++){
    if(k===0) comb=1;
    else comb*= (r+k-1)/k;
    out.push(comb*(p**r)*(q**k));
  }
  const s=out.reduce((a,b)=>a+b,0)||1;
  return out.map(x=>x/s);
}

export function gameDistribution(homeMean,awayMean,{dispersion=10,maxRuns=18}={}){
  const h=dispersion===Infinity?poissonDist(homeMean,maxRuns):nbDist(homeMean,dispersion,maxRuns);
  const a=dispersion===Infinity?poissonDist(awayMean,maxRuns):nbDist(awayMean,dispersion,maxRuns);
  let hw=0,aw=0,tie=0,hRL=0,totalMean=0;
  const totals=new Array(maxRuns*2+1).fill(0);
  for(let i=0;i<h.length;i++) for(let j=0;j<a.length;j++){
    const pr=h[i]*a[j];
    totalMean+=(i+j)*pr;
    totals[i+j]=(totals[i+j]||0)+pr;
    if(i>j) hw+=pr; else if(i<j) aw+=pr; else tie+=pr;
    if(i-j>=2) hRL+=pr;
  }
  const decisive=hw+aw;
  return {
    pHomeWin:round3(decisive?hw/decisive:.5),
    pAwayWin:round3(decisive?aw/decisive:.5),
    pTie:round3(tie),
    pHomeMinus1_5:round3(hRL),
    pAwayPlus1_5:round3(1-hRL),
    totalMean:round2(totalMean),
    totalDistribution:totals.map(round3),
  };
}

export function totalProbability(dist,line,side="over"){
  const n=finite(line); if(n==null||!Array.isArray(dist?.totalDistribution)) return null;
  let p=0;
  for(let t=0;t<dist.totalDistribution.length;t++){
    if(side==="over" && t>n) p+=dist.totalDistribution[t];
    if(side==="under" && t<n) p+=dist.totalDistribution[t];
  }
  return round3(p);
}

export function pitcherKProjection(starter, opponent={}, league={}){
  if(!starter||finite(starter.kPer9)==null) return null;
  const ip=starterExpectedInnings(starter,5.3);
  const lgK=finite(league.kRate) ?? .20;
  const oppK=finite(opponent.kRate);
  const factor=oppK!=null&&lgK>0?clamp(oppK/lgK,.78,1.24):1;
  const mean=finite(starter.kPer9)/9*ip*factor;
  const dist=poissonDist(mean,16);
  return {
    projection:round2(mean),
    expectedInnings:round2(ip),
    kPer9:round2(starter.kPer9),
    opponentKRate:oppK,
    distribution:dist.map(round3),
    probabilityAtLeast(k){ return round3(dist.slice(Math.max(0,Math.ceil(k))).reduce((a,b)=>a+b,0)); }
  };
}

export function leagueAverages(teams={}){
  const vals=Object.values(teams||{});
  const av=(k,d)=>avg(vals.map(x=>x?.[k]),d);
  return {
    runsPerGame:av("runsPerGame",4.5),
    runsAllowedPerGame:av("runsAllowedPerGame",4.5),
    ops:av("ops",.75),obp:av("obp",.34),slg:av("slg",.41),
    kRate:av("kRate",.20),bbRate:av("bbRate",.085),hrRate:av("hrRate",.025),
    era:av("era",av("staffEra",4.3)),staffEra:av("staffEra",av("era",4.3)),
    whip:av("whip",1.38),oppAvg:av("oppAvg",.265),
    qsRate:null,
  };
}
