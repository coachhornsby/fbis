import {writeFileSync,mkdirSync} from "node:fs";
import {buildFbisCbbRatings,normalizeFbisCbbGameTeamRows} from "../functions/lib/cbbFbisRatings.js";
import {conferenceForTeamSeason} from "../functions/lib/cbbConferenceMembership.js";

const SEASON_START=2025;
const AS_OF="2026-05-15T00:00:00Z";
const BOX_URL="https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_mens_college_basketball_team_boxscores/team_box_2026.csv";
const CURRENT_ARENAS_URL="https://en.wikipedia.org/wiki/List_of_NCAA_Division_I_basketball_arenas";
const LEGACY_ARENAS_URL="https://raw.githubusercontent.com/dilernia/NCAA/master/ncaa_arenas_full.csv";
const ELEVATION_URL="https://api.open-meteo.com/v1/elevation";
const GEOCODE_URL="https://geocoding-api.open-meteo.com/v1/search";
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};

const alias={
 "uconn":"connecticut","umass":"massachusetts","usc":"southern california","miami fl":"miami florida",
 "miami ohio":"miami oh","nc state":"north carolina state","unc":"north carolina",
 "utrgv":"texas rio grande valley","ut rio grande valley":"texas rio grande valley","utsa":"texas san antonio",
 "ut san antonio":"texas san antonio","ut arlington":"texas arlington","fau":"florida atlantic",
 "fiu":"florida international","uic":"illinois chicago","siu edwardsville":"siue",
 "saint marys":"st marys","st marys ca":"st marys","san jose state":"san jose state",
 "east texas a and m":"texas a and m commerce","texas a and m commerce":"texas a and m commerce",
 "mcneese state":"mcneese","mcneese":"mcneese","sam houston state":"sam houston",
 "tarleton state":"tarleton","tarleton":"tarleton","hawaii":"hawaii",
 "milwaukee":"milwaukee","wisconsin milwaukee":"milwaukee","green bay":"green bay",
 "wisconsin green bay":"green bay","pennsylvania":"penn","st johns":"st johns",
 "saint johns":"st johns","mount st marys":"mount st marys","mt st marys":"mount st marys",
 "south florida":"usf","houston christian":"houston baptist","long island university":"long island",
 "loyola maryland":"loyola md","se louisiana":"southeastern louisiana","cal state bakersfield":"csu bakersfield",
 "charleston":"college of charleston","utah tech":"dixie state","seattle u":"seattle","xavier":"xaiver"
};
const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
 .replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()
 .replace(/\bsaint\b/g,"st");
const canon=v=>alias[norm(v)]||norm(v);

