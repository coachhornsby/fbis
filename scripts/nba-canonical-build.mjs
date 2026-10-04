#!/usr/bin/env node
import fs from "node:fs";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const start=args.start||"2025-10-21", end=args.end||"2026-06-21";
const out=args.out||"artifacts/nba-canonical.jsonl";
const allowEmpty=String(args.allowEmpty||"0")==="1";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const sum=xs=>xs.reduce((a,b)=>a+(finite(b)||0),0);

function dates(a,b){
  const x=[];
  for(let t=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z");t<=e;t+=86400000)
    x.push(new Date(t).toISOString().slice(0,10));
  return x;
}
async function get(url){
  let last;
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-Canonical/1.1",accept:"application/json"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    }catch(e){last=e;await sleep(200*(i+1));}
  }
  throw last;
}
function parseMadeAttempted(v){
  if(v==null) return {made:null,attempted:null};
  const m=String(v).trim().match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if(!m) return {made:null,attempted:null};
  return {made:Number(m[1]),attempted:Number(m[2])};
}
function playerRows(summary){
  const out=[];
  for(const block of summary?.boxscore?.players||[]){
    const team=block.team||{};
    for(const group of block.statistics||[]){
      const labels=group.labels||group.names||[];
      for(const a of group.athletes||[]){
        const vals=a.stats||[];
        const raw=(names)=>{
          for(const n of names){
            const i=labels.findIndex(x=>norm(x)===norm(n));
            if(i>=0) return vals[i];
          }
          return null;
        };
        const num=names=>finite(raw(names));
        const fg=parseMadeAttempted(raw(["FG","field goals"]));
        const tp=parseMadeAttempted(raw(["3PT","3P","three pointers"]));
        const ft=parseMadeAttempted(raw(["FT","free throws"]));
        const name=a.athlete?.displayName||a.displayName;
        if(!name) continue;
        const row={
          id:String(a.athlete?.id||a.id||name),
          name,
          teamId:String(team.id||""),
          team:team.abbreviation||team.displayName||"",
          minutes:num(["MIN","minutes"]),
          points:num(["PTS","points"]),
          rebounds:num(["REB","rebounds"]),
          offensiveRebounds:num(["OREB","offensive rebounds"]),
          defensiveRebounds:num(["DREB","defensive rebounds"]),
          assists:num(["AST","assists"]),
          turnovers:num(["TO","turnovers"]),
          steals:num(["STL","steals"]),
          blocks:num(["BLK","blocks"]),
          fouls:num(["PF","fouls","personal fouls"]),
          fgm:fg.made,fga:fg.attempted,
          threes:tp.made,tpa:tp.attempted,
          ftm:ft.made,fta:ft.attempted,
          starter:a.starter?1:0
        };
        const hasGameStats=[row.minutes,row.points,row.rebounds,row.assists,row.fga,row.fta,row.turnovers,row.steals,row.blocks].some(v=>finite(v)!=null);
        if(hasGameStats) out.push(row);
      }
    }
  }
  return out;
}
function statMap(stats=[]){
  const m={};
  for(const s of stats||[]){
    const key=norm(s.name||s.label||s.abbreviation);
    const raw=s.value??s.displayValue;
    const n=finite(raw);
    if(n!=null)m[key]=n;
  }
  return m;
}
function teamLine(comp,players=[]){
  const t=comp?.team||{};
  const s=statMap(comp?.statistics||[]);
  const val=(...ks)=>{for(const k of ks)if(s[norm(k)]!=null)return s[norm(k)];return null};
  const fgm=players.length?sum(players.map(x=>x.fgm)):val("fieldGoalsMade","fgm");
  const fga=players.length?sum(players.map(x=>x.fga)):val("fieldGoalsAttempted","fga");
  const tpm=players.length?sum(players.map(x=>x.threes)):val("threePointFieldGoalsMade","3pm");
  const orbPlayers=players.map(x=>x.offensiveRebounds).filter(v=>finite(v)!=null);
  const tovPlayers=players.map(x=>x.turnovers).filter(v=>finite(v)!=null);
  const ftaPlayers=players.map(x=>x.fta).filter(v=>finite(v)!=null);
  const orb=orbPlayers.length?sum(orbPlayers):val("offensiveRebounds","oreb");
  const tov=tovPlayers.length?sum(tovPlayers):val("turnovers","totalTurnovers","to");
  const fta=ftaPlayers.length?sum(ftaPlayers):val("freeThrowsAttempted","fta");
  const efg=fga>0?((fgm||0)+.5*(tpm||0))/fga:null;
  const poss=[fga,orb,tov,fta].every(v=>finite(v)!=null)?fga-orb+tov+.44*fta:null;
  return {
    id:String(t.id||comp?.id||""),
    abbr:t.abbreviation||"",
    name:t.displayName||t.name||"",
    fga,fgm,tpm,orb,tov,fta,efg,
    possessions:poss,
    tovPct:poss>0&&tov!=null?tov/poss:null,
    orbPct:null,
    ftRate:fga>0&&fta!=null?fta/fga:null
  };
}

