import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {buildFbisCbbRatings,projectFbisCbbGame,normalizeFbisCbbGameTeamRows,lookupFbisCbbRating} from "../functions/lib/cbbFbisRatings.js";
import {mapSourceTeam} from "../functions/lib/collegeIdentity.js";

const BASE=process.env.FBIS_BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
const benchmarkPath=process.argv[2]||"artifacts/source/cbb-data-stack-predictions.json";
const marketPath=process.argv[3]||"artifacts/source/cbb-market-research-dataset.json";
if(!SECRET)throw new Error("HARVEST_SECRET required");
const benchmark=JSON.parse(readFileSync(benchmarkPath,"utf8"));
const marketRows=JSON.parse(readFileSync(marketPath,"utf8"));
const marketById=new Map(marketRows.map(r=>[String(r.id),r]));
const seasons=[2018,2019,2020,2021,2022,2023,2024,2025];
const num=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=3)=>v==null?null:Number(Number(v).toFixed(d));
const key=v=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();

function csvLine(line){const out=[];let s="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(ch===","&&!q){out.push(s);s=""}else s+=ch}out.push(s);return out}
function parseCsv(text){const lines=String(text).trim().split(/\r?\n/);const h=csvLine(lines.shift());const idx=Object.fromEntries(h.map((x,i)=>[x,i]));return lines.filter(Boolean).map(line=>{const x=csvLine(line),r={};for(const[k,i]of Object.entries(idx))r[k]=x[i]??"";return r})}
async function loadBox(season){
  const endYear=season+1,url="https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_mens_college_basketball_team_boxscores/team_box_"+endYear+".csv";
  const res=await fetch(url,{redirect:"follow"});if(!res.ok)throw new Error("SportsDataverse "+endYear+" "+res.status);
  const raw=parseCsv(await res.text()),rows=[];
  for(const x of raw){
    const n=k=>num(x[k]),fgm=n("field_goals_made"),fga=n("field_goals_attempted"),tpm=n("three_point_field_goals_made"),tpa=n("three_point_field_goals_attempted"),ftm=n("free_throws_made"),fta=n("free_throws_attempted"),orb=n("offensive_rebounds"),drb=n("defensive_rebounds"),tov=n("turnovers")??n("total_turnovers")??n("team_turnovers");
    rows.push({gameId:String(x.game_id||""),startDate:x.game_date_time||x.game_date,season,team:x.team_location||x.team_display_name,opponent:x.opponent_team_location||x.opponent_team_display_name,
      isHome:x.team_home_away==="home",neutral:false,fgm,fga,threeMade:tpm,threeAtt:tpa,ftm,fta,orb,drb,turnovers:tov,possessions:fga!=null&&orb!=null&&tov!=null&&fta!=null?fga-orb+tov+.475*fta:null});
  }
  return rows;
}
async function source(kind,params={}){
  const u=new URL("/api/cbb-walkforward-source",BASE);u.searchParams.set("kind",kind);for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});const body=await res.json().catch(()=>null);
  if(!res.ok||!body?.ok)throw new Error(kind+" "+res.status+" "+(body?.error||"unknown"));return body;
}
async function conferenceMap(season){
  const r=await source("team-meta",{season});const m=new Map();
  for(const x of r.rows||[])if(x.team&&x.conference)m.set(key(x.team),x.conference);
  return m;
}
function teamRef(name,season){const m=mapSourceTeam("cbb",{team:name,school:name},season);return m.ok?{canonicalId:m.canonicalId,school:m.school,name:m.school}:{school:name,name}}
function metrics(rows,which){
  let n=0,me=0,te=0,w=0,bias=0;
  for(const r of rows){const p=r[which];if(!p)continue;const am=r.actualHome-r.actualAway,at=r.actualHome+r.actualAway;n++;me+=Math.abs(p.margin-am);te+=Math.abs(p.total-at);bias+=p.total-at;if((p.margin>0)===(am>0))w++}
  return n?{n,marginMae:round(me/n),totalMae:round(te/n),totalBias:round(bias/n),winnerAccuracy:round(100*w/n,2)}:{n:0,marginMae:null,totalMae:null,totalBias:null,winnerAccuracy:null};
}
function betStats(rows,kind,threshold,directionMode="fbis"){
  let n=0,w=0,l=0,p=0,u=0;
  for(const r of rows){
    const line=kind==="total"?num(r.market?.overUnder):num(r.market?.spread);if(line==null)continue;
    const f=kind==="total"?r.fbis.total-line:r.fbis.margin+line;
    if(Math.abs(f)<threshold)continue;
    if(directionMode==="disagree"&&r.kenpom){const k=kind==="total"?r.kenpom.total-line:r.kenpom.margin+line;if(!k||Math.sign(k)===Math.sign(f))continue}
    const actual=kind==="total"?(r.actualHome+r.actualAway-line):(r.actualHome-r.actualAway+line);
    n++;if(actual===0){p++;continue}if(Math.sign(actual)===Math.sign(f)){w++;u+=100/110}else{l++;u-=1}
  }
  return{n,w,l,p,winPct:w+l?round(100*w/(w+l),2):null,units:round(u),roi:n?round(100*u/n,2):null};
}