function parseCsv(text){
 const lines=String(text).trim().split(/\r?\n/),out=[];let head=null;
 for(const line of lines){
  const cells=[];let s="",q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(ch===","&&!q){cells.push(s);s=""}else s+=ch}cells.push(s);
  if(!head){head=cells;continue}
  out.push(Object.fromEntries(head.map((h,i)=>[h,cells[i]??""])));
 }
 return out;
}
function decodeHtml(s){
 return String(s||"").replace(/<sup[\s\S]*?<\/sup>/gi,"")
  .replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"")
  .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&")
  .replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&ndash;/g,"–").replace(/&mdash;/g,"—")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g," ").trim();
}
function parseCurrentArenas(html){
 const m=String(html).match(/<table[^>]*class="[^"]*wikitable[^"]*sortable[^"]*"[^>]*>[\s\S]*?<\/table>/i);
 if(!m)return[];
 const rows=[];
 for(const tr of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>decodeHtml(x[1]));
  if(cells.length<8)continue;
  let team=cells[4];if(/\bwomen\b/i.test(team))continue;team=team.replace(/\s+men$/i,"").trim();
  const capacity=num(String(cells[6]).replace(/[^0-9.]/g,""));
  if(!team||!cells[1]||capacity==null)continue;
  rows.push({arena:cells[1],city:cells[2],state:cells[3],team,conference:cells[5],capacity});
 }
 return rows;
}
async function loadBox(){
 const res=await fetch(BOX_URL,{redirect:"follow"});if(!res.ok)throw new Error("SportsDataverse box source "+res.status);
 const raw=parseCsv(await res.text()),rows=[];
 for(const x of raw){
  const n=k=>num(x[k]),fgm=n("field_goals_made"),fga=n("field_goals_attempted"),tpm=n("three_point_field_goals_made"),tpa=n("three_point_field_goals_attempted"),
   ftm=n("free_throws_made"),fta=n("free_throws_attempted"),orb=n("offensive_rebounds"),drb=n("defensive_rebounds"),tov=n("turnovers")??n("total_turnovers")??n("team_turnovers");
  const team=x.team_location||x.team_display_name,opponent=x.opponent_team_location||x.opponent_team_display_name;
  rows.push({gameId:String(x.game_id||""),startDate:x.game_date_time||x.game_date,season:SEASON_START,team,opponent,
   conference:conferenceForTeamSeason(team,SEASON_START),isHome:x.team_home_away==="home",neutral:false,
   fgm,fga,threeMade:tpm,threeAtt:tpa,ftm,fta,orb,drb,turnovers:tov,possessions:fga!=null&&orb!=null&&tov!=null&&fta!=null?fga-orb+tov+.475*fta:null});
 }
 return normalizeFbisCbbGameTeamRows(rows,SEASON_START);
}
async function legacyArenas(){
 const res=await fetch(LEGACY_ARENAS_URL);if(!res.ok)return[];
 return parseCsv(await res.text());
}
async function currentArenas(){
 try{
  const res=await fetch(CURRENT_ARENAS_URL,{headers:{"user-agent":"FBIS research venue metadata/1.0"}});
  if(!res.ok)throw new Error("HTTP "+res.status);
  const rows=parseCurrentArenas(await res.text());
  if(rows.length<300)throw new Error("only "+rows.length+" current arena rows parsed");
  return rows;
 }catch(err){console.warn("current arena source failed",String(err?.message||err));return[]}
}
async function elevationFor(points){
 const out=new Map();
 for(let i=0;i<points.length;i+=75){
  const b=points.slice(i,i+75);
  const res=await fetch(ELEVATION_URL+"?latitude="+encodeURIComponent(b.map(x=>x.lat).join(","))+"&longitude="+encodeURIComponent(b.map(x=>x.lng).join(","))).catch(()=>null);
  if(!res?.ok)continue;const body=await res.json();const vals=Array.isArray(body.elevation)?body.elevation:[body.elevation];
  b.forEach((p,j)=>{const v=num(vals[j]);if(v!=null)out.set(p.key,v)});
 }
 return out;
}
async function geocode(city,state){
 try{
  const q=city+" "+state;
  const res=await fetch(GEOCODE_URL+"?name="+encodeURIComponent(q)+"&count=5&language=en&format=json&countryCode=US");
  if(!res.ok)return null;const body=await res.json();const x=(body.results||[])[0];if(!x)return null;
  return {lat:num(x.latitude),lng:num(x.longitude),elevation:num(x.elevation)};
 }catch{return null}
}

const box=await loadBox();
const catalog=buildFbisCbbRatings(box,{asOf:AS_OF,season:SEASON_START,iterations:24});
const ratingByKey=new Map();
for(const r of Object.values(catalog.byTeamId||{})){
 if(!conferenceForTeamSeason(r.team,SEASON_START))continue;
 ratingByKey.set(canon(r.team),r);
}

const [current,legacy]=await Promise.all([currentArenas(),legacyArenas()]);
const legacyByKey=new Map(legacy.map(v=>[canon(v.team),v]));
const currentByKey=new Map();
for(const v of current){const k=canon(v.team);if(!currentByKey.has(k))currentByKey.set(k,v)}
// If the current web table cannot be parsed, fall back to the legacy directory.
if(!currentByKey.size)for(const v of legacy)currentByKey.set(canon(v.team),{team:v.team,arena:v.arena,city:v.city,state:v.state,conference:v.conference,capacity:num(v.capacity)});

