/**
 * TENNIS-FBIS-v1 / TENNIS-PLAYER-v1
 *
 * Independent research model. Market prices/PrizePicks lines are comparison inputs
 * only and never enter the projection. The model works from serve/return point
 * strength, surface Elo and match format, then simulates actual tennis scoring.
 */

export const TENNIS_MATCH_MODEL_ID = "TENNIS-FBIS-v1";
export const TENNIS_PLAYER_MODEL_ID = "TENNIS-PLAYER-v1";
export const TENNIS_MODEL_VERSION = "v1-point-game-set-match-mc";
export const TENNIS_MATURITY = "RESEARCH";\nimport { validateTennisProjectionProfile, noValidTennisProjection } from "./tennisPlayerDataIntegrity.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const stdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const round=(v,d=4)=>{const p=10**d;return Math.round(v*p)/p;};

function hashSeed(value){
  let h=2166136261;
  for(const ch of String(value||"tennis")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function rng(seed){
  let x=seed>>>0||1;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
}
function playerKey(p={}){return String(p.id||p.playerId||p.name||"player");}
function surfaceKey(raw){
  const s=String(raw||"hard").toLowerCase();
  if(s.includes("clay"))return "clay";
  if(s.includes("grass"))return "grass";
  return "hard";
}
function eloFor(p={},surface="hard"){
  const s=surfaceKey(surface);
  return finite(p?.surfaceElo?.[s]??p?.[s+"Elo"]??p?.surfaceElo??p?.elo??1500)??1500;
}
function pointPct(v,fallback){
  const n=finite(v);
  if(n==null)return fallback;
  return n>1?n/100:n;
}

export function estimateServePointWin(server={},receiver={},context={}){
  const matchupOverride=finite(server.matchupServePointWinPct);
  if(matchupOverride!=null)return clamp(matchupOverride,0.46,0.79);
  const surface=surfaceKey(context.surface);
  const serverServe=pointPct(server.servePointWinPct??server.servicePointsWonPct,0.62);
  const receiverReturn=pointPct(receiver.returnPointWinPct??receiver.returnPointsWonPct,0.37);
  const matchupBase=(serverServe+(1-receiverReturn))/2;
  const eloDelta=eloFor(server,surface)-eloFor(receiver,surface);
  const eloAdj=clamp(eloDelta/4000,-0.045,0.045);
  const recent=finite(server.recentFormAdjustment)??0;
  const fatigue=finite(server.fatigueAdjustment)??0;
  return clamp(matchupBase+eloAdj+recent+fatigue,0.46,0.79);
}

export function holdProbability(p){
  p=clamp(Number(p),0.001,0.999);
  const q=1-p;
  const winBeforeDeuce=p**4*(1+4*q+10*q*q);
  const reachDeuce=20*p**3*q**3;
  const winFromDeuce=(p*p)/(p*p+q*q);
  return winBeforeDeuce+reachDeuce*winFromDeuce;
}

function eventRate(v,fallback=0){
  const n=finite(v);
  if(n==null)return fallback;
  return clamp(n>1?n/100:n,0,0.5);
}

function playPoint(serverIdx,profiles,R,stats,{isBreakPoint=false}={}){
  const s=profiles[serverIdx],r=profiles[1-serverIdx];
  stats[serverIdx].servicePoints++;
  if(R()<s.aceRate){stats[serverIdx].aces++;return serverIdx;}
  if(R()<s.doubleFaultRate){stats[serverIdx].doubleFaults++;if(isBreakPoint)stats[1-serverIdx].breakPointsWon++;return 1-serverIdx;}
  const winner=R()<s.pServe?serverIdx:1-serverIdx;
  if(isBreakPoint&&winner===1-serverIdx)stats[1-serverIdx].breakPointsWon++;
  return winner;
}

function playGame(serverIdx,profiles,R,stats){
  let a=0,b=0;
  while(true){
    const receiver=1-serverIdx;
    const isBreakPoint=receiver===0 ? (a>=3&&a>b) : (b>=3&&b>a);
    const w=playPoint(serverIdx,profiles,R,stats,{isBreakPoint});
    if(w===0)a++;else b++;
    if((a>=4||b>=4)&&Math.abs(a-b)>=2)return a>b?0:1;
  }
}

function playTiebreak(firstServer,profiles,R,stats){
  let pts=[0,0],n=0;
  while(true){
    let server;
    if(n===0)server=firstServer;
    else{
      const block=Math.floor((n-1)/2);
      server=(firstServer+1+(block%2))%2;
    }
    const w=playPoint(server,profiles,R,stats);
    pts[w]++;n++;
    if((Math.max(...pts)>=7)&&Math.abs(pts[0]-pts[1])>=2)return pts[0]>pts[1]?0:1;
  }
}

function playSet(firstServer,profiles,R,stats){
  let games=[0,0],server=firstServer,tiebreaks=0;
  while(true){
    if(games[0]===6&&games[1]===6){
      const w=playTiebreak(server,profiles,R,stats);
      games[w]++;tiebreaks++;
      return {winner:w,games,nextServer:(server+1)%2,tiebreaks};
    }
    const w=playGame(server,profiles,R,stats);
    games[w]++;server=(server+1)%2;
    if(Math.max(...games)>=6&&Math.abs(games[0]-games[1])>=2)return {winner:games[0]>games[1]?0:1,games,nextServer:server,tiebreaks};
  }
}

function profile(server,receiver,context){
  return {
    pServe:estimateServePointWin(server,receiver,context),
    aceRate:eventRate(server.aceRate??server.acePct,0.06),
    doubleFaultRate:eventRate(server.doubleFaultRate??server.doubleFaultPct,0.035),
  };
}

function oneMatch(player1,player2,context,R){
  const bestOf=Number(context.bestOf)===5?5:3;
  const setsToWin=Math.ceil(bestOf/2);
  const profiles=[profile(player1,player2,context),profile(player2,player1,context)];
  const stats=[
    {gamesWon:0,setsWon:0,aces:0,doubleFaults:0,breakPointsWon:0,servicePoints:0},
    {gamesWon:0,setsWon:0,aces:0,doubleFaults:0,breakPointsWon:0,servicePoints:0},
  ];
  let firstServer=R()<0.5?0:1,totalGames=0,totalSets=0,tieBreaks=0;
  while(stats[0].setsWon<setsToWin&&stats[1].setsWon<setsToWin){
    const set=playSet(firstServer,profiles,R,stats);
    stats[set.winner].setsWon++;
    stats[0].gamesWon+=set.games[0];stats[1].gamesWon+=set.games[1];
    totalGames+=set.games[0]+set.games[1];totalSets++;tieBreaks+=set.tiebreaks;
    firstServer=set.nextServer;
  }
  const winner=stats[0].setsWon>stats[1].setsWon?0:1;
  for(let i=0;i<2;i++){
    const j=1-i;
    stats[i].fantasyScore=10+(stats[i].gamesWon-stats[j].gamesWon)+
      3*(stats[i].setsWon-stats[j].setsWon)+0.5*stats[i].aces-0.5*stats[i].doubleFaults;
  }
  return {winner,totalGames,totalSets,tieBreaks,players:stats};
}

function summarize(values){
  return {mean:round(mean(values),3),sigma:round(stdev(values),3),min:Math.min(...values),max:Math.max(...values)};
}
function probabilityOver(values,line){
  if(line==null||!Number.isFinite(Number(line)))return null;
  return round(values.filter(x=>x>Number(line)).length/values.length,4);
}

export function simulateTennisMatch(game={},ctx={},opts={}){
  const player1=game.player1||game.home||game.a||{};
  const player2=game.player2||game.away||game.b||{};
  const context={
    surface:game.surface||ctx.surface||"hard",
    bestOf:game.bestOf||ctx.bestOf||3,
  };
  const requested=Number(opts.simulations||ctx.simulations||8000);
  const simulationFloor=opts.researchBacktest===true?100:1000;
  const simulations=Math.max(simulationFloor,Math.min(50000,requested));
  const R=rng(hashSeed(opts.seed??game.id??[playerKey(player1),playerKey(player2),context.surface].join("|")));
  const outcomes=[];
  for(let i=0;i<simulations;i++)outcomes.push(oneMatch(player1,player2,context,R));
  const p1Win=outcomes.filter(x=>x.winner===0).length/simulations;
  const p2Win=1-p1Win;
  const p1=outcomes.map(x=>x.players[0]),p2=outcomes.map(x=>x.players[1]);
  const metric=(arr,key)=>summarize(arr.map(x=>x[key]));
  return {
    ok:true,
    modelId:TENNIS_MATCH_MODEL_ID,
    modelVersion:TENNIS_MODEL_VERSION,
    maturity:TENNIS_MATURITY,
    independent:true,
    marketInformed:false,
    canQualify:false,
    canAuthorizeWager:false,
    simulations,
    surface:context.surface,
    bestOf:context.bestOf,
    players:[
      {id:playerKey(player1),name:player1.name||null,pWin:round(p1Win,4),...profile(player1,player2,context)},
      {id:playerKey(player2),name:player2.name||null,pWin:round(p2Win,4),...profile(player2,player1,context)},
    ],
    match:{
      pPlayer1Win:round(p1Win,4),
      pPlayer2Win:round(p2Win,4),
      totalGames:summarize(outcomes.map(x=>x.totalGames)),
      totalSets:summarize(outcomes.map(x=>x.totalSets)),
      tieBreaks:summarize(outcomes.map(x=>x.tieBreaks)),
    },
    playerMetrics:[
      {
        total_games_won:metric(p1,"gamesWon"),aces:metric(p1,"aces"),double_faults:metric(p1,"doubleFaults"),
        break_points_won:metric(p1,"breakPointsWon"),fantasy_score:metric(p1,"fantasyScore"),
      },
      {
        total_games_won:metric(p2,"gamesWon"),aces:metric(p2,"aces"),double_faults:metric(p2,"doubleFaults"),
        break_points_won:metric(p2,"breakPointsWon"),fantasy_score:metric(p2,"fantasyScore"),
      }
    ],
    distributions:{
      totalGames:outcomes.map(x=>x.totalGames),
      totalSets:outcomes.map(x=>x.totalSets),
      tieBreaks:outcomes.map(x=>x.tieBreaks),
      players:[
        {
          total_games_won:p1.map(x=>x.gamesWon),aces:p1.map(x=>x.aces),double_faults:p1.map(x=>x.doubleFaults),
          break_points_won:p1.map(x=>x.breakPointsWon),fantasy_score:p1.map(x=>x.fantasyScore),
        },
        {
          total_games_won:p2.map(x=>x.gamesWon),aces:p2.map(x=>x.aces),double_faults:p2.map(x=>x.doubleFaults),
          break_points_won:p2.map(x=>x.breakPointsWon),fantasy_score:p2.map(x=>x.fantasyScore),
        }
      ]
    }
  };
}

export function tennisPlayerProjectionRows(game={},projection=null,lines=[]){
  const p=projection||simulateTennisMatch(game,{});
  if(!p?.ok)return [];
  const players=[game.player1||game.home||{},game.player2||game.away||{}];
  const rows=[];
  const shared=[
    ["total_games",p.match.totalGames,p.distributions.totalGames],
    ["total_sets",p.match.totalSets,p.distributions.totalSets],
    ["total_tie_breaks",p.match.tieBreaks,p.distributions.tieBreaks],
  ];
  for(let i=0;i<2;i++){
    const defs=[
      ...shared,
      ["total_games_won",p.playerMetrics[i].total_games_won,p.distributions.players[i].total_games_won],
      ["aces",p.playerMetrics[i].aces,p.distributions.players[i].aces],
      ["double_faults",p.playerMetrics[i].double_faults,p.distributions.players[i].double_faults],
      ["break_points_won",p.playerMetrics[i].break_points_won,p.distributions.players[i].break_points_won],
      ["fantasy_score",p.playerMetrics[i].fantasy_score,p.distributions.players[i].fantasy_score],
    ];
    for(const [market,summary,dist] of defs){
      const lineRow=(lines||[]).find(x=>String(x.market||x.marketCanonical)===market &&
        (!x.playerId||String(x.playerId)===playerKey(players[i])));
      rows.push({
        playerId:playerKey(players[i]),playerName:players[i].name||null,team:null,position:null,market,
        fbisProjection:summary.mean,fbisSigma:summary.sigma,
        probabilityOver:probabilityOver(dist,lineRow?.line),probabilityUnder:lineRow?.line==null?null:round(1-probabilityOver(dist,lineRow.line),4),
        source:"TENNIS_POINT_LEVEL_SIM",maturity:TENNIS_MATURITY,independent:true,marketInformed:false,
        canQualify:false,canAuthorizeWager:false,decisionEligible:false,eligibleForCard:false,
        propGate:"RESEARCH",gateReason:"tennis_model_requires_walk_forward_validation",
        modelId:TENNIS_PLAYER_MODEL_ID,modelVersion:TENNIS_MODEL_VERSION,
      });
    }
  }
  return rows;
}

export function attachTennisProjectionResearch(games=[],ctx={}){
  return {
    games:(games||[]).map(game=>{
      const projection=simulateTennisMatch(game,ctx,{simulations:ctx.simulations});
      return {...game,tennisV1:projection,playerProjectionRows:tennisPlayerProjectionRows(game,projection,ctx.linesByEvent?.[game.id]||[])};
    }),
    meta:{modelId:TENNIS_MATCH_MODEL_ID,playerModelId:TENNIS_PLAYER_MODEL_ID,version:TENNIS_MODEL_VERSION,maturity:TENNIS_MATURITY,independent:true,marketInformed:false,canQualify:false,canAuthorize:false}
  };
}
