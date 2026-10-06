#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/wnba-canonical.jsonl";
const statesFile=args.states||"artifacts/wnba-possession-state.jsonl";
const stintsFile=args.stints||"artifacts/wnba-lineup-stints.jsonl";
const out=args.out||"artifacts/wnba-possession-ablation.json";
const rowsOut=args.rows||"artifacts/wnba-possession-ablation-rows.jsonl";
const minTeamGames=Number(args.minTeamGames||4),minTrain=Number(args.minTrain||80),lambda=Number(args.lambda||25);
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const mae=xs=>mean(xs.map(Math.abs));
const normCdf=x=>{const z=Math.abs(x)/Math.sqrt(2),t=1/(1+0.3275911*z);const erf=1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-z*z);return .5*(1+(x<0?-erf:erf))};
const seasonOf=g=>String(g.start||g.date||"").slice(0,4);
const weighted=(rows,key,halfLife=8)=>{
  let n=0,d=0;const a=[...rows].sort((x,y)=>Date.parse(y.date)-Date.parse(x.date));
  for(let i=0;i<a.length;i++){const v=finite(a[i]?.[key]);if(v==null)continue;const w=Math.pow(.5,i/halfLife);n+=v*w;d+=w}
  return d?n/d:null;
};

const games=read(gamesFile).sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const states=read(statesFile),stints=read(stintsFile);
const stateBy=new Map(states.map(x=>[String(x.gameId||x.id),x]));
const gameBy=new Map(games.map(x=>[String(x.id),x]));

function canonicalTeamRow(g,teamId,oppId,side){
  const t=side==="home"?g.home:g.away,score=side==="home"?g.homeScore:g.awayScore,oppScore=side==="home"?g.awayScore:g.homeScore;
  const poss=finite(t?.possessions??g.possessions);
  return {
    date:g.start||g.date,gameId:String(g.id),teamId:String(teamId),oppId:String(oppId),
    score:finite(score),oppScore:finite(oppScore),poss,
    ortg:poss?100*finite(score)/poss:null,drtg:poss?100*finite(oppScore)/poss:null,pace:finite(g.possessions),
  };
}
function stateTeamRow(g,teamId,oppId){
  const s=stateBy.get(String(g.id)),t=s?.teams?.[String(teamId)],o=s?.teams?.[String(oppId)];
  if(!t)return {};
  const gameState=t.gameState||{};
  const closePoss=(finite(gameState.close?.possessions)||0)+(finite(gameState.clutch?.possessions)||0);
  const closePts=(finite(gameState.close?.points)||0)+(finite(gameState.clutch?.points)||0);
  return {
    efg:finite(t.efgPct),rimRate:finite(t.rimRate),rimPct:finite(t.rimPct),
    paintRate:finite(t.paintRate),paintPct:finite(t.paintPct),
    midRate:finite(t.midrangeRate),midPct:finite(t.midrangePct),
    threeRate:finite(t.threeRate),threePct:finite(t.threePct),
    tov:finite(t.turnoverPct),orb:finite(t.orb)&&finite(t.possessions)?finite(t.orb)/finite(t.possessions):null,
    ftr:finite(t.ftRate),transition:finite(t.transitionProxyRate),
    early:finite(t.early?.fgPct),middle:finite(t.middle?.fgPct),late:finite(t.late?.fgPct),
    closeOrtg:closePoss?100*closePts/closePoss:null,
    oppEfg:finite(o?.efgPct),oppRimRate:finite(o?.rimRate),oppRimPct:finite(o?.rimPct),
    oppPaintRate:finite(o?.paintRate),oppPaintPct:finite(o?.paintPct),
    oppMidRate:finite(o?.midrangeRate),oppMidPct:finite(o?.midrangePct),
    oppThreeRate:finite(o?.threeRate),oppThreePct:finite(o?.threePct),
    oppTov:finite(o?.turnoverPct),oppOrb:finite(o?.orb)&&finite(o?.possessions)?finite(o.orb)/finite(o.possessions):null,
    oppFtr:finite(o?.ftRate),oppTransition:finite(o?.transitionProxyRate),
  };
}

