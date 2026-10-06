#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState, simulateTennisDeepV11 } from "../functions/lib/tennisTwoSidedV11.js";

const API_KEY=process.env.THEODDS_API_KEY||"";
const OUT=process.env.TENNIS_ECON_OUT||"research/tennis/economic-usopen-2025.json";
const MIRROR="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const MAX_REQUESTS=Math.max(1,Number(process.env.TENNIS_ECON_MAX_REQUESTS||60));
const MIN_RESERVE=Math.max(0,Number(process.env.TENNIS_ECON_MIN_QUOTA_RESERVE||250));
const SIMS=Math.max(500,Number(process.env.TENNIS_ECON_SIMS||1200));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v,d=5)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const logistic=z=>1/(1+Math.exp(-z));
const norm=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};
function parseCsv(text){
  const rows=[];let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}
    else{if(ch==='"')q=true;else if(ch===","){row.push(field);field="";}else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}else if(ch!=="\r")field+=ch;}
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const h=rows.shift()||[];return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"FBIS tennis economic research"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
function idOf(r,s){return String(r[`${s}_id`]||r[`${s}_name`]||"").trim()}
function dateKey(r){return String(r.tourney_date||"")}
function eventKey(r,t){return `${t}|${r.tourney_id||r.tourney_name}|${dateKey(r)}`}
function scoreOutcome(score){
  const s=String(score||"").trim().replace(/\s+/g," ");
  if(!s||/W\/O|RET|DEF|ABD|Walkover/i.test(s)||/[\[\]]/.test(s))return null;
  const sets=s.split(" ").map(x=>x.match(/^(\d+)-(\d+)(?:\([^)]*\))?$/)).filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]).filter(x=>x[0]<=7&&x[1]<=7);
  if(sets.length<2)return null;
  const wg=sets.reduce((n,x)=>n+x[0],0),lg=sets.reduce((n,x)=>n+x[1],0);
  return {winnerGames:wg,loserGames:lg,totalGames:wg+lg,totalSets:sets.length};
}
function actualBpWon(r,side){const o=side==="w"?"l":"w",f=finite(r[`${o}_bpFaced`]),s=finite(r[`${o}_bpSaved`]);return f==null||s==null?null:Math.max(0,f-s)}
function actualMetrics(r,side,outcome){
  const winner=side==="w";
  return {
    total_games_won:winner?outcome.winnerGames:outcome.loserGames,
    aces:finite(r[`${side}_ace`]),
    double_faults:finite(r[`${side}_df`]),
    break_points_won:actualBpWon(r,side),
  };
}
function rankFeature(a,b){const x=finite(a),y=finite(b);return x&&y?Math.log((y+5)/(x+5)):0}
function applyAffine(v,c){return c?c.a+c.b*v:v}
function choosePropCal(report,suffix,tour,surface){
  const g=report?.props?.calibration?.[suffix]||{};
  return g[`tourSurface:${tour}:${surface}`]||g[`tour:${tour}`]||g[`surface:${surface}`]||g.global||null;
}
function isUsOpen(r){return Number(r._year)===2025&&/us open/i.test(String(r.tourney_name||""))}
function alphabeticalSides(r){
  const a={id:idOf(r,"winner"),name:r.winner_name,rank:finite(r.winner_rank),side:"w"};
  const b={id:idOf(r,"loser"),name:r.loser_name,rank:finite(r.loser_rank),side:"l"};
  return [a,b].sort((x,y)=>norm(x.name).localeCompare(norm(y.name)));
}
function simProbOver(arr,line){if(!Array.isArray(arr)||!arr.length||!Number.isFinite(Number(line)))return null;return arr.filter(x=>x>Number(line)).length/arr.length}
function playerDistributions(proj,i){return proj?.distributions?.players?.[i]||{}}
async function loadResearchReport(){
  try{return JSON.parse(await fs.readFile("research/tennis/deep-v1-1-2026-10-05.json","utf8"));}catch{return null}
}

if(!API_KEY)throw new Error("THEODDS_API_KEY missing; licensed historical economic test cannot run");
const calibrationReport=await loadResearchReport();
const matchCal=calibrationReport?.calibration?.deep||{a:.45,b:.5};

