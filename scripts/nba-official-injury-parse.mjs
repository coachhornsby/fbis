#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const textFile=args.text||"artifacts/report.txt";
const discoveryFile=args.discovery||"artifacts/discovery.json";
const out=args.out||"artifacts/nba-official-availability.json";
const sqlOut=args.sql||"artifacts/nba-official-availability.sql";
const observedAt=new Date().toISOString();

const teams={
 "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA","Chicago Bulls":"CHI",
 "Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW",
 "Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM",
 "Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK",
 "Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHX","Portland Trail Blazers":"POR",
 "Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"
};
const teamNames=Object.keys(teams).sort((a,b)=>b.length-a.length);
const disc=fs.existsSync(discoveryFile)?JSON.parse(fs.readFileSync(discoveryFile,"utf8")):{};
const raw=fs.readFileSync(textFile,"utf8").replace(//g,"
");
const lines=raw.split(/?
/).map(x=>x.replace(/ /g," ").trimEnd());

const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
function tzOffsetMinutes(timeZone,instant){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(instant);
 const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 const asUtc=Date.UTC(+m.year,+m.month-1,+m.day,+m.hour,+m.minute);
 return (asUtc-instant.getTime())/60000;
}
function easternToUtc(date,time12){
 if(!date||!time12)return null;
 const dm=date.match(/(d{2})/(d{2})/(d{2,4})/);const tm=time12.match(/(d{1,2}):(d{2})s*(AM|PM)/i);
 if(!dm||!tm)return null;
 let y=+dm[3];if(y<100)y+=2000;let h=+tm[1];if(tm[3].toUpperCase()==="PM"&&h!==12)h+=12;if(tm[3].toUpperCase()==="AM"&&h===12)h=0;
 const naive=new Date(Date.UTC(y,+dm[1]-1,+dm[2],h,+tm[2]));
 const off=tzOffsetMinutes("America/New_York",naive);
 return new Date(naive.getTime()-off*60000).toISOString();
}
function opponent(matchup,team){
 const m=String(matchup||"").match(/^([A-Z]{2,3})@([A-Z]{2,3})$/);if(!m)return null;
 return team===m[1]?m[2]:team===m[2]?m[1]:null;
}
function findTeam(s){
 for(const name of teamNames){
   const i=s.indexOf(name);
   if(i>=0)return {name,key:teams[name],index:i};
 }
 return null;
}
const header=raw.match(/Injury Report:s*(d{2}/d{2}/d{2})s+(d{1,2}:d{2}s*(?:AM|PM))/i);
const reportTimestamp=header?easternToUtc(header[1],header[2]):observedAt;
let gameDate=null,gameTime=null,matchup=null,currentTeam=null,lastEntry=null;
const entries=[],coverage=new Map();

function coverKey(date,match,team){return [date||"",match||"",team||""].join("|")}
function markCoverage(status){
 if(!currentTeam)return;
 const key=coverKey(gameDate,matchup,currentTeam.key);
 const x=coverage.get(key)||{gameDate,gameTime,matchup,teamKey:currentTeam.key,teamName:currentTeam.name,opponentKey:opponent(matchup,currentTeam.key),submissionStatus:status,playerRows:0};
 if(status==="SUBMITTED"||x.submissionStatus!=="SUBMITTED")x.submissionStatus=status;
 coverage.set(key,x);
}
function addEntry(name,status,reason){
 markCoverage("SUBMITTED");
 const e={gameDate,gameTime,matchup,teamKey:currentTeam?.key||null,teamName:currentTeam?.name||null,opponentKey:opponent(matchup,currentTeam?.key),playerName:name,status:status.toUpperCase(),reason:reason||""};
 entries.push(e);lastEntry=e;
 const key=coverKey(gameDate,matchup,currentTeam?.key);const c=coverage.get(key);if(c)c.playerRows++;
}

for(let rawLine of lines){
 let line=rawLine.trim();
 if(!line||/^Page d+ of d+/i.test(line)||/^Game Dates+Game Time/i.test(line)||/^Injury Report:/i.test(line))continue;
 const dm=line.match(/^(d{2}/d{2}/d{4})s+/);if(dm){gameDate=dm[1];line=line.slice(dm[0].length)}
 const tm=line.match(/^(d{2}:d{2})s+(ET)s+/);if(tm){gameTime=tm[1]+" ET";line=line.slice(tm[0].length)}
 const mm=line.match(/^([A-Z]{2,3}@[A-Z]{2,3})s+/);if(mm){matchup=mm[1];line=line.slice(mm[0].length)}
 const t=findTeam(line);
 if(t&&t.index===0){
   currentTeam={name:t.name,key:t.key};line=line.slice(t.name.length).trim();
   lastEntry=null;
 }
 if(/NOT YET SUBMITTED/i.test(line)){markCoverage("NOT_YET_SUBMITTED");lastEntry=null;continue}
 if(/NO INJURIES|NONE TO REPORT|NO PLAYERS TO REPORT/i.test(line)){markCoverage("SUBMITTED");lastEntry=null;continue}
 const sm=line.match(/(Available|Probable|Questionable|Doubtful|Out)/i);
 if(sm){
   const pre=line.slice(0,sm.index).trim(),post=line.slice(sm.index+sm[0].length).trim();
   if(pre.includes(","))addEntry(pre,sm[1],post);
   else if(lastEntry&&post)lastEntry.reason=(lastEntry.reason+" "+post).trim();
   continue;
 }
 if(lastEntry&&line&&!findTeam(line)&&!/^(d{2}:d{2})/.test(line)&&!/^([A-Z]{2,3}@[A-Z]{2,3})/.test(line)){
   lastEntry.reason=(lastEntry.reason+" "+line).trim();
 }
}

const sourceUrl=disc.url||null,createdAt=observedAt,sql=[];
for(const e of entries){
  const id="nba-offavail:"+hash([reportTimestamp,e.gameDate,e.matchup,e.teamKey,e.playerName,e.status].join("|")).slice(0,32);
 sql.push(`INSERT OR IGNORE INTO player_availability_observations (id,source,sport,team_key,team_name,player_id,player_name,status,injury_detail,game_id,opponent_key,effective_from,source_updated_at,observed_at,source_url,raw_json,created_at) VALUES (${q(id)},'NBA_OFFICIAL_INJURY_REPORT','nba',${q(e.teamKey)},${q(e.teamName)},NULL,${q(e.playerName)},${q(e.status)},${q(e.reason)},NULL,${q(e.opponentKey)},NULL,${q(reportTimestamp)},${q(observedAt)},${q(sourceUrl)},${q(JSON.stringify(e))},${q(createdAt)});`);
}
for(const c of coverage.values()){
 const id="nba-offreport:"+hash([reportTimestamp,c.gameDate,c.matchup,c.teamKey].join("|")).slice(0,32);
 sql.push(`INSERT OR IGNORE INTO nba_official_availability_reports (id,source,report_url,report_timestamp,game_date,game_time_et,matchup,team_key,team_name,opponent_key,submission_status,player_rows,observed_at,raw_json,created_at) VALUES (${q(id)},'NBA_OFFICIAL_INJURY_REPORT',${q(sourceUrl)},${q(reportTimestamp)},${q(c.gameDate)},${q(c.gameTime)},${q(c.matchup)},${q(c.teamKey)},${q(c.teamName)},${q(c.opponentKey)},${q(c.submissionStatus)},${Number(c.playerRows||0)},${q(observedAt)},${q(JSON.stringify(c))},${q(createdAt)});`);
}
const result={ok:true,source:"NBA_OFFICIAL_INJURY_REPORT",sourceUrl,reportTimestamp,observedAt,entries,coverage:[...coverage.values()],quality:{entries:entries.length,teams:coverage.size,submitted:[...coverage.values()].filter(x=>x.submissionStatus==="SUBMITTED").length,notYetSubmitted:[...coverage.values()].filter(x=>x.submissionStatus==="NOT_YET_SUBMITTED").length}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+"
");fs.writeFileSync(sqlOut,sql.join("
")+(sql.length?"
":""));
console.log(JSON.stringify({ok:true,reportTimestamp,sourceUrl,quality:result.quality,out,sqlOut},null,2));