const stintTeamObs=[];
for(const s of stints){
  const poss=finite(s.possessions),diff=finite(s.pointDifferential),date=s.date;
  if(!poss||diff==null||!date)continue;
  stintTeamObs.push({date,teamId:String(s.homeTeamId),net100:100*diff/poss,poss});
  stintTeamObs.push({date,teamId:String(s.awayTeamId),net100:-100*diff/poss,poss});
}
function lineupNet(teamId,before){
  const cutoff=Date.parse(before),xs=stintTeamObs.filter(x=>x.teamId===String(teamId)&&Date.parse(x.date)<cutoff).slice(-80);
  let n=0,d=0;for(const x of xs){const w=Math.min(50,x.poss)/(Math.min(50,x.poss)+25);n+=x.net100*w*x.poss;d+=w*x.poss}
  return d?n/d:null;
}

function leagueProfile(rows=[]){
  return {
    ortg:clamp(mean(rows.map(r=>finite(r.ortg)))??101.5,92,112),
    pace:clamp(mean(rows.map(r=>finite(r.pace)))??79.5,72,86)
  };
}
function teamIncumbentProfile(rows,league){
  const rs=[...rows].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,14),n=rs.length;
  if(!n)return null;
  const shrink=n/(n+6);
  const avg=(key,prior)=>{let num=0,den=0;for(let i=0;i<rs.length;i++){const v=finite(rs[i][key]);if(v==null)continue;const w=Math.pow(.90,i);num+=v*w;den+=w}const x=den?num/den:prior;return x*shrink+prior*(1-shrink)};
  return {games:n,ortg:avg("ortg",league.ortg),drtg:avg("drtg",league.ortg),pace:avg("pace",league.pace)};
}
function incumbentGame(h,a,league,neutral=false){
  const pace=clamp((h.pace+a.pace+league.pace)/3,72,86);
  const he=clamp((h.ortg+a.drtg+league.ortg)/3,88,116),ae=clamp((a.ortg+h.drtg+league.ortg)/3,88,116);
  const hfa=neutral?0:2.1,home=clamp(pace*he/100+hfa/2,58,112),away=clamp(pace*ae/100-hfa/2,58,112);
  return {home,away,margin:home-away,total:home+away,pace};
}
function recent(teamRows,key){return weighted(teamRows,key,8)}
function matchupSignal(h,a,key,oppKey){
  const he=mean([recent(h,key),recent(a,oppKey)]),ae=mean([recent(a,key),recent(h,oppKey)]);
  return {margin:he==null||ae==null?null:he-ae,total:he==null||ae==null?null:he+ae};
}
function compositeShotSignal(h,a){
  const shot=(rows,prefix="")=>{
    const k=name=>prefix?prefix+name[0].toUpperCase()+name.slice(1):name;
    const rr=recent(rows,k("rimRate")),rp=recent(rows,k("rimPct")),pr=recent(rows,k("paintRate")),pp=recent(rows,k("paintPct")),
      mr=recent(rows,k("midRate")),mp=recent(rows,k("midPct")),tr=recent(rows,k("threeRate")),tp=recent(rows,k("threePct"));
    if([rr,rp,pr,pp,mr,mp,tr,tp].some(x=>x==null))return null;
    return rr*rp+pr*pp+mr*mp+1.5*tr*tp;
  };
  const he=mean([shot(h),shot(a,"opp")]),ae=mean([shot(a),shot(h,"opp")]);
  return {margin:he==null||ae==null?null:he-ae,total:he==null||ae==null?null:he+ae};
}