const all=[];
for(const tour of ["atp","wta"])for(let year=2018;year<=2025;year++){
  const txt=await fetchText(`${MIRROR}/${tour}/${tour}_matches_${year}.csv`);
  for(const r of parseCsv(txt))all.push({...r,_tour:tour,_year:year});
}
all.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||eventKey(a,a._tour).localeCompare(eventKey(b,b._tour))||String(a.match_num||"").localeCompare(String(b.match_num||"")));
const states={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")};
const modelMatches=[];
let i=0;
while(i<all.length){
  const ek=eventKey(all[i],all[i]._tour);let j=i;while(j<all.length&&eventKey(all[j],all[j]._tour)===ek)j++;
  const event=all.slice(i,j),tour=event[0]._tour,state=states[tour],surface=surfaceKey(event[0].surface);
  if(event.some(isUsOpen)){
    for(const r of event){
      const outcome=scoreOutcome(r.score);if(!outcome)continue;
      const sides=alphabeticalSides(r);
      const p1=state.profile(sides[0].id,sides[0].name,surface),p2=state.profile(sides[1].id,sides[1].name,surface);
      if(Math.min(p1.historyMatches,p2.historyMatches)<3)continue;
      const id=`econ|${tour}|${r.tourney_id}|${r.match_num}`;
      const proj=simulateTennisDeepV11({id,tour,surface,bestOf:Number(r.best_of)||3,player1:p1,player2:p2},{simulations:SIMS},{seed:id,researchBacktest:true});
      const rawP1=proj.match.pPlayer1Win;
      const p1Win=logistic(matchCal.a*logit(rawP1)+matchCal.b*rankFeature(sides[0].rank,sides[1].rank));
      const players=sides.map((s,k)=>{
        const pm=proj.playerMetrics[k],dist=playerDistributions(proj,k);
        const aces=applyAffine(pm.aces.mean,choosePropCal(calibrationReport,"P1Aces",tour,surface));
        const dfs=applyAffine(pm.double_faults.mean,choosePropCal(calibrationReport,"P1Df",tour,surface));
        const bp=applyAffine(pm.break_points_won.mean,choosePropCal(calibrationReport,"P1Bp",tour,surface));
        const gw=applyAffine(pm.total_games_won.mean,choosePropCal(calibrationReport,"P1Games",tour,surface));
        return {name:s.name,norm:norm(s.name),rank:s.rank,actual:actualMetrics(r,s.side,outcome),
          projection:{total_games_won:gw,aces,double_faults:dfs,break_points_won:bp},
          distributions:{total_games_won:dist.total_games_won,aces:dist.aces,double_faults:dist.double_faults,break_points_won:dist.break_points_won}};
      });
      const totalGames=applyAffine(proj.match.totalGames.mean,choosePropCal(calibrationReport,"TotalGames",tour,surface));
      const totalSets=applyAffine(proj.match.totalSets.mean,choosePropCal(calibrationReport,"TotalSets",tour,surface));
      modelMatches.push({
        tour,surface,tournament:r.tourney_name,round:r.round,bestOf:Number(r.best_of)||3,
        player1:players[0],player2:players[1],
        actualWinner:r.winner_name,actualLoser:r.loser_name,
        matchProb:{[players[0].norm]:p1Win,[players[1].norm]:1-p1Win},
        shared:{totalGames,totalSets,actualTotalGames:outcome.totalGames,actualTotalSets:outcome.totalSets,
          totalGamesDist:proj.distributions.totalGames,totalSetsDist:proj.distributions.totalSets}
      });
    }
  }
  for(const r of event)state.update(r,surfaceKey(r.surface));
  i=j;
}

let requestCount=0,quotaRemaining=null;
async function oddsGet(url){
  if(requestCount>=MAX_REQUESTS)throw new Error("research request cap reached");
  requestCount++;
  const r=await fetch(url,{headers:{"user-agent":"FBIS tennis economic validation/1.0"}});
  const rem=finite(r.headers.get("x-requests-remaining")); if(rem!=null)quotaRemaining=rem;
  if(rem!=null&&rem<MIN_RESERVE)throw new Error(`quota reserve reached: ${rem}<${MIN_RESERVE}`);
  const body=await r.text();
  if(!r.ok)throw new Error(`TheOdds HTTP ${r.status}: ${body.slice(0,300)}`);
  return JSON.parse(body);
}
function days(a,b){
  const out=[];for(let t=Date.parse(a+"T00:00:00Z");t<=Date.parse(b+"T00:00:00Z");t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;
}
const snapshots=[];
for(const [tour,sport] of [["atp","tennis_atp_us_open"],["wta","tennis_wta_us_open"]]){
  for(const d of days("2025-08-24","2025-09-07")){
    const date=`${d}T12:00:00Z`;
    const u=new URL(`https://api.the-odds-api.com/v4/historical/sports/${sport}/odds`);
    u.searchParams.set("apiKey",API_KEY);u.searchParams.set("bookmakers","pinnacle");u.searchParams.set("markets","h2h");u.searchParams.set("oddsFormat","decimal");u.searchParams.set("date",date);
    const j=await oddsGet(u);
    for(const ev of j.data||[]){
      const start=Date.parse(ev.commence_time||"");const snap=Date.parse(j.timestamp||date);
      if(!Number.isFinite(start)||!Number.isFinite(snap)||snap>=start)continue;
      snapshots.push({tour,sport,queryDate:date,snapshotAt:j.timestamp||date,event:ev});
    }
  }
}
const latestByEvent=new Map();
for(const s of snapshots){const id=String(s.event.id);const prev=latestByEvent.get(id);if(!prev||Date.parse(s.snapshotAt)>Date.parse(prev.snapshotAt))latestByEvent.set(id,s)}
function matchModel(home,away,tour){
  const h=norm(home),a=norm(away);
  let exact=modelMatches.find(m=>m.tour===tour&&new Set([m.player1.norm,m.player2.norm]).has(h)&&new Set([m.player1.norm,m.player2.norm]).has(a));
  if(exact)return {row:exact,confidence:"EXACT"};
  const tokens=x=>new Set(norm(x).split(" ").filter(Boolean));
  const sim=(x,y)=>{const A=tokens(x),B=tokens(y),n=[...A].filter(z=>B.has(z)).length;return n/Math.max(A.size,B.size,1)};
  const ranked=modelMatches.filter(m=>m.tour===tour).map(m=>{
    const s1=sim(home,m.player1.name)+sim(away,m.player2.name),s2=sim(home,m.player2.name)+sim(away,m.player1.name);
    return {m,score:Math.max(s1,s2)};
  }).sort((x,y)=>y.score-x.score);
  return ranked[0]?.score>=1.65?{row:ranked[0].m,confidence:"FUZZY"}:null;
}
function pinnacleH2h(ev){
  const book=(ev.bookmakers||[]).find(b=>String(b.key||"").toLowerCase()==="pinnacle")||(ev.bookmakers||[])[0];
  const market=(book?.markets||[]).find(m=>m.key==="h2h");if(!market)return null;
  const outs=(market.outcomes||[]).filter(o=>finite(o.price)!=null&&o.name);if(outs.length!==2)return null;
  const imp=outs.map(o=>1/Number(o.price)),z=imp[0]+imp[1];
  return {bookmaker:book.key||book.title,updatedAt:market.last_update||book.last_update||null,
    outcomes:outs.map((o,k)=>({name:o.name,price:Number(o.price),implied:imp[k],noVig:imp[k]/z}))};
}
const marketRows=[];
for(const s of latestByEvent.values()){
  const ev=s.event,m=matchModel(ev.home_team,ev.away_team,s.tour),quote=pinnacleH2h(ev);
  if(!m||!quote)continue;
  const row=m.row;const byNorm=new Map([[row.player1.norm,row.player1],[row.player2.norm,row.player2]]);
  const qouts=quote.outcomes.map(o=>({...o,norm:norm(o.name)}));
  if(!qouts.every(o=>row.matchProb[o.norm]!=null))continue;
  const actual=norm(row.actualWinner);
  const priced=qouts.map(o=>({...o,modelP:row.matchProb[o.norm],edge:row.matchProb[o.norm]-o.noVig,won:o.norm===actual}));
  const pick=[...priced].sort((a,b)=>b.edge-a.edge)[0];
  marketRows.push({tour:s.tour,eventId:ev.id,commenceTime:ev.commence_time,snapshotAt:s.snapshotAt,matchConfidence:m.confidence,
    player1:row.player1.name,player2:row.player2.name,actualWinner:row.actualWinner,priced,pick,
    modelBrier:mean(priced.map(x=>(x.modelP-(x.won?1:0))**2)),
    marketBrier:mean(priced.map(x=>(x.noVig-(x.won?1:0))**2))});
}
function betSummary(threshold){
  const bets=marketRows.filter(r=>r.pick.edge>=threshold).map(r=>({...r,profit:r.pick.won?r.pick.price-1:-1}));
  const units=bets.reduce((s,r)=>s+r.profit,0);
  return {threshold,n:bets.length,wins:bets.filter(r=>r.pick.won).length,losses:bets.filter(r=>!r.pick.won).length,
    winRate:bets.length?bets.filter(r=>r.pick.won).length/bets.length:null,units:round(units,3),roi:bets.length?round(units/bets.length,5):null,
    avgEdge:bets.length?round(mean(bets.map(r=>r.pick.edge)),5):null,avgPrice:bets.length?round(mean(bets.map(r=>r.pick.price)),3):null};
}
const thresholds=[0,.01,.02,.03,.04,.05,.075,.10];

// Probe PrizePicks historical tennis market availability on a bounded subset of matched events.
const propProbe=[];
for(const r of marketRows.slice(0,Math.min(8,marketRows.length))){
  if(requestCount>=MAX_REQUESTS)break;
  const sport=r.tour==="atp"?"tennis_atp_us_open":"tennis_wta_us_open";
  const u=new URL(`https://api.the-odds-api.com/v4/historical/sports/${sport}/events/${r.eventId}/markets`);
  u.searchParams.set("apiKey",API_KEY);u.searchParams.set("regions","us_dfs");u.searchParams.set("bookmakers","prizepicks");u.searchParams.set("date",r.snapshotAt);
  try{
    const j=await oddsGet(u);
    const txt=JSON.stringify(j);
    const keys=[...new Set((txt.match(/"(?:key|market_key)"\s*:\s*"([^"]+)"/g)||[]).map(x=>x.replace(/^.*:"/,"").replace(/"$/,"")))].filter(k=>/ace|fault|game|set|fantasy|break|tie/i.test(k));
    propProbe.push({eventId:r.eventId,tour:r.tour,snapshotAt:r.snapshotAt,availableKeys:keys,hasPrizePicks:/prizepicks/i.test(txt)});
  }catch(e){propProbe.push({eventId:r.eventId,tour:r.tour,error:e.message});}
}

const report={
  generatedAt:new Date().toISOString(),
  model:"TENNIS-FBIS-v1.1-DEEP",
  test:"2025 US Open licensed market economic validation",
  source:{
    modelHistory:"Jeff Sackmann archive — research/backtest only, CC BY-NC-SA 4.0",
    marketHistory:"The Odds API historical endpoint using configured paid API key",
    executionRole:"Pinnacle research/reference market, not Heritage execution",
  },
  design:{
    tournament:"2025 US Open",surface:"hard",tours:["ATP","WTA"],entrySnapshot:"12:00 UTC on event day (latest available daily query before commence)",
    eventFreeze:true,futureLeakage:false,flatStakeUnits:1,market:"h2h",bookmaker:"pinnacle",
    noVig:"two-way inverse-decimal normalization",clvMeasured:false,
    requestCap:MAX_REQUESTS,quotaReserve:MIN_RESERVE,simulationsPerMatch:SIMS,
  },
  sample:{modelMatches:modelMatches.length,marketEvents:latestByEvent.size,matchedPriced:marketRows.length,exactMatches:marketRows.filter(r=>r.matchConfidence==="EXACT").length,fuzzyMatches:marketRows.filter(r=>r.matchConfidence==="FUZZY").length},
  predictive:{
    modelBrier:round(mean(marketRows.map(r=>r.modelBrier)),5),
    marketBrier:round(mean(marketRows.map(r=>r.marketBrier)),5),
    modelAccuracy:round(mean(marketRows.map(r=>r.pick.modelP>=.5?Number(r.pick.won):Number(!r.pick.won))),5),
  },
  betting:{thresholds:thresholds.map(betSummary)},
  propHistoricalProbe:{
    testedEvents:propProbe.length,
    prizePicksDetected:propProbe.filter(x=>x.hasPrizePicks).length,
    discoveredMarketKeys:[...new Set(propProbe.flatMap(x=>x.availableKeys||[]))],
    events:propProbe,
    note:"This probe only establishes whether licensed historical PrizePicks tennis markets are exposed. Card-level ROI requires actual DFS payout/multiplier reconstruction and is not inferred from single-leg prices."
  },
  quota:{requestsUsed:requestCount,remainingHeader:quotaRemaining},
  limitations:["Entry quote is a same-day pre-match snapshot, not immutable closing price.","No CLV claim.","Heritage execution prices are not historical in FBIS for this period.","PrizePicks ROI is not claimed unless historical tennis prop markets and payout semantics are both available."],
  governance:{maturity:"RESEARCH",canQualify:false,canAuthorizeWager:false}
};
report.verdict={
  marketSamplePass:marketRows.length>=100,
  beatsMarketBrier:Number.isFinite(report.predictive.modelBrier)&&report.predictive.modelBrier<report.predictive.marketBrier,
  positiveRoiBuckets:report.betting.thresholds.filter(x=>x.n>=30&&x.roi>0).map(x=>x.threshold),
  economicEvidencePass:report.betting.thresholds.some(x=>x.n>=50&&x.roi>0),
  wagerPromotion:false
};
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
await fs.mkdir("artifacts",{recursive:true});await fs.writeFile("artifacts/tennis-economic-usopen-2025-rows.jsonl",marketRows.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