const out=[],coverage=[];
for(const season of seasons){
  const [box0,conf]=await Promise.all([loadBox(season),conferenceMap(season)]);
  const box=box0.map(r=>({...r,conference:conf.get(key(r.team))||null}));
  const normalized=normalizeFbisCbbGameTeamRows(box,season);
  const targets=benchmark.filter(r=>Number(r.season)===season&&r.kenpom).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const byDate=new Map();for(const r of targets){if(!byDate.has(r.date))byDate.set(r.date,[]);byDate.get(r.date).push(r)}
  let projected=0;
  for(const date of [...byDate.keys()].sort()){
    const catalog=buildFbisCbbRatings(normalized,{asOf:date+"T00:00:00Z",season,iterations:16});
    for(const r of byDate.get(date)){
      const home=lookupFbisCbbRating(catalog,teamRef(r.home,season)),away=lookupFbisCbbRating(catalog,teamRef(r.away,season));
      const fbis=projectFbisCbbGame({neutral:r.neutral},home,away);if(!fbis.ok)continue;
      projected++;
      const mr=marketById.get(String(r.id));
      out.push({id:r.id,season,date:r.date,home:r.home,away:r.away,neutral:r.neutral,actualHome:r.actualHome,actualAway:r.actualAway,fbis,kenpom:r.kenpom,
        market:mr?.market||null,homeRating:home?{games:home.games,sos:home.sos,nonConferenceSos:home.nonConferenceSos,conference:home.conference,conferenceStrength:home.conferenceStrength,reliability:home.reliability}:null,
        awayRating:away?{games:away.games,sos:away.sos,nonConferenceSos:away.nonConferenceSos,conference:away.conference,conferenceStrength:away.conferenceStrength,reliability:away.reliability}:null});
    }
  }
  coverage.push({season,boxRows:normalized.length,conferenceTeams:conf.size,benchmarkRows:targets.length,projected});
  console.log("season",season,"projected",projected,"of",targets.length);
}

const discovery=out.filter(r=>r.season<=2022),validation=out.filter(r=>r.season===2023||r.season===2024),confirmation=out.filter(r=>r.season===2025);
function compare(rs){const f=metrics(rs,"fbis"),k=metrics(rs,"kenpom");return{fbis:f,kenpom:k,totalMaeAdvantage:k.totalMae!=null&&f.totalMae!=null?round(k.totalMae-f.totalMae):null,marginMaeAdvantage:k.marginMae!=null&&f.marginMae!=null?round(k.marginMae-f.marginMae):null}}
const bands=[[0,1,"0-1"],[1,2,"1-2"],[2,3,"2-3"],[3,4,"3-4"],[4,6,"4-6"],[6,8,"6-8"],[8,1e9,"8+"]];
const disagreement={};
for(const[lo,hi,name]of bands){const rs=out.filter(r=>{const d=Math.abs(r.fbis.total-r.kenpom.total);return d>=lo&&d<hi});disagreement[name]={...compare(rs),n:rs.length}}
const marketTests={};
for(const t of [2,3,4,5,6])marketTests["totalEdge"+t]={all:betStats(out,"total",t),validation:betStats(validation,"total",t),confirmation:betStats(confirmation,"total",t),disagreeConfirmation:betStats(confirmation,"total",t,"disagree")};
const report={ok:true,id:"FBIS-CBB-RATINGS-v1-WALKFORWARD",generatedAt:new Date().toISOString(),coverage,
  methodology:{independent:true,marketInformed:false,kenpomInput:false,torvikInput:false,cutoff:"ratings use prior completed games only; game date excluded",development:"2018-22",validation:"2023-24",confirmation:"2025",conference:"CBBD identity metadata only; no external conference strength ratings",priceAssumption:"-110 for historical market accounting"},
  samples:{all:compare(out),discovery:compare(discovery),validation:compare(validation),confirmation:compare(confirmation)},bySeason:Object.fromEntries(seasons.map(s=>[s,compare(out.filter(r=>r.season===s))])),
  disagreement,marketTests,
  promotion:{totalPass:Boolean(compare(validation).totalMaeAdvantage>0&&compare(confirmation).totalMaeAdvantage>0),marginPass:Boolean(compare(validation).marginMaeAdvantage>0&&compare(confirmation).marginMaeAdvantage>0),requiresOperatorApproval:true,canAuthorizeWager:false},
  rows:out.length};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-fbis-native-v1-walkforward.json",JSON.stringify(report,null,2));writeFileSync("artifacts/cbb-fbis-native-v1-predictions.json",JSON.stringify(out));console.log(JSON.stringify(report,null,2));