const GAME_FAMILIES={
  pace:(h,a,ctx)=>({margin:(recent(h,"reconPace")??0)-(recent(a,"reconPace")??0),total:mean([recent(h,"reconPace"),recent(a,"reconPace")])-(ctx.leagueReconPace??0)}),
  efg:(h,a)=>matchupSignal(h,a,"efg","oppEfg"),
  rim_rate:(h,a)=>matchupSignal(h,a,"rimRate","oppRimRate"),
  rim_efficiency:(h,a)=>matchupSignal(h,a,"rimPct","oppRimPct"),
  paint_rate:(h,a)=>matchupSignal(h,a,"paintRate","oppPaintRate"),
  paint_efficiency:(h,a)=>matchupSignal(h,a,"paintPct","oppPaintPct"),
  midrange_rate:(h,a)=>matchupSignal(h,a,"midRate","oppMidRate"),
  midrange_efficiency:(h,a)=>matchupSignal(h,a,"midPct","oppMidPct"),
  three_rate:(h,a)=>matchupSignal(h,a,"threeRate","oppThreeRate"),
  three_efficiency:(h,a)=>matchupSignal(h,a,"threePct","oppThreePct"),
  opponent_shot_profile:(h,a)=>compositeShotSignal(h,a),
  turnover:(h,a)=>matchupSignal(h,a,"tov","oppTov"),
  offensive_rebounding:(h,a)=>matchupSignal(h,a,"orb","oppOrb"),
  free_throw_rate:(h,a)=>matchupSignal(h,a,"ftr","oppFtr"),
  transition_proxy:(h,a)=>matchupSignal(h,a,"transition","oppTransition"),
  possession_phase:(h,a)=>{
    const he=mean([recent(h,"early"),recent(h,"middle"),recent(h,"late")]),ae=mean([recent(a,"early"),recent(a,"middle"),recent(a,"late")]);
    return {margin:he==null||ae==null?null:he-ae,total:he==null||ae==null?null:he+ae};
  },
  game_state:(h,a)=>({margin:(recent(h,"closeOrtg")??0)-(recent(a,"closeOrtg")??0),total:mean([recent(h,"closeOrtg"),recent(a,"closeOrtg")])}),
  lineup_strength:(h,a,ctx)=>({margin:(ctx.homeLineupNet??0)-(ctx.awayLineupNet??0),total:mean([ctx.homeLineupNet,ctx.awayLineupNet])}),
};

function ridgePredict(train,x,key,lam=lambda){
  const usable=train.map(r=>({x:finite(r[key+"Signal"]),y:finite(r[key+"Residual"])})).filter(r=>r.x!=null&&r.y!=null);
  if(usable.length<minTrain||x==null)return null;
  const mx=mean(usable.map(r=>r.x)),my=mean(usable.map(r=>r.y));
  let num=0,den=lam;for(const r of usable){num+=(r.x-mx)*(r.y-my);den+=(r.x-mx)**2}
  const b=den?num/den:0,a=my-b*mx;
  return a+b*x;
}
function summarizeGame(rows,family){
  const rs=rows.filter(r=>finite(r[family+"Margin"])!=null&&finite(r[family+"Total"])!=null);
  const bM=mae(rs.map(r=>r.actualMargin-r.baseMargin)),cM=mae(rs.map(r=>r.actualMargin-r[family+"Margin"]));
  const bT=mae(rs.map(r=>r.actualTotal-r.baseTotal)),cT=mae(rs.map(r=>r.actualTotal-r[family+"Total"]));
  const marginBrier=mean(rs.map(r=>{const p=normCdf(r[family+"Margin"]/10.2),y=r.actualMargin>0?1:0;return (p-y)**2}));
  const baseBrier=mean(rs.map(r=>{const p=normCdf(r.baseMargin/10.2),y=r.actualMargin>0?1:0;return (p-y)**2}));
  const margin1=mean(rs.map(r=>Math.abs(r.actualMargin-r[family+"Margin"])<=10.2?1:0));
  const total1=mean(rs.map(r=>Math.abs(r.actualTotal-r[family+"Total"])<=12.1?1:0));
  const marginDelta=cM==null||bM==null?null:cM-bM,totalDelta=cT==null||bT==null?null:cT-bT;
  let decision="INCONCLUSIVE";
  if(rs.length>=200&&marginDelta!=null&&totalDelta!=null){
    if((marginDelta<=-0.05||totalDelta<=-0.08)&&marginDelta<=0.05&&totalDelta<=0.08)decision="KEEP";
    else if(marginDelta>=0.08&&totalDelta>=0.10)decision="REJECT";
  }
  return {family,n:rs.length,baselineMarginMae:bM,challengerMarginMae:cM,marginMaeDelta:marginDelta,baselineTotalMae:bT,challengerTotalMae:cT,totalMaeDelta:totalDelta,baselineWinnerBrier:baseBrier,challengerWinnerBrier:marginBrier,marginWithin1Sigma:margin1,totalWithin1Sigma:total1,decision};
}

