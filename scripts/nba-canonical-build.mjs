#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const start=args.start||"2025-10-21", end=args.end||"2026-06-21";
const out=args.out||"artifacts/nba-canonical.jsonl";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function dates(a,b){const x=[];for(let t=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z");t<=e;t+=86400000)x.push(new Date(t).toISOString().slice(0,10));return x;}
async function get(url){
  let last;for(let i=0;i<4;i++){try{const r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-Canonical/1.0",accept:"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}catch(e){last=e;await sleep(200*(i+1));}}
  throw last;
}
function statMap(stats=[]){const m={};for(const s of stats||[])m[norm(s.name||s.label||s.abbreviation)]=finite(s.value??s.displayValue);return m;}
function teamLine(comp){
  const t=comp.team||{};const s=statMap(comp.statistics||[]);
  const val=(...ks)=>{for(const k of ks)if(s[norm(k)]!=null)return s[norm(k)];return null};
  const fga=val("fieldGoalsAttempted","fga"),fgm=val("fieldGoalsMade","fgm"),tpm=val("threePointFieldGoalsMade","3pm"),orb=val("offensiveRebounds","oreb"),tov=val("turnovers","to"),fta=val("freeThrowsAttempted","fta");
  const efg=fga?((fgm||0)+.5*(tpm||0))/fga:null;
  const poss=fga!=null&&orb!=null&&tov!=null&&fta!=null?fga-orb+tov+.44*fta:null;
  return {id:String(t.id||comp.id||""),abbr:t.abbreviation||"",name:t.displayName||t.name||"",fga,fgm,tpm,orb,tov,fta,efg,possessions:poss,
    tovPct:poss&&tov!=null?tov/poss:null,orbPct:null,ftRate:fga&&fta!=null?fta/fga:null};
}
function playerRows(summary,game){
  const out=[];for(const block of summary?.boxscore?.players||[]){
    const team=block.team||{};for(const group of block.statistics||[]){
      const labels=group.labels||group.names||[];for(const a of group.athletes||[]){
        const vals=a.stats||[];const get=(names)=>{for(const n of names){const i=labels.findIndex(x=>norm(x)===norm(n));if(i>=0)return finite(vals[i]);}return null};
        const name=a.athlete?.displayName||a.displayName; if(!name)continue;
        out.push({id:String(a.athlete?.id||a.id||name),name,teamId:String(team.id||""),team:team.abbreviation||team.displayName||"",
          minutes:get(["MIN","minutes"]),points:get(["PTS","points"]),rebounds:get(["REB","rebounds"]),assists:get(["AST","assists"]),threes:get(["3PM","3PT","threePointFieldGoalsMade"]),starter:a.starter?1:0});
      }
    }
  }return out;
}
const rows=[];
for(const date of dates(start,end)){
 const stamp=date.replaceAll("-","");const board=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`);
 for(const ev of board.events||[]){
  const c=ev.competitions?.[0], comps=c?.competitors||[], h=comps.find(x=>x.homeAway==="home"),a=comps.find(x=>x.homeAway==="away");
  if(!h||!a||!(ev.status?.type?.completed||c?.status?.type?.completed))continue;
  const hs=finite(h.score),as=finite(a.score);if(hs==null||as==null)continue;
  let summary={};try{summary=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`);}catch{}
  const teams=summary?.boxscore?.teams||[];const ht=teams.find(x=>String(x.team?.id)===String(h.team?.id)),at=teams.find(x=>String(x.team?.id)===String(a.team?.id));
  const hl=ht?teamLine(ht):{id:String(h.team?.id||""),abbr:h.team?.abbreviation||"",name:h.team?.displayName||"",possessions:null};
  const al=at?teamLine(at):{id:String(a.team?.id||""),abbr:a.team?.abbreviation||"",name:a.team?.displayName||"",possessions:null};
  const poss=(finite(hl.possessions)!=null&&finite(al.possessions)!=null)?(hl.possessions+al.possessions)/2:null;
  rows.push({id:String(ev.id),date,start:ev.date,neutralSite:Boolean(c?.neutralSite),homeId:hl.id,awayId:al.id,home:hl,away:al,homeScore:hs,awayScore:as,possessions:poss,players:playerRows(summary,ev)});
  await sleep(20);
 }
 await sleep(20);
}
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
fs.writeFileSync(out.replace(/\.jsonl$/,"-manifest.json"),JSON.stringify({sport:"nba",source:"ESPN_PUBLIC",start,end,rows:rows.length,builtAt:new Date().toISOString(),marketInformed:false},null,2));
console.log(JSON.stringify({ok:true,start,end,rows:rows.length,out},null,2));