const allKeys=new Set([...ratingByKey.keys()]);
const coordinatePoints=[],baseRows=[];
for(const k of allKeys){
 const rating=ratingByKey.get(k)||null;
 if(!rating)continue;
 const venue=currentByKey.get(k)||null;
 const old=legacyByKey.get(k)||null;
 let lat=num(old?.lat),lng=num(old?.lng),coordBasis=old?"legacy venue coordinate":null;
 baseRows.push({key:k,venue,rating,lat,lng,coordBasis});
 if(lat!=null&&lng!=null)coordinatePoints.push({key:k,lat,lng});
}
const elevations=await elevationFor(coordinatePoints);
for(const x of baseRows){
 if(elevations.has(x.key))continue;
 const venue=x.venue;if(!venue?.city)continue;
 const g=await geocode(venue.city,venue.state);
 if(g?.elevation!=null){elevations.set(x.key,g.elevation);x.coordBasis="current arena city geocode"}
 else if(g?.lat!=null&&g?.lng!=null){const one=await elevationFor([{key:x.key,lat:g.lat,lng:g.lng}]);if(one.has(x.key)){elevations.set(x.key,one.get(x.key));x.coordBasis="current arena city geocode"}}
}
const globalHca=num(catalog?.national?.globalHca)??4.4096;
let data=baseRows.map(x=>{
 const r=x.rating,v=x.venue;
 const hca=num(r.hca)??globalHca,hcaGames=num(r.hcaGames)??0;
 return {
  school:r.team,arena:v?.arena||null,capacity:num(v?.capacity),altitudeFt:elevations.has(x.key)?Math.round(elevations.get(x.key)*3.28084):null,
  hcaPpg:Number(hca.toFixed(3)),hcaGames,conference:r?.conference||v?.conference||null,reliability:num(r?.reliability)??0,
  hcaBasis:hcaGames>0?"team residual + hierarchical shrinkage":"FBIS global prior (no team home sample)",
  dataThrough:hcaGames>0?"2026-04-06":"2026-27 preseason prior",venueSource:v?"Wikipedia current NCAA D-I arena table":null,
  altitudeSource:elevations.has(x.key)?"Open-Meteo elevation at venue/city coordinates":null,coordinateBasis:x.coordBasis
 };
});
data.sort((a,b)=>b.hcaPpg-a.hcaPpg||a.school.localeCompare(b.school));data=data.map((r,i)=>({rank:i+1,...r}));
const report={id:"FBIS-CBB-HCA-RANKINGS-v2",generatedAt:new Date().toISOString(),model:"FBIS-CBB-HCA-v1",independent:true,kenpomInput:false,
 seasonBaseline:"2025-26 end-of-season / 2026-27 preseason",globalHcaPpg:Number(globalHca.toFixed(3)),teams:data.length,
 venueCoveragePct:Number((100*data.filter(x=>x.arena&&x.capacity!=null).length/Math.max(1,data.length)).toFixed(2)),
 altitudeCoveragePct:Number((100*data.filter(x=>x.altitudeFt!=null).length/Math.max(1,data.length)).toFixed(2)),data};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-hca-rankings-v1.json",JSON.stringify(report,null,2));
const esc=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
const header=["Rank","School","Arena","Capacity","Altitude (ft)","FBIS HCA PPG","HCA Home Games","Conference","Reliability","HCA Basis","Data Through","Altitude Basis"];
const csv=[header.map(esc).join(","),...data.map(r=>[r.rank,r.school,r.arena,r.capacity,r.altitudeFt,r.hcaPpg,r.hcaGames,r.conference,r.reliability,r.hcaBasis,r.dataThrough,r.coordinateBasis].map(esc).join(","))].join("\n");
writeFileSync("artifacts/cbb-hca-rankings-v1.csv",csv);
console.log(JSON.stringify({teams:data.length,venueCoveragePct:report.venueCoveragePct,altitudeCoveragePct:report.altitudeCoveragePct,globalHcaPpg:report.globalHcaPpg,top10:data.slice(0,10),missingVenue:data.filter(x=>!x.arena).slice(0,30).map(x=>x.school)},null,2));