const teamHist=new Map(),allTeamRows=[],gameRows=[];
for(const g of games){
  const before=g.start||g.date,homeId=String(g.homeId),awayId=String(g.awayId),hHist=teamHist.get(homeId)||[],aHist=teamHist.get(awayId)||[];
  const league=leagueProfile(allTeamRows);
  const hp=teamIncumbentProfile(hHist,league),ap=teamIncumbentProfile(aHist,league);
  if(hp&&ap&&hHist.length>=minTeamGames&&aHist.length>=minTeamGames){
    const base=incumbentGame(hp,ap,league,Boolean(g.neutralSite)),actualMargin=finite(g.homeScore)-finite(g.awayScore),actualTotal=finite(g.homeScore)+finite(g.awayScore);
    const ctx={homeLineupNet:lineupNet(homeId,before),awayLineupNet:lineupNet(awayId,before),leagueReconPace:weighted(allTeamRows,"reconPace",20)};
    const row={gameId:String(g.id),date:before,season:seasonOf(g),homeId,awayId,actualMargin,actualTotal,baseMargin:base.margin,baseTotal:base.total};
    for(const [family,fn] of Object.entries(GAME_FAMILIES)){
      const sig=fn(hHist,aHist,ctx)||{};
      const train=gameRows;
      const mc=ridgePredict(train,finite(sig.margin),family+"Margin"),tc=ridgePredict(train,finite(sig.total),family+"Total");
      row[family+"MarginSignal"]=finite(sig.margin);row[family+"TotalSignal"]=finite(sig.total);
      row[family+"MarginResidual"]=actualMargin-base.margin;row[family+"TotalResidual"]=actualTotal-base.total;
      row[family+"Margin"]=mc==null?null:base.margin+mc;row[family+"Total"]=tc==null?null:base.total+tc;
    }
    gameRows.push(row);
  }
  const state=stateBy.get(String(g.id));
  for(const [teamId,oppId,side] of [[homeId,awayId,"home"],[awayId,homeId,"away"]]){
    const baseRow=canonicalTeamRow(g,teamId,oppId,side),sr=stateTeamRow(g,teamId,oppId);
    const reconPoss=finite(state?.teams?.[teamId]?.possessions);
    const row={...baseRow,...sr,reconPace:reconPoss};
    if(!teamHist.has(teamId))teamHist.set(teamId,[]);
    teamHist.get(teamId).push(row);allTeamRows.push(row);
  }
}

const gameEvidence=Object.keys(GAME_FAMILIES).map(f=>summarizeGame(gameRows,f));
gameEvidence.unshift({
  family:"offensive_defensive_efficiency",
  n:gameRows.length,
  decision:"REJECT",
  reason:"DEDUPLICATE: recency-weighted ORtg/DRtg are already incumbent WNBA-FBIS-v2 inputs; reconstructing the same statistic from the same boxes is not an independent feature."
});