const rows=[];
for(const date of dates(start,end)){
  const stamp=date.replaceAll("-","");
  const board=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`);
  for(const ev of board.events||[]){
    const c=ev.competitions?.[0], comps=c?.competitors||[];
    const h=comps.find(x=>x.homeAway==="home"),a=comps.find(x=>x.homeAway==="away");
    if(!h||!a||!(ev.status?.type?.completed||c?.status?.type?.completed)) continue;
    const hs=finite(h.score),as=finite(a.score);
    if(hs==null||as==null) continue;

    let summary={};
    try{summary=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`);}catch{}

    const players=playerRows(summary);
    const byTeam=new Map();
    for(const p of players){
      if(!byTeam.has(p.teamId))byTeam.set(p.teamId,[]);
      byTeam.get(p.teamId).push(p);
    }

    const teams=summary?.boxscore?.teams||[];
    const ht=teams.find(x=>String(x.team?.id)===String(h.team?.id));
    const at=teams.find(x=>String(x.team?.id)===String(a.team?.id));
    const hComp=ht||{team:h.team};
    const aComp=at||{team:a.team};
    const hl=teamLine(hComp,byTeam.get(String(h.team?.id))||[]);
    const al=teamLine(aComp,byTeam.get(String(a.team?.id))||[]);
    const hp=finite(hl.possessions),ap=finite(al.possessions);
    const poss=hp!=null&&ap!=null?(hp+ap)/2:null;

    rows.push({
      id:String(ev.id),date,start:ev.date,neutralSite:Boolean(c?.neutralSite),
      homeId:hl.id||String(h.team?.id||""),awayId:al.id||String(a.team?.id||""),
      home:hl,away:al,homeScore:hs,awayScore:as,possessions:poss,players
    });
    await sleep(20);
  }
  await sleep(20);
}

const teamLines=rows.flatMap(r=>[r.home,r.away]);
const possCoverage=teamLines.length?teamLines.filter(x=>finite(x.possessions)!=null&&x.possessions>70&&x.possessions<140).length/teamLines.length:0;
const players=rows.flatMap(r=>r.players||[]);
const minutesCoverage=players.length?players.filter(x=>finite(x.minutes)!=null).length/players.length:0;
const threeCoverage=players.length?players.filter(x=>finite(x.threes)!=null).length/players.length:0;
const quality={possessions:possCoverage,playerMinutes:minutesCoverage,playerThrees:threeCoverage};
console.log(JSON.stringify({quality},null,2));

if(!rows.length && !allowEmpty) throw new Error("NBA canonical quality fail: no completed games");
if(rows.length){
  if(possCoverage<0.90) throw new Error(`NBA canonical quality fail: possession coverage ${possCoverage}`);
  if(minutesCoverage<0.90) throw new Error(`NBA canonical quality fail: minutes coverage ${minutesCoverage}`);
  if(threeCoverage<0.90) throw new Error(`NBA canonical quality fail: 3PM coverage ${threeCoverage}`);
}

fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
fs.writeFileSync(out.replace(/\.jsonl$/,"-manifest.json"),JSON.stringify({
  sport:"nba",source:"ESPN_PUBLIC",sourceVersion:"canonical-v1.1",
  start,end,rows:rows.length,builtAt:new Date().toISOString(),marketInformed:false,quality
},null,2));
console.log(JSON.stringify({ok:true,start,end,rows:rows.length,out,quality},null,2));
