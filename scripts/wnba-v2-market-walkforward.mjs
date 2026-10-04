#!/usr/bin/env node
import fs from "node:fs";
import { projectWnbaV2 } from "../functions/lib/wnbaFbisV2.js";

const WINDOWS={
  2024:["2024-05-14","2024-10-20"],
  2025:["2025-05-16","2025-10-17"],
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=v=>String(v||"").toUpperCase().replace(/[^A-Z0-9]+/g,"").trim();

function days(a,b){
  const s=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z"),out=[];
  for(let t=s;t<=e;t+=86400000) out.push(new Date(t).toISOString().slice(0,10));
  return out;
}
async function fetchJson(url){
  let last=null;
  for(let k=0;k<3;k++){
    try{
      const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-v2-proof/1.0",accept:"application/json"}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){last=e;await sleep(200*(k+1));}
  }
  throw last;
}
async function fetchDay(date){
  const stamp=date.replaceAll("-","");
  const j=await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${stamp}&limit=100`);
  return (j.events||[]).flatMap(ev=>{
    const c=ev.competitions?.[0],cs=c?.competitors||[];
    const h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
    const hs=finite(h?.score),as=finite(a?.score);
    const complete=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
    if(!h||!a||!complete||hs==null||as==null)return [];
    return [{
      id:String(ev.id),date,start:ev.date,neutralSite:Boolean(c?.neutralSite),
      homeId:String(h.team?.id||h.id),awayId:String(a.team?.id||a.id),
      homeAbbr:h.team?.abbreviation||h.team?.shortDisplayName||"",awayAbbr:a.team?.abbreviation||a.team?.shortDisplayName||"",
      homeName:h.team?.displayName||"",awayName:a.team?.displayName||"",
      homeScore:hs,awayScore:as,scoreboardOdds:c?.odds||[]
    }];
  });
}
function cleanStatName(v){
  return String(v||"")
    .replace(/([a-z])([A-Z])/g,"$1 $2")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function statValue(stats=[],names=[]){
  const wanted=new Set(names.map(cleanStatName));
  for(const s of stats||[]){
    const key=cleanStatName(s?.name||s?.displayName||s?.abbreviation||s?.label);
    const txt=String(s?.displayValue??"").trim();
    const parts=txt.split("-").map(finite);
    if(wanted.has(key)){
      const direct=finite(s?.value);
      if(direct!=null)return direct;
      const first=finite(txt.split("-")[0]);
      if(first!=null)return first;
    }
    if(
      (wanted.has("field goal attempts")||wanted.has("field goals attempted")||wanted.has("fga")) &&
      key.includes("field goals made")&&key.includes("field goals attempted")&&parts.length>=2&&parts[1]!=null
    ) return parts[1];
    if(
      (wanted.has("free throw attempts")||wanted.has("free throws attempted")||wanted.has("fta")) &&
      key.includes("free throws made")&&key.includes("free throws attempted")&&parts.length>=2&&parts[1]!=null
    ) return parts[1];
    if(
      (wanted.has("offensive rebounds")||wanted.has("off rebounds")||wanted.has("oreb")) &&
      (key==="offensive rebounds"||key==="rebounds offensive")
    ){
      const v=finite(s?.value??txt); if(v!=null)return v;
    }
    if((wanted.has("turnovers")||wanted.has("to"))&&key==="turnovers"){
      const v=finite(s?.value??txt); if(v!=null)return v;
    }
  }
  return null;
}
function boxRows(summary,g){
  const teams=summary?.boxscore?.teams||[];
  const rows=[];
  for(const [teamId,oppId,score,oppScore] of [
    [g.homeId,g.awayId,g.homeScore,g.awayScore],
    [g.awayId,g.homeId,g.awayScore,g.homeScore],
  ]){
    const box=teams.find(x=>String(x?.team?.id||"")===String(teamId));
    const st=box?.statistics||[];
    const fga=statValue(st,["field goal attempts","field goals attempted","fga"]);
    const fta=statValue(st,["free throw attempts","free throws attempted","fta"]);
    const orb=statValue(st,["offensive rebounds","off rebounds","oreb"]);
    const tov=statValue(st,["turnovers","to"]);
    if([fga,fta,orb,tov].some(v=>v==null))continue;
    const poss=Math.max(1,fga-orb+tov+0.44*fta);
    rows.push({teamId:String(teamId),oppId:String(oppId),score,oppScore,poss,ortg:score/poss*100,drtg:oppScore/poss*100});
  }
  if(rows.length===2){
    const pace=(rows[0].poss+rows[1].poss)/2;
    rows.forEach(r=>r.pace=pace);
  }
  return rows;
}
function weighted(rows,key){
  let num=0,den=0;
  for(let i=0;i<rows.length;i++){
    const v=finite(rows[i]?.[key]);if(v==null)continue;
    const w=Math.pow(.90,i);num+=v*w;den+=w;
  }
  return den?num/den:null;
}
function leagueProfile(rows){
  if(!rows.length)return {ortg:101.5,pace:79.5};
  return {
    ortg:clamp(rows.reduce((s,r)=>s+(finite(r.ortg)||0),0)/rows.length,92,112),
    pace:clamp(rows.reduce((s,r)=>s+(finite(r.pace)||0),0)/rows.length,72,86),
  };
}
function teamProfile(rows,league){
  const rs=rows.slice(-14).reverse(),n=rs.length;if(!n)return null;
  const shrink=n/(n+6);
  const blend=(key,prior)=>((weighted(rs,key)??prior)*shrink+prior*(1-shrink));
  return {games:n,ortg:blend("ortg",league.ortg),drtg:blend("drtg",league.ortg),pace:blend("pace",league.pace)};
}
function parseSpreadDetails(details,homeAbbr,awayAbbr){
  const m=String(details||"").trim().match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/);
  if(!m)return null;
  const who=norm(m[1]),line=finite(m[2]);if(line==null)return null;
  const h=norm(homeAbbr),a=norm(awayAbbr);
  if(who===h||h.startsWith(who)||who.startsWith(h))return line;
  if(who===a||a.startsWith(who)||who.startsWith(a))return -line;
  return null;
}
function extractMarket(summary,g){
  const pcs=Array.isArray(summary?.pickcenter)?summary.pickcenter:[];
  const raw=[...pcs,...(g.scoreboardOdds||[])];
  for(const p of raw){
    const total=finite(p?.overUnder??p?.over_under);
    let homeSpread=finite(p?.homeTeamOdds?.spread??p?.homeTeamOdds?.line);
    if(homeSpread==null) homeSpread=parseSpreadDetails(p?.details,g.homeAbbr,g.awayAbbr);
    if(homeSpread==null){
      const hs=finite(p?.spread);
      const favorite=p?.homeTeamOdds?.favorite===true?"home":p?.awayTeamOdds?.favorite===true?"away":null;
      if(hs!=null&&favorite)homeSpread=favorite==="home"?-Math.abs(hs):Math.abs(hs);
    }
    if(homeSpread!=null||total!=null){
      return {
        provider:p?.provider?.name||p?.provider?.id||null,
        details:p?.details||null,
        homeSpread,total,
        rawKeys:Object.keys(p||{}).sort(),
      };
    }
  }
  return {provider:null,details:null,homeSpread:null,total:null,rawKeys:[]};
}
function resultUnits(win,push=false){
  if(push)return 0;
  return win?1/1.10:-1;
}
function summarizeBets(rows,type,threshold){
  const bets=[];
  for(const r of rows){
    if(type==="spread"&&r.marketHomeSpread!=null){
      const edge=r.projectedMargin+r.marketHomeSpread;
      if(Math.abs(edge)<threshold)continue;
      const pickHome=edge>0;
      const cover=r.actualMargin+r.marketHomeSpread;
      const push=Math.abs(cover)<1e-9;
      const win=push?false:(pickHome?cover>0:cover<0);
      bets.push({win,push,units:resultUnits(win,push),edge:Math.abs(edge)});
    }else if(type==="total"&&r.marketTotal!=null){
      const edge=r.projectedTotal-r.marketTotal;
      if(Math.abs(edge)<threshold)continue;
      const pickOver=edge>0;
      const result=r.actualTotal-r.marketTotal;
      const push=Math.abs(result)<1e-9;
      const win=push?false:(pickOver?result>0:result<0);
      bets.push({win,push,units:resultUnits(win,push),edge:Math.abs(edge)});
    }
  }
  const decisions=bets.filter(b=>!b.push);
  const units=bets.reduce((s,b)=>s+b.units,0);
  return {
    threshold,n:bets.length,wins:decisions.filter(b=>b.win).length,losses:decisions.filter(b=>!b.win).length,pushes:bets.filter(b=>b.push).length,
    winRate:decisions.length?decisions.filter(b=>b.win).length/decisions.length:null,
    units,roi:bets.length?units/bets.length:null,avgEdge:mean(bets.map(b=>b.edge))
  };
}

const games=[];
for(const season of [2024,2025]){
  const [a,b]=WINDOWS[season];
  for(const d of days(a,b)){
    try{games.push(...await fetchDay(d));}catch(e){console.error("scoreboard",d,e.message);}
    await sleep(20);
  }
}
const dedup=[...new Map(games.map(g=>[g.id,g])).values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
console.log("games",dedup.length);

const historyByTeam=new Map(),allPriorRows=[],out=[];
let marketSamples=0;
for(let i=0;i<dedup.length;i++){
  const g=dedup[i];
  let summary=null;
  try{summary=await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${g.id}`);}catch(e){console.error("summary",g.id,e.message);}
  if(!summary)continue;

  const league=leagueProfile(allPriorRows);
  const hp=teamProfile(historyByTeam.get(g.homeId)||[],league);
  const ap=teamProfile(historyByTeam.get(g.awayId)||[],league);
  const ctx={league,byTeam:{[g.homeId]:hp,[g.awayId]:ap}};
  const projection=hp&&ap?projectWnbaV2({
    id:g.id,neutralSite:g.neutralSite,
    home:{id:`wnba-${g.homeId}`,abbr:g.homeAbbr},
    away:{id:`wnba-${g.awayId}`,abbr:g.awayAbbr},
  },ctx):{ok:false};

  const market=extractMarket(summary,g);
  if(market.homeSpread!=null||market.total!=null)marketSamples++;
  if(projection.ok){
    const actualMargin=g.homeScore-g.awayScore,actualTotal=g.homeScore+g.awayScore;
    out.push({
      season:Number(g.date.slice(0,4)),gameId:g.id,date:g.date,home:g.homeName,away:g.awayName,
      projectedHome:projection.home,projectedAway:projection.away,projectedMargin:projection.margin,projectedTotal:projection.total,
      actualHome:g.homeScore,actualAway:g.awayScore,actualMargin,actualTotal,
      marginAbsError:Math.abs(projection.margin-actualMargin),totalAbsError:Math.abs(projection.total-actualTotal),
      winnerCorrect:(projection.margin>0)===(actualMargin>0),
      marketHomeSpread:market.homeSpread,marketTotal:market.total,marketProvider:market.provider,marketDetails:market.details,
      marketMarginAbsError:market.homeSpread==null?null:Math.abs((-market.homeSpread)-actualMargin),
      marketTotalAbsError:market.total==null?null:Math.abs(market.total-actualTotal),
    });
  }

  const rows=boxRows(summary,g);
  for(const r of rows){
    if(!historyByTeam.has(r.teamId))historyByTeam.set(r.teamId,[]);
    historyByTeam.get(r.teamId).push(r);allPriorRows.push(r);
  }
  if((i+1)%50===0)console.log("processed",i+1,"/",dedup.length,"markets",marketSamples);
  await sleep(20);
}
const marginMarket=out.filter(r=>r.marketHomeSpread!=null),totalMarket=out.filter(r=>r.marketTotal!=null);
const thresholds=[0,1,2,3,4,5,6,7];
const report={
  generatedAt:new Date().toISOString(),modelId:"WNBA-FBIS-v2",method:"chronological-possession-efficiency-walk-forward",
  temporalIntegrity:"Each projection uses only completed prior-game box scores; current game is appended after projection.",
  marketBenchmark:"ESPN historical PickCenter/final-summary line where retained. This is a close proxy without immutable quote timestamp; not valid for CLV.",
  games:out.length,
  marginMae:mean(out.map(r=>r.marginAbsError)),totalMae:mean(out.map(r=>r.totalAbsError)),
  winnerAccuracy:out.length?out.filter(r=>r.winnerCorrect).length/out.length:null,
  marketCoverage:{spread:marginMarket.length,total:totalMarket.length},
  versusMarket:{
    spread:{modelMarginMae:mean(marginMarket.map(r=>r.marginAbsError)),marketMarginMae:mean(marginMarket.map(r=>r.marketMarginAbsError))},
    total:{modelTotalMae:mean(totalMarket.map(r=>r.totalAbsError)),marketTotalMae:mean(totalMarket.map(r=>r.marketTotalAbsError))},
  },
  betting:{
    spread:thresholds.map(t=>summarizeBets(out,"spread",t)),
    total:thresholds.map(t=>summarizeBets(out,"total",t)),
  },
  governance:{maturity:"RESEARCH",autoPromote:false,canQualify:false,canAuthorize:false}
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/wnba-v2-market-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/wnba-v2-market-walkforward-rows.jsonl",out.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