function playerGameEnrich(g,p){
  const teamId=String(p.teamId||""),oppId=teamId===String(g.homeId)?String(g.awayId):String(g.homeId);
  const teamPlayers=(g.players||[]).filter(x=>String(x.teamId)===teamId),team=teamId===String(g.homeId)?g.home:g.away,opp=teamId===String(g.homeId)?g.away:g.home;
  const teamFgm=teamPlayers.reduce((s,x)=>s+(finite(x.fgm)||0),0),oppMiss=(finite(opp?.fga)||0)-(finite(opp?.fgm)||0);
  const poss=finite(g.possessions),mins=finite(p.minutes);
  return {...p,date:g.start||g.date,teamId,oppId,teamPossessions:poss,
    usageProxy:poss&&mins?((finite(p.fga)||0)+.44*(finite(p.fta)||0)+(finite(p.turnovers)||0))/(poss*(mins/40)):null,
    fgaPerMin:mins?(finite(p.fga)||0)/mins:null,tpaPerMin:mins?(finite(p.tpa)||0)/mins:null,
    reboundOpportunity:oppMiss>0?(finite(p.rebounds)||0)/oppMiss:null,
    assistOpportunity:teamFgm>0?(finite(p.assists)||0)/teamFgm:null,
  };
}
function propPrior(m){return {points:8.5,rebounds:3.5,assists:2,three_pointers_made:.7}[m]??0}
function incumbentPlayerProjection(history,market,baseGame,side){
  const season=seasonOf({start:baseGame.date}),h=history.filter(x=>seasonOf({start:x.date})===season),games=h.length;if(games<2)return null;
  const minutes=clamp(mean(h.map(x=>finite(x.minutes)))??24,8,40),reliability=games/(games+8);
  const key={points:"points",rebounds:"rebounds",assists:"assists",three_pointers_made:"threes"}[market],observed=mean(h.map(x=>finite(x[key])));
  if(observed==null)return null;
  const rolePrior=propPrior(market)*(minutes/24),blended=observed*reliability+rolePrior*(1-reliability);
  const score=side==="home"?baseGame.baseHome:baseGame.baseAway,scoreEnv=score==null?1:clamp(score/82,.84,1.18),paceEnv=clamp(baseGame.basePace/79.5,.90,1.10);
  const env=clamp(Math.pow(scoreEnv,.58)*Math.pow(paceEnv,.42),.88,1.13),minuteStability=clamp(.90+minutes/320,.92,1.04);
  return blended*env*minuteStability;
}
const PROP_FAMILIES={
  projected_minutes:(h)=>weighted(h,"minutes",4)-(mean(h.map(x=>finite(x.minutes)))??0),
  usage:(h)=>weighted(h,"usageProxy",6)-(mean(h.map(x=>finite(x.usageProxy)))??0),
  shot_attempt_rate:(h)=>weighted(h,"fgaPerMin",6)-(mean(h.map(x=>finite(x.fgaPerMin)))??0),
  three_attempt_rate:(h)=>weighted(h,"tpaPerMin",6)-(mean(h.map(x=>finite(x.tpaPerMin)))??0),
  rebound_opportunity:(h)=>weighted(h,"reboundOpportunity",6)-(mean(h.map(x=>finite(x.reboundOpportunity)))??0),
  assist_opportunity:(h)=>weighted(h,"assistOpportunity",6)-(mean(h.map(x=>finite(x.assistOpportunity)))??0),
  lineup_context:(h,ctx)=>finite(ctx.playerLineupNet),
  opponent_shot_rebound_profile:(h,ctx)=>finite(ctx.oppReboundEnvironment),
  pace_possession_expectation:(h,ctx)=>finite(ctx.reconPaceDelta),
};
function playerLineupNet(playerId,before){
  const cutoff=Date.parse(before);let n=0,d=0;
  for(const s of stints){
    if(Date.parse(s.date)>=cutoff)continue;
    const poss=finite(s.possessions),diff=finite(s.pointDifferential);if(!poss||diff==null)continue;
    let sign=0;if((s.homePlayers||[]).map(String).includes(String(playerId)))sign=1;else if((s.awayPlayers||[]).map(String).includes(String(playerId)))sign=-1;
    if(!sign)continue;const w=poss/(poss+20);n+=sign*100*diff/poss*w*poss;d+=w*poss;
  }
  return d?n/d:null;
}
const playerHist=new Map(),propRows=[];
for(const g of games){
  const gRow=gameRows.find(r=>r.gameId===String(g.id));
  let baseGame=null;
  if(gRow){
    const hp=(teamHist.get(String(g.homeId))||[]).filter(x=>Date.parse(x.date)<Date.parse(g.start||g.date));
    const ap=(teamHist.get(String(g.awayId))||[]).filter(x=>Date.parse(x.date)<Date.parse(g.start||g.date));
    const league=leagueProfile(allTeamRows.filter(x=>Date.parse(x.date)<Date.parse(g.start||g.date)));
    const ih=teamIncumbentProfile(hp,league),ia=teamIncumbentProfile(ap,league);
    if(ih&&ia){const b=incumbentGame(ih,ia,league,Boolean(g.neutralSite));baseGame={date:g.start||g.date,baseHome:b.home,baseAway:b.away,basePace:b.pace}}
  }
  for(const p of g.players||[]){
    const id=String(p.id||p.name||""),hist=playerHist.get(id)||[],side=String(p.teamId)===String(g.homeId)?"home":"away";
    if(baseGame&&hist.length>=2&&finite(p.minutes)>0){
      const oppId=side==="home"?String(g.awayId):String(g.homeId),oppHist=(teamHist.get(oppId)||[]).filter(x=>Date.parse(x.date)<Date.parse(g.start||g.date));
      const ownHist=(teamHist.get(String(p.teamId))||[]).filter(x=>Date.parse(x.date)<Date.parse(g.start||g.date));
      const ctx={
        playerLineupNet:playerLineupNet(id,g.start||g.date),
        oppReboundEnvironment:weighted(oppHist,"oppOrb",8),
        reconPaceDelta:(mean([weighted(ownHist,"reconPace",8),weighted(oppHist,"reconPace",8)])??baseGame.basePace)-baseGame.basePace,
      };
      for(const [market,key] of [["points","points"],["rebounds","rebounds"],["assists","assists"],["three_pointers_made","threes"]]){
        const actual=finite(p[key]),base=incumbentPlayerProjection(hist,market,baseGame,side);if(actual==null||base==null)continue;
        const row={gameId:String(g.id),date:g.start||g.date,season:seasonOf(g),playerId:id,playerName:p.name,market,actual,base};
        for(const [family,fn] of Object.entries(PROP_FAMILIES)){
          const sig=finite(fn(hist,ctx)),train=propRows.filter(x=>x.market===market);
          const pred=ridgePredict(train,sig,family+"Prop");
          row[family+"PropSignal"]=sig;row[family+"PropResidual"]=actual-base;row[family+"Prop"]=pred==null?null:base+pred;
        }
        propRows.push(row);
      }
    }
    if(id){if(!playerHist.has(id))playerHist.set(id,[]);playerHist.get(id).push(playerGameEnrich(g,p))}
  }
}
function summarizeProp(family){
  const markets={};let improve=0,regress=0,eligible=0;
  for(const m of ["points","rebounds","assists","three_pointers_made"]){
    const rs=propRows.filter(r=>r.market===m&&finite(r[family+"Prop"])!=null),b=mae(rs.map(r=>r.actual-r.base)),c=mae(rs.map(r=>r.actual-r[family+"Prop"])),d=b==null||c==null?null:c-b;
    markets[m]={n:rs.length,baselineMae:b,challengerMae:c,maeDelta:d,relativeImprovement:b&&d!=null?-d/b:null};
    if(rs.length>=300&&d!=null){eligible++;if(d<=-0.02)improve++;if(d>=0.03)regress++}
  }
  let decision="INCONCLUSIVE";
  if(eligible>=3&&improve>=3&&regress===0)decision="KEEP";
  else if(eligible>=3&&regress>=3)decision="REJECT";
  return {family,markets,decision};
}
const propEvidence=Object.keys(PROP_FAMILIES).map(summarizeProp);
propEvidence.push({family:"teammate_availability_redistribution",markets:{},decision:"PROSPECTIVE SHADOW ONLY",reason:"Historical point-in-time approved availability observations are not sufficiently complete to reconstruct this feature without retrospective leakage."});

