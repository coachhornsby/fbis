import {writeFileSync,mkdirSync} from "node:fs";
import {buildCbbTeamPlayerState,cbbPlayerGameFeatures} from "../functions/lib/cbbPlayerGameModel.js";
import {mapSourceTeam} from "../functions/lib/collegeIdentity.js";

const seasonStart=Number(process.env.FBIS_SEASON||process.argv[2]);
const predPath=process.argv[3]||"artifacts/frozen/cbb-fbis-native-v2-predictions.json";
if(!Number.isFinite(seasonStart))throw new Error("FBIS_SEASON required");
const seasonEnd=seasonStart+1;
const URL="https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_mens_college_basketball_player_boxscores/player_box_"+seasonEnd+".csv";
const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const bool=v=>["1","true","t","yes"].includes(String(v||"").toLowerCase());
const mean=a=>{const x=a.map(n).filter(v=>v!=null);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
const sd=a=>{const x=a.map(n).filter(v=>v!=null);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1))};
const mins=v=>{if(v==null||v==="")return null;const s=String(v).trim();if(s.includes(":")){const [m,sec]=s.split(":").map(Number);return Number.isFinite(m)&&Number.isFinite(sec)?m+sec/60:null}return n(v)};
function parseCsv(text){
 const lines=String(text).split(/\r?\n/),out=[];let h=null;
 for(const line of lines){if(!line)continue;const a=[];let s="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(ch===","&&!q){a.push(s);s=""}else s+=ch}a.push(s);if(!h){h=a;continue}out.push(Object.fromEntries(h.map((k,i)=>[k,a[i]??""])))}
 return out;
}
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const dateKey=v=>String(v||"").slice(0,10);
function canonicalTeam(name){
 const mapped=mapSourceTeam("cbb",{team:name,school:name},seasonStart);
 return mapped?.ok ? String(mapped.canonicalId) : "name:"+norm(name);
}
function pairKeys(home,away){
 const direct=[norm(home),norm(away)].join("|");
 const canonical=[canonicalTeam(home),canonicalTeam(away)].join("|");
 return [...new Set([direct,canonical])].filter(Boolean);
}
function dayOffset(date,offset){const d=new Date(String(date).slice(0,10)+"T12:00:00Z");if(!Number.isFinite(d.getTime()))return null;d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
function predictionCandidates(index,date,home,away){
 const out=[];
 for(const pair of pairKeys(home,away)){
   for(const off of [0,-1,1]){
     const d=dayOffset(date,off); if(!d)continue;
     for(const p of index.get(d+"|"+pair)||[]) out.push(p);
   }
 }
 return [...new Map(out.map(x=>[String(x.id),x])).values()];
}
function playerKey(r){return String(r.athlete_id||r.athlete_display_name||"")}
function teamKey(r){return String(r.team_id||r.team_location||r.team_name||"")}
function blankPlayer(r){return{playerId:playerKey(r),name:r.athlete_display_name||null,team:r.team_location||r.team_name||null,position:r.athlete_position_abbreviation||r.athlete_position_name||null,games:0,starts:0,minutes:0,points:0,rebounds:0,assists:0,threes:0,fga:0,fta:0,oreb:0,dreb:0,tov:0,fgm:0,tpm:0,last5:[],lastDate:null,lastDnp:false}}
function updatePlayer(st,r){
 const dnp=bool(r.did_not_play),m=mins(r.minutes)??0;
 const log={date:r.game_date_time||r.game_date||null,minutes:m,points:n(r.points),rebounds:n(r.rebounds),assists:n(r.assists),threesMade:n(r.three_point_field_goals_made),starter:bool(r.starter),didNotPlay:dnp};
 st.last5.unshift(log);if(st.last5.length>5)st.last5.pop();st.lastDate=log.date;st.lastDnp=dnp;
 if(dnp||m<=0)return;
 st.games++;st.starts+=bool(r.starter)?1:0;st.minutes+=m;st.points+=n(r.points)||0;st.rebounds+=n(r.rebounds)||0;st.assists+=n(r.assists)||0;st.threes+=n(r.three_point_field_goals_made)||0;st.fga+=n(r.field_goals_attempted)||0;st.fta+=n(r.free_throws_attempted)||0;st.oreb+=n(r.offensive_rebounds)||0;st.dreb+=n(r.defensive_rebounds)||0;st.tov+=n(r.turnovers)||0;st.fgm+=n(r.field_goals_made)||0;st.tpm+=n(r.three_point_field_goals_made)||0;
}
function pseudo(st){
 if(!st||st.games<1)return null;const g=st.games,min=Math.max(1,st.minutes),last5=st.last5,last3=last5.slice(0,3);
 const mpg=st.minutes/g,recentMin=mean(last5.map(x=>x.minutes)),projectedMinutes=Math.max(0,Math.min(40,recentMin==null?mpg:.58*recentMin+.42*mpg));
 const startsRecent=last5.filter(x=>x.starter).length;
 const roleConfidence=Math.max(0,Math.min(1,.35*Math.min(g/8,1)+.30*Math.min(projectedMinutes/30,1)+.20*Math.min(startsRecent/3,1)+.15*Math.min(last5.length/5,1)));
 const efg=st.fga?100*(st.fgm+.5*st.tpm)/st.fga:null;
 const tsa=st.fga+.44*st.fta,ts=tsa?100*st.points/(2*tsa):null;
 return{id:st.playerId,name:st.name,team:st.team,position:st.position,games:g,sampleSize:g,starts:st.starts,minutes:st.minutes,minutesPerGame:mpg,projectedMinutes,roleConfidence,
  pointsPerGame:st.points/g,reboundsPerGame:st.rebounds/g,assistsPerGame:st.assists/g,threesMadePerGame:st.threes/g,
  fieldGoalAttemptsPerGame:st.fga/g,freeThrowAttemptsPerGame:st.fta/g,offensiveReboundsPerGame:st.oreb/g,defensiveReboundsPerGame:st.dreb/g,turnoversPerGame:st.tov/g,
  pointsPer40:st.points*40/min,reboundsPer40:st.rebounds*40/min,assistsPer40:st.assists*40/min,threesMadePer40:st.threes*40/min,fieldGoalAttemptsPer40:st.fga*40/min,freeThrowAttemptsPer40:st.fta*40/min,offensiveReboundsPer40:st.oreb*40/min,defensiveReboundsPer40:st.dreb*40/min,turnoversPer40:st.tov*40/min,
  effectiveFieldGoalPct:efg,trueShootingPct:ts,offensiveRating:null,recentGames:last5.length,
  recent:{minutes:recentMin,points:mean(last5.map(x=>x.points)),rebounds:mean(last5.map(x=>x.rebounds)),assists:mean(last5.map(x=>x.assists)),threesMade:mean(last5.map(x=>x.threesMade))},
  trend:{points:mean(last3.map(x=>x.points)),rebounds:mean(last3.map(x=>x.rebounds)),assists:mean(last3.map(x=>x.assists)),threesMade:mean(last3.map(x=>x.threesMade))},
  volatility:{minutes:sd(last5.map(x=>x.minutes)),points:sd(last5.map(x=>x.points)),rebounds:sd(last5.map(x=>x.rebounds)),assists:sd(last5.map(x=>x.assists)),threesMade:sd(last5.map(x=>x.threesMade))},
  role:{startsRecent,lastGameMinutes:last5[0]?.minutes??null,lastGameDnp:Boolean(last5[0]?.didNotPlay),minuteStability:(()=>{const x=sd(last5.map(v=>v.minutes));return x==null?null:Math.max(0,Math.min(1,1-x/18))})()}
 };
}
function statePlayers(map){return[...(map?.values?.()||[])].map(pseudo).filter(Boolean)}
const predAll=JSON.parse(await (await import("node:fs/promises")).readFile(predPath,"utf8"));
const preds=predAll.filter(r=>Number(r.season)===seasonStart),byId=new Map(preds.map(r=>[String(r.id),r]));
const byJoinKey=new Map();
for(const p of preds){
  for(const pair of pairKeys(p.home,p.away)){
    const key=dateKey(p.date)+"|"+pair;
    if(!byJoinKey.has(key))byJoinKey.set(key,[]);
    byJoinKey.get(key).push(p);
  }
}
const res=await fetch(URL,{redirect:"follow"});if(!res.ok)throw new Error("player box HTTP "+res.status+" "+URL);
const raw=parseCsv(await res.text());
const byGame=new Map();
for(const row of raw){const gid=String(row.game_id||"");if(!gid)continue;if(!byGame.has(gid))byGame.set(gid,[]);byGame.get(gid).push(row)}
const games=[...byGame.entries()].map(([id,rows])=>({id,rows,date:rows[0]?.game_date_time||rows[0]?.game_date||""})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
const teams=new Map(),gameSamples=[],propSamples=[];let matched=0,idMatches=0,canonicalMatches=0,ambiguousMatches=0;
for(const g of games){
 const homeRow=g.rows.find(x=>String(x.home_away).toLowerCase()==="home"),awayRow=g.rows.find(x=>String(x.home_away).toLowerCase()==="away");
 const homeName=homeRow?.team_location||homeRow?.team_name||homeRow?.team_display_name||null;
 const awayName=awayRow?.team_location||awayRow?.team_name||awayRow?.team_display_name||null;
 let target=byId.get(g.id)||null;
 if(target) idMatches++;
 if(!target&&homeName&&awayName){
   const hits=predictionCandidates(byJoinKey,g.date,homeName,awayName);
   if(hits.length===1){target=hits[0];canonicalMatches++}
   else if(hits.length>1){
     const exact=hits.filter(p=>dateKey(p.date)===dateKey(g.date));
     if(exact.length===1){target=exact[0];canonicalMatches++}
     else ambiguousMatches++;
   }
 }
 const homeId=homeRow?teamKey(homeRow):null,awayId=awayRow?teamKey(awayRow):null;
 if(target&&homeId&&awayId){
   const hp=statePlayers(teams.get(homeId)),ap=statePlayers(teams.get(awayId)),home=buildCbbTeamPlayerState(hp),away=buildCbbTeamPlayerState(ap),features=home.ok&&away.ok?cbbPlayerGameFeatures(home,away):{};
   gameSamples.push({id:g.id,season:seasonStart,date:target.date,actualHome:target.actualHome,actualAway:target.actualAway,fbis:target.fbis,kenpom:target.kenpom,market:target.market,homePlayer:home,awayPlayer:away,features});matched++;
   for(const ar of g.rows){
     if(bool(ar.did_not_play))continue;const tid=teamKey(ar),pk=playerKey(ar),st=teams.get(tid)?.get(pk),p=pseudo(st);if(!p||p.games<2||p.projectedMinutes<8)continue;
     const side=String(ar.home_away).toLowerCase()==="home"?"home":"away";
     const points=n(ar.points),reb=n(ar.rebounds),ast=n(ar.assists),thr=n(ar.three_point_field_goals_made);if([points,reb,ast,thr].some(x=>x==null))continue;
     propSamples.push({gameId:g.id,season:seasonStart,date:target.date,side,playerId:pk,playerName:ar.athlete_display_name||p.name,team:ar.team_location||ar.team_name,position:ar.athlete_position_abbreviation||null,prior:p,game:{possessions:target.fbis?.possessions??null,baseHome:target.fbis?.home??null,baseAway:target.fbis?.away??null,reliability:target.fbis?.reliability??null},actual:{points,rebounds:reb,assists:ast,three_pointers_made:thr,points_rebounds_assists:points+reb+ast}});
   }
 }
 for(const row of g.rows){const tid=teamKey(row),pk=playerKey(row);if(!tid||!pk)continue;if(!teams.has(tid))teams.set(tid,new Map());const tm=teams.get(tid);if(!tm.has(pk))tm.set(pk,blankPlayer(row));updatePlayer(tm.get(pk),row)}
}
const out={ok:true,season:seasonStart,source:URL,playerRows:raw.length,gamesInSource:games.length,targetGames:preds.length,matchedGames:matched,idMatches,canonicalMatches,ambiguousMatches,gameSamples,propSamples};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-player-history-"+seasonStart+".json",JSON.stringify(out));console.log(JSON.stringify({season:seasonStart,playerRows:raw.length,targetGames:preds.length,matchedGames:matched,idMatches,canonicalMatches,ambiguousMatches,gameSamples:gameSamples.length,propSamples:propSamples.length},null,2));
