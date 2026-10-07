#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [,,src="artifacts/cbb-phase-b-source/raw",out="artifacts/cbb-phase-b-source"]=process.argv;
mkdirSync(out,{recursive:true});

function parseCsv(text){
  const rows=[]; let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"') quoted=false;
      else field+=ch;
    } else if(ch==='"') quoted=true;
    else if(ch===','){row.push(field);field="";}
    else if(ch==='\n'){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";}
    else field+=ch;
  }
  if(field||row.length){row.push(field.replace(/\r$/,""));rows.push(row);}
  if(!rows.length)return[];
  const h=rows.shift();
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
const load=n=>parseCsv(readFileSync(src+"/"+n,"utf8"));
const roster=load("rosters_2027.csv");
const teamX=load("mbb_team_crosswalk_2026.csv");
const games=load("mbb_schedule_2027.csv");
const stats=load("player_season_stats_2026.csv");
const gameRosters=load("game_rosters_2026.csv");
const playerBox=load("player_box_2026.csv");

const rosterByTeam=new Map();
for(const r of roster){
  if(!r.team_id||!r.athlete_id)continue;
  const k=String(r.team_id);
  if(!rosterByTeam.has(k))rosterByTeam.set(k,{id:k,teamId:k,team:r.team_display_name||r.team_short_display_name||r.team_slug,players:[]});
  rosterByTeam.get(k).players.push({
    id:String(r.athlete_id),athleteId:String(r.athlete_id),name:r.full_name||r.display_name,
    position:r.position_abbreviation||r.position_name||null,
    year:r.experience_display_value||r.experience_years||null,
    height:r.height||null,weight:r.weight||null,jersey:r.jersey||null,uid:r.uid||null,guid:r.guid||null
  });
}
const teams=teamX.filter(r=>r.espn_team_id).map(r=>({
  id:String(r.espn_team_id),teamId:String(r.espn_team_id),
  school:r.espn_display_name||r.espn_location||r.espn_short_name,
  team:r.espn_display_name||r.espn_location||r.espn_short_name,
  name:r.espn_display_name||r.espn_location||r.espn_short_name,
  conference:r.espn_conference||null
}));
const gameRows=games.filter(r=>(r.game_id||r.id)&&r.home_id&&r.away_id).map(r=>({
  id:String(r.game_id||r.id),gameId:String(r.game_id||r.id),
  startDate:r.game_date_time||r.start_date||r.date,
  homeTeam:r.home_display_name||r.home_name||r.home_location,
  homeTeamId:String(r.home_id),
  awayTeam:r.away_display_name||r.away_name||r.away_location,
  awayTeamId:String(r.away_id),
  neutralSite:String(r.neutral_site).toLowerCase()==="true",
  venueId:r.venue_id||null,venueName:r.venue_full_name||null
}));
const byPlayerTeam=new Map();
for(const r of stats){
  if(!r.athlete_id||!r.team_id)continue;
  const k=String(r.athlete_id)+"|"+String(r.team_id);
  if(!byPlayerTeam.has(k))byPlayerTeam.set(k,{athleteId:String(r.athlete_id),teamId:String(r.team_id),team:r.team_display_name||null,games:0,starts:0,minutes:0,usage:null});
  const o=byPlayerTeam.get(k),name=String(r.stat_name||r.stat_label||"").toLowerCase(),v=Number(r.value);
  if(!Number.isFinite(v))continue;
  if(["games","gamesplayed","games_played"].includes(name))o.games=Math.max(o.games,v);
  else if(["starts","gamesstarted","games_started"].includes(name))o.starts=Math.max(o.starts,v);
  else if(name==="minutes")o.minutes=Math.max(o.minutes,v);
  else if(["usage","usagerate","usage_rate"].includes(name))o.usage=v;
}
const pb=new Map();
for(const r of playerBox){
  if(!r.athlete_id||!r.team_id)continue;
  const k=String(r.athlete_id)+"|"+String(r.team_id);
  if(!pb.has(k))pb.set(k,{games:new Set(),starts:0,minutes:0,team:r.team_display_name||r.team_name||null});
  const o=pb.get(k); if(r.game_id)o.games.add(String(r.game_id));
  if(String(r.starter).toLowerCase()==="true")o.starts++;
  const m=Number(r.minutes); if(Number.isFinite(m))o.minutes+=m;
}
const gr=new Map();
for(const r of gameRosters){
  if(!r.athlete_id||!r.team_id)continue;
  const k=String(r.athlete_id)+"|"+String(r.team_id);
  if(!gr.has(k))gr.set(k,{games:new Set(),starts:0,team:r.team_display_name||null});
  const o=gr.get(k); if(r.game_id)o.games.add(String(r.game_id));
  if(String(r.starter).toLowerCase()==="true")o.starts++;
}
for(const [k,p] of pb){
  if(!byPlayerTeam.has(k)){const [athleteId,teamId]=k.split("|");byPlayerTeam.set(k,{athleteId,teamId,team:p.team,games:0,starts:0,minutes:0,usage:null});}
  const o=byPlayerTeam.get(k);o.games=Math.max(o.games,p.games.size);o.starts=Math.max(o.starts,p.starts);o.minutes=Math.max(o.minutes,p.minutes);
}
for(const [k,g] of gr){
  if(!byPlayerTeam.has(k)){const [athleteId,teamId]=k.split("|");byPlayerTeam.set(k,{athleteId,teamId,team:g.team,games:0,starts:0,minutes:0,usage:null});}
  const o=byPlayerTeam.get(k);o.games=Math.max(o.games,g.games.size);o.starts=Math.max(o.starts,g.starts);
}
writeFileSync(out+"/rosters.json",JSON.stringify([...rosterByTeam.values()]));
writeFileSync(out+"/teams.json",JSON.stringify(teams));
writeFileSync(out+"/games.json",JSON.stringify(gameRows));
writeFileSync(out+"/player-stats.json",JSON.stringify([...byPlayerTeam.values()]));
console.log(JSON.stringify({rosterRows:roster.length,rosterTeams:rosterByTeam.size,teamCrosswalkRows:teams.length,games:gameRows.length,playerStatRows:stats.length,gameRosterRows:gameRosters.length,playerBoxRows:playerBox.length,aggregatedPlayerStats:byPlayerTeam.size},null,2));