const report={
  generatedAt:new Date().toISOString(),
  methodology:{
    gameBaseline:"WNBA-FBIS-v2 recreated from prior canonical boxes with identical 14-game recency, shrinkage, matchup and HFA formula.",
    propBaseline:"WNBA-PLAYER-PROJ-v2 recreated point-in-time from season-to-date player games with identical reliability, role prior, pace/score environment and minute-stability formula.",
    challenger:"Each feature family is fit separately as an expanding-window ridge residual correction using only earlier outcomes. No closing line or target-game market data enters features.",
    minTrain,lambda,
  },
  coverage:{games:games.length,states:states.length,stints:stints.length,gameAblationRows:gameRows.length,propAblationRows:propRows.length,seasons:[...new Set(games.map(seasonOf))]},
  gameEvidence,propEvidence,
  marketEconomics:{status:"NOT_EVALUATED_IN_THIS_ARTIFACT",reason:"Requires immutable point-in-time line/price joins. No closing/final-summary proxy is allowed as a decision-time input."},
  governance:{productionGameModelChanged:false,productionPlayerModelChanged:false,autoPromote:false,requiresProspectiveValidation:true},
};
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(rowsOut,[...gameRows.map(r=>JSON.stringify({kind:"game",...r})),...propRows.map(r=>JSON.stringify({kind:"prop",...r}))].join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
