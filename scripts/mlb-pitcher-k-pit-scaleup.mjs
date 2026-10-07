#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { buildLineupMatchup, buildStatcastProfiles } from "../functions/lib/mlbPitchMatchup.js";
import { parseStatcastCsv } from "../functions/lib/mlbPitchMatchupFeed.js";
import { MLB_DEEP_ID, MLB_DEEP_VERSION, MLB_PITCH_ZONE_K_CALIBRATION } from "../functions/lib/mlbDeepModel.js";

const BASE=process.env.BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
const START_DATE=process.env.START_DATE||"2026-08-27";
const END_DATE=process.env.END_DATE||"2026-10-05";
const OUT=process.env.OUT||"artifacts/mlb-pitcher-k-pit-scaleup.json";
const LOOKBACK_DAYS=90;
const LEAGUE_K_RATE=0.225;
const UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const MARKET_ALIASES=new Set([
  "SPORTSBOOK_PROP:player_strikeouts",
  "SPORTSBOOK_PROP:player_pitcher_strikeouts",
  "SPORTSBOOK_PROP:player_strikeouts_thrown",
]);
const BOOK_PRIORITY=[
  "pinnacle","bet365","caesars","draftkings","fanduel","betrivers","fanatics","betmgm","parx casino","bovada",
];
const ECONOMIC_BOOKS=new Set(BOOK_PRIORITY);
const EVIDENCE_CLASS="HISTORICAL_PIT_RECONSTRUCTED";
const CHECKPOINT_ORDER={EARLY:1,MORNING:2,MIDDAY:3,PREGAME:4,CLOSE:5,CURRENT:6};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const round=(v,d=4)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const mean=xs=>{const v=xs.filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
const median=xs=>{const v=xs.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2};
const mae=xs=>mean(xs.map(Math.abs));
const rmse=xs=>{const v=xs.filter(Number.isFinite);return v.length?Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length):null};
const day=v=>new Date(v).toISOString().slice(0,10);
const shift=(d,n)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
function norm(s){
  let z=String(s||"").trim();
  const ix=z.lastIndexOf(" ("); if(ix>0&&z.endsWith(")"))z=z.slice(0,ix);
  return z.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[.'’]/g,"").replace(/\b(ii|iii|iv|jr|sr)\b/g,"").replace(/[^a-z0-9]+/g," ").trim();
}
const bookNorm=s=>String(s||"").trim().toLowerCase();
function americanImplied(odds){const o=finite(odds);if(o==null||o===0)return null;return o>0?100/(o+100):(-o)/((-o)+100)}
function noVig(over,under){
  const a=americanImplied(over),b=americanImplied(under); if(a==null||b==null||a+b<=0)return null;
  return {over:a/(a+b),under:b/(a+b)};
}
function profitAtAmerican(odds,result){
  if(result==="PUSH")return 0;
  if(result==="LOSS")return -1;
  if(result!=="WIN")return null;
  const o=finite(odds);if(o==null||o===0)return null;
  return o>0?o/100:100/(-o);
}
function resultAgainst(actual,line,side){
  if(!Number.isFinite(actual)||!Number.isFinite(line)||!side)return null;
  if(actual===line)return "PUSH";
  if(side==="OVER")return actual>line?"WIN":"LOSS";
  if(side==="UNDER")return actual<line?"WIN":"LOSS";
  return null;
}
async function fetchRetry(url,{text=false,headers={},retries=4}={}){
  let last;
  for(let i=0;i<retries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:text?"text/csv,*/*":"application/json","User-Agent":UA,...headers}});
      if(r.ok)return text?r.text():r.json();
      last=new Error("HTTP "+r.status+" "+url);
    }catch(e){last=e}
    if(i<retries-1)await sleep(500*(i+1));
  }
  throw last;
}
async function source(path){
  if(!SECRET)throw new Error("HARVEST_SECRET required");
  return fetchRetry(BASE+path,{headers:{"x-harvest-secret":SECRET}});
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={error:String(e?.message||e),item:items[i]}}}}
  await Promise.all(Array.from({length:limit},worker));return out;
}
function startingLineup(teamBox={}){
  const players=teamBox.players||{};
  const candidates=Object.values(players).map(p=>({id:Number(p.person?.id),order:Number(p.battingOrder),name:p.person?.fullName||null}))
    .filter(p=>Number.isFinite(p.id)&&Number.isFinite(p.order)&&p.order>0).sort((a,b)=>a.order-b.order);
  const starters=candidates.filter(p=>p.order%100===0); if(starters.length>=8)return starters.slice(0,9);
  const bySlot=new Map();for(const p of candidates){const slot=Math.floor(p.order/100);if(slot>=1&&slot<=9&&!bySlot.has(slot))bySlot.set(slot,p)}
  return [...bySlot.entries()].sort((a,b)=>a[0]-b[0]).map(([,p])=>p).slice(0,9);
}
function startingPitcher(teamBox={}){
  const id=Number((teamBox.pitchers||[])[0]);if(!Number.isFinite(id))return null;
  const p=teamBox.players?.["ID"+id];return {id,name:p?.person?.fullName||null,actualKs:finite(p?.stats?.pitching?.strikeOuts)};
}
const statsCache=new Map();
async function statsJson(key,url){if(statsCache.has(key))return statsCache.get(key);const p=fetchRetry(url).catch(()=>null);statsCache.set(key,p);return p}
async function pitcherStats(id,through){
  const u=new URL("https://statsapi.mlb.com/api/v1/people/"+id+"/stats");
  u.searchParams.set("stats","byDateRange");u.searchParams.set("group","pitching");u.searchParams.set("startDate","2026-03-01");u.searchParams.set("endDate",through);u.searchParams.set("gameType","R");
  const j=await statsJson("p:"+id+":"+through,u);const st=j?.stats?.[0]?.splits?.[0]?.stat||{};
  const ip=finite(st.inningsPitched),gs=finite(st.gamesStarted),so=finite(st.strikeOuts),bf=finite(st.battersFaced);
  return {innings:ip,gamesStarted:gs,strikeOuts:so,battersFaced:bf,
    kPer9:ip>0&&so!=null?so*9/ip:null,inningsPerStart:gs>0&&ip!=null?ip/gs:null,battersFacedPerInning:ip>0&&bf!=null?bf/ip:null};
}
async function teamStats(id,through){
  const u=new URL("https://statsapi.mlb.com/api/v1/teams/"+id+"/stats");
  u.searchParams.set("stats","byDateRange");u.searchParams.set("group","hitting");u.searchParams.set("startDate","2026-03-01");u.searchParams.set("endDate",through);u.searchParams.set("gameType","R");
  const j=await statsJson("t:"+id+":"+through,u);const st=j?.stats?.[0]?.splits?.[0]?.stat||{};
  const so=finite(st.strikeOuts),pa=finite(st.plateAppearances);return{kRate:pa>0&&so!=null?so/pa:null};
}
function csvUrl(role,ids,start,end){
  const u=new URL("https://baseballsavant.mlb.com/statcast_search/csv");
  for(const [k,v] of [["all","true"],["type","details"],["player_type",role],["game_date_gt",start],["game_date_lt",end],["hfGT","R|PO|"],["min_pitches","0"],["min_results","0"],["group_by","name"],["sort_col","pitches"],["sort_order","desc"],["min_pas","0"]])u.searchParams.set(k,v);
  for(const id of ids)u.searchParams.append(role==="pitcher"?"pitchers_lookup[]":"batters_lookup[]",String(id));
  return u;
}
async function profiles(role,ids,gameDate){
  const clean=[...new Set(ids.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);const rows=[];
  const start=shift(gameDate,-LOOKBACK_DAYS),end=shift(gameDate,-1);
  for(let i=0;i<clean.length;i+=45){
    const chunk=clean.slice(i,i+45);if(!chunk.length)continue;
    const csv=await fetchRetry(csvUrl(role,chunk,start,end),{text:true,headers:{Referer:"https://baseballsavant.mlb.com/"}});
    rows.push(...parseStatcastCsv(csv));
    await sleep(120);
  }
  return buildStatcastProfiles(rows,{role,asOf:gameDate+"T00:00:00Z"});
}
function projectionPacket({pitcher,opponentKRate,matchup}){
  const k9=finite(pitcher?.kPer9),ip=clamp(finite(pitcher?.inningsPerStart)??5.35,3,7.5),opp=finite(opponentKRate),lg=LEAGUE_K_RATE;
  const factor=opp!=null?clamp(opp/lg,.78,1.22):1;
  const baseline=k9==null?null:clamp((k9/9)*ip*factor,1,12.5);
  const kr=finite(matchup?.lineupKRate),bfpi=finite(pitcher?.battersFacedPerInning);
  if(kr==null||bfpi==null)return {baseline,projection:null,sigma:null,rawPitchZone:null};
  const bf=clamp(bfpi*ip,12,36),raw=clamp(kr*bf,1,12.5);
  const projection=baseline==null?clamp(raw+MLB_PITCH_ZONE_K_CALIBRATION.offset,1,12.5):
    clamp(baseline*MLB_PITCH_ZONE_K_CALIBRATION.baselineWeight+raw*MLB_PITCH_ZONE_K_CALIBRATION.pitchZoneWeight+MLB_PITCH_ZONE_K_CALIBRATION.offset,1,12.5);
  const sigma=Math.sqrt(Math.max(.25,bf*kr*(1-kr)));
  return {baseline,projection,sigma,rawPitchZone:raw,expectedInnings:ip,expectedBattersFaced:bf,lineupKRate:kr,coverage:finite(matchup?.coverage)};
}
function modeLine(rows){
  const vals=rows.map(x=>finite(x.book_line??x.line)).filter(Number.isFinite);if(!vals.length)return null;
  const counts=new Map();for(const v of vals)counts.set(v,(counts.get(v)||0)+1);const med=median(vals);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||Math.abs(a[0]-med)-Math.abs(b[0]-med)||a[0]-b[0])[0][0];
}
function latestByBook(rows){
  const m=new Map();
  for(const r of rows){
    const b=bookNorm(r.book||r.source);if(!ECONOMIC_BOOKS.has(b))continue;
    const t=Date.parse(r.observed_at||"");if(!Number.isFinite(t))continue;
    const old=m.get(b);if(!old||t>Date.parse(old.observed_at))m.set(b,{...r,book_key:b});
  }
  return [...m.values()];
}
function marketSnapshot(rows,{eventStart,maxAgeHours}={}){
  const eligible=latestByBook(rows).filter(r=>{
    const t=Date.parse(r.observed_at),s=Date.parse(eventStart);return Number.isFinite(t)&&Number.isFinite(s)&&t<s&&(s-t)/3600000<=maxAgeHours;
  });
  const primary=modeLine(eligible);if(primary==null)return {line:null,books:eligible.length,reference:null,rows:eligible};
  const atLine=eligible.filter(r=>finite(r.book_line??r.line)===primary);
  let reference=null;
  for(const b of BOOK_PRIORITY){
    const r=atLine.find(x=>x.book_key===b&&finite(x.book_over_price)!=null&&finite(x.book_under_price)!=null);
    if(r){reference=r;break}
  }
  return {line:primary,books:eligible.length,reference,rows:eligible};
}
function bucketFor(edge){
  const e=Math.abs(edge);if(e<.5)return"0.0-0.49";if(e<1)return"0.5-0.99";if(e<1.5)return"1.0-1.49";if(e<2)return"1.5-1.99";return"2.0+";
}
function rank(xs){
  const ord=xs.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=new Array(xs.length);let i=0;
  while(i<ord.length){let j=i+1;while(j<ord.length&&ord[j].v===ord[i].v)j++;const r=(i+j-1)/2+1;for(let k=i;k<j;k++)out[ord[k].i]=r;i=j}
  return out;
}
function pearson(a,b){if(a.length!==b.length||a.length<2)return null;const ma=mean(a),mb=mean(b);let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;n+=x*y;da+=x*x;db+=y*y}return da&&db?n/Math.sqrt(da*db):null}
function metrics(projections){
  const unique=[...new Map(projections.map(x=>[x.game_id+"|"+x.player_id,x])).values()];
  const calErr=unique.map(x=>x.projection-x.actual_value),baseErr=unique.map(x=>x.baseline_projection-x.actual_value);
  return {uniqueStarts:unique.length,calibrated:{mae:round(mae(calErr)),rmse:round(rmse(calErr)),bias:round(mean(calErr))},
    baseline:{mae:round(mae(baseErr)),rmse:round(rmse(baseErr)),bias:round(mean(baseErr))},
    relativeMaeImprovement:round((mae(baseErr)-mae(calErr))/(mae(baseErr)||1))};
}
function economicSummary(decisions){
  const xs=decisions.filter(x=>x.roi_ready).sort((a,b)=>Date.parse(a.event_start_at)-Date.parse(b.event_start_at)||Date.parse(a.entry_observed_at)-Date.parse(b.entry_observed_at));
  let cum=0,peak=0,maxDd=0;const path=[];
  for(const x of xs){cum+=x.profit_units;peak=Math.max(peak,cum);maxDd=Math.max(maxDd,peak-cum);path.push(round(cum))}
  return {roiReadyN:xs.length,profitUnits:round(cum),roi:xs.length?round(cum/xs.length):null,maxDrawdown:round(maxDd),cumulativeUnits:path};
}

const dateIndex=await source("/api/mlb-pitcher-k-pit-source?mode=dates");
if(!dateIndex.ok)throw new Error("source date index failed");
const archiveDates=(dateIndex.rows||[]).map(x=>x.date).filter(d=>d>=START_DATE&&d<=END_DATE);
const sourceRows=[];
for(const d of archiveDates){
  const j=await source("/api/mlb-pitcher-k-pit-source?date="+encodeURIComponent(d)+"&limit=10000");
  if(!j.ok)throw new Error("source rows failed "+d);
  for(const r of j.rows||[])if(MARKET_ALIASES.has(r.market_type))sourceRows.push(r);
}
const byGame=new Map();for(const r of sourceRows){const k=String(r.game_id);if(!byGame.has(k))byGame.set(k,[]);byGame.get(k).push(r)}
const gameIds=[...byGame.keys()];
console.error("SOURCE dates="+archiveDates.length+" rows="+sourceRows.length+" games="+gameIds.length);

const gameContexts=(await mapLimit(gameIds,6,async gameId=>{
  const feed=await fetchRetry("https://statsapi.mlb.com/api/v1.1/game/"+gameId+"/feed/live");
  if(String(feed?.gameData?.status?.abstractGameState||"").toLowerCase()!=="final")return {gameId,reject:"NOT_FINAL"};
  const officialDate=String(feed?.gameData?.datetime?.officialDate||feed?.gameData?.datetime?.dateTime||"").slice(0,10);
  const start=feed?.gameData?.datetime?.dateTime||null,box=feed?.liveData?.boxscore?.teams;
  if(!box?.home||!box?.away)return {gameId,reject:"MISSING_BOXSCORE"};
  const homeSp=startingPitcher(box.home),awaySp=startingPitcher(box.away),homeLine=startingLineup(box.home),awayLine=startingLineup(box.away);
  if(!homeSp||!awaySp||homeLine.length<8||awayLine.length<8)return {gameId,reject:"MISSING_STARTER_OR_LINEUP"};
  const homeTeam=Number(feed?.gameData?.teams?.home?.id),awayTeam=Number(feed?.gameData?.teams?.away?.id);
  return {gameId,officialDate,start,homeTeam,awayTeam,homeSp,awaySp,homeLine,awayLine,rows:byGame.get(String(gameId))||[]};
})).filter(Boolean);

const rejects={};const inc=k=>rejects[k]=(rejects[k]||0)+1;
for(const g of gameContexts){
  if(g?.error&&!g.reject)g.reject="GAME_CONTEXT_ERROR";
  if(!g?.reject&&(!g?.homeSp||!g?.awaySp||!Array.isArray(g?.homeLine)||!Array.isArray(g?.awayLine)))g.reject="INCOMPLETE_GAME_CONTEXT";
  if(g?.reject)inc(g.reject);
}
const usableGames=gameContexts.filter(g=>!g.reject&&g.homeSp&&g.awaySp&&Array.isArray(g.homeLine)&&Array.isArray(g.awayLine));
const byOfficialDate=new Map();for(const g of usableGames){if(!byOfficialDate.has(g.officialDate))byOfficialDate.set(g.officialDate,[]);byOfficialDate.get(g.officialDate).push(g)}

const projectionRows=[];
const identityDiagnostics={resolvedExact:0,resolvedEventContext:0,ambiguous:0,nonStarter:0,malformed:0};
for(const [officialDate,games] of [...byOfficialDate.entries()].sort()){
  const pids=games.flatMap(g=>[g.homeSp.id,g.awaySp.id]);
  const bids=games.flatMap(g=>[...g.homeLine.map(x=>x.id),...g.awayLine.map(x=>x.id)]);
  let pProfiles={},bProfiles={};
  try{[pProfiles,bProfiles]=await Promise.all([profiles("pitcher",pids,officialDate),profiles("batter",bids,officialDate)])}
  catch(e){console.error("PROFILE_FAIL "+officialDate+" "+String(e?.message||e));for(const g of games)inc("PROFILE_FETCH_FAILED");continue}
  await mapLimit(games,5,async g=>{
    const through=shift(officialDate,-1);
    const sides=[
      {side:"home",sp:g.homeSp,oppTeam:g.awayTeam,lineup:g.awayLine},
      {side:"away",sp:g.awaySp,oppTeam:g.homeTeam,lineup:g.homeLine},
    ];
    for(const s of sides){
      const candidate=g.rows.filter(r=>{
        const n=norm(r.subject_name);if(!n)return false;return n===norm(s.sp.name);
      });
      if(!candidate.length){identityDiagnostics.nonStarter+=g.rows.filter(r=>norm(r.subject_name)).length;continue}
      identityDiagnostics.resolvedExact+=candidate.length;
      const [ps,ts]=await Promise.all([pitcherStats(s.sp.id,through),teamStats(s.oppTeam,through)]);
      const matchup=buildLineupMatchup({pitcherProfile:pProfiles[String(s.sp.id)]||null,batterProfiles:s.lineup.map(x=>bProfiles[String(x.id)]).filter(Boolean),expectedInnings:ps.inningsPerStart,battersFacedPerInning:ps.battersFacedPerInning});
      const p=projectionPacket({pitcher:ps,opponentKRate:ts.kRate,matchup});
      if(p.projection==null||p.baseline==null){inc("MISSING_PIT_MODEL_INPUT");continue}
      projectionRows.push({game_id:String(g.gameId),event_date:officialDate,event_start_at:g.start,player_id:String(s.sp.id),player_name:s.sp.name,
        actual_value:s.sp.actualKs,model_id:MLB_DEEP_ID,model_version:MLB_DEEP_VERSION,model_source:"STATCAST_PITCH_SHAPE_X_HITTER_ZONE_X_WORKLOAD_CALIBRATED_V1",
        projection:p.projection,baseline_projection:p.baseline,sigma:p.sigma,raw_pitch_zone_projection:p.rawPitchZone,state_cutoff_at:through+"T23:59:59.999Z",
        matchup_coverage:p.coverage,market_rows:candidate});
    }
  });
  console.error("DATE "+officialDate+" games="+games.length+" projections_so_far="+projectionRows.length);
}

const units=[];
for(const p of projectionRows){
  const checkpoints=[...new Set(p.market_rows.map(r=>String(r.checkpoint||"CURRENT")))];
  const allPregame=p.market_rows.filter(r=>r.pregame===true&&Date.parse(r.observed_at)<Date.parse(p.event_start_at));
  const close=marketSnapshot(allPregame,{eventStart:p.event_start_at,maxAgeHours:8});
  for(const cp of checkpoints){
    const cpRows=allPregame.filter(r=>String(r.checkpoint||"CURRENT")===cp);
    if(!cpRows.length)continue;
    const entry=marketSnapshot(cpRows,{eventStart:p.event_start_at,maxAgeHours:48});
    if(entry.line==null){inc("MISSING_PRIMARY_ENTRY_LINE");continue}
    const signedEdge=p.projection-entry.line,side=signedEdge>0?"OVER":signedEdge<0?"UNDER":null;
    if(!side)continue;
    const result=resultAgainst(p.actual_value,entry.line,side);
    const ref=entry.reference,refLine=finite(ref?.book_line??ref?.line);
    const refResult=ref&&refLine!=null?resultAgainst(p.actual_value,refLine,side):null;
    const selectedPrice=side==="OVER"?finite(ref?.book_over_price):finite(ref?.book_under_price);
    const roiReady=Boolean(ref&&refLine===entry.line&&selectedPrice!=null&&refResult);
    let profit=roiReady?profitAtAmerican(selectedPrice,refResult):null;
    const sameBookClose=ref?latestByBook(allPregame).filter(x=>x.book_key===ref.book_key).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0]:null;
    const closeRefLine=finite(sameBookClose?.book_line??sameBookClose?.line);
    const closeNv=sameBookClose?noVig(sameBookClose.book_over_price,sameBookClose.book_under_price):null;
    const entryNv=ref?noVig(ref.book_over_price,ref.book_under_price):null;
    const probabilityClv=ref&&sameBookClose&&refLine===closeRefLine&&entryNv&&closeNv?
      (side==="OVER"?closeNv.over-entryNv.over:closeNv.under-entryNv.under):null;
    const lineClv=close.line==null?null:(side==="OVER"?close.line-entry.line:entry.line-close.line);
    units.push({...p,market:"pitcher_strikeouts",checkpoint:cp,evidence_class:EVIDENCE_CLASS,
      projection_unit_key:[p.game_id,p.player_id,"pitcher_strikeouts",p.model_version,cp].join("|"),
      entry_line:entry.line,entry_books:entry.books,entry_reference_book:ref?.book||null,entry_reference_line:refLine,
      entry_over_price:finite(ref?.book_over_price),entry_under_price:finite(ref?.book_under_price),entry_observed_at:ref?.observed_at||null,
      close_line:close.line,close_books:close.books,close_reference_line:closeRefLine,close_observed_at:sameBookClose?.observed_at||null,
      candidate_side:side,signed_edge:round(signedEdge),edge:round(Math.abs(signedEdge)),result,profit_units:round(profit),
      line_clv:round(lineClv),probability_clv:round(probabilityClv),roi_ready:roiReady,clv_ready:close.line!=null,
      temporal_integrity:true,can_qualify:false,can_authorize_wager:false});
  }
}

const unitMap=new Map();for(const u of units)if(!unitMap.has(u.projection_unit_key))unitMap.set(u.projection_unit_key,u);else inc("DUPLICATE_PROJECTION_UNIT");
const independent=[...unitMap.values()].sort((a,b)=>a.event_date.localeCompare(b.event_date)||Date.parse(a.event_start_at)-Date.parse(b.event_start_at)||(CHECKPOINT_ORDER[a.checkpoint]||99)-(CHECKPOINT_ORDER[b.checkpoint]||99));
const dates=[...new Set(independent.map(x=>x.event_date))].sort();
const directional=independent.filter(x=>x.result==="WIN"||x.result==="LOSS");
const buckets=[...new Set(directional.map(x=>bucketFor(x.edge)))].map(name=>{
  const xs=directional.filter(x=>bucketFor(x.edge)===name);return{name,n:xs.length,hitRate:round(xs.filter(x=>x.result==="WIN").length/xs.length),avgEdge:round(mean(xs.map(x=>x.edge)))};
}).sort((a,b)=>a.avgEdge-b.avgEdge);
const rankCorr=directional.length>1?pearson(rank(directional.map(x=>x.edge)),rank(directional.map(x=>x.result==="WIN"?1:0))):null;
const monotonic=buckets.every((b,i)=>i===0||b.hitRate+0.03>=buckets[i-1].hitRate);
const dateCut=Math.max(1,Math.floor(dates.length*.8)),testDates=new Set(dates.slice(dateCut)),testUnits=independent.filter(x=>testDates.has(x.event_date));
const economicByEvent=[...new Map(independent.slice().sort((a,b)=>(CHECKPOINT_ORDER[b.checkpoint]||0)-(CHECKPOINT_ORDER[a.checkpoint]||0)).map(x=>[x.game_id+"|"+x.player_id,x])).values()];
const econ=economicSummary(economicByEvent);
const clvDecisions=economicByEvent.filter(x=>x.clv_ready);
const priceClvDecisions=economicByEvent.filter(x=>x.probability_clv!=null);
const sourceCounts={rows:sourceRows.length,games:gameIds.length,archiveDates:archiveDates.length,pregameRows:sourceRows.filter(x=>x.pregame===true).length,
  twoSidedRows:sourceRows.filter(x=>finite(x.book_over_price)!=null&&finite(x.book_under_price)!=null).length};
const gate={
  insufficientDataExit:{settledIndependentN:independent.length,minSettledN:250,walkForwardN:independent.length,minWalkForwardN:150,distinctDates:dates.length,minDistinctDates:17,
    pass:independent.length>=250&&independent.length>=150&&dates.length>=17},
  calibrationCandidate:{minSettledN:500,minWalkForwardN:300,minDistinctDates:30,overN:independent.filter(x=>x.candidate_side==="OVER").length,underN:independent.filter(x=>x.candidate_side==="UNDER").length},
  promotionReady:{minSettledN:1000,minWalkForwardN:600,minDistinctDates:45,minProspectiveDays:14,historicalAloneCannotPromote:true}
};
const report={
  generatedAt:new Date().toISOString(),evidenceClass:EVIDENCE_CLASS,sourceWindow:{startDate:START_DATE,endDate:END_DATE},
  policy:{marketAliases:[...MARKET_ALIASES],economicBooks:[...ECONOMIC_BOOKS],bookPriority:BOOK_PRIORITY,entry:"primary modal line at each historical checkpoint; fixed reference-book priority for executable two-sided price",close:"latest valid pregame snapshot by book; consensus primary modal line; max age 8h",entryMaxAgeHours:48,closeMaxAgeHours:8,economicDecision:"latest eligible checkpoint per event/player only",alternateLinesIncreaseN:false,booksIncreaseN:false},
  model:{id:MLB_DEEP_ID,version:MLB_DEEP_VERSION,calibration:MLB_PITCH_ZONE_K_CALIBRATION,refit:false},
  source:sourceCounts,gameProcessing:{requestedGames:gameIds.length,usableGames:usableGames.length,rejections:rejects,identityDiagnostics},
  projections:{rows:projectionRows.length,...metrics(projectionRows)},
  marketValidation:{independentN:independent.length,dates:dates.length,dateList:dates,walkForwardN:independent.length,finalTestN:testUnits.length,
    overN:independent.filter(x=>x.candidate_side==="OVER").length,underN:independent.filter(x=>x.candidate_side==="UNDER").length,
    wins:directional.filter(x=>x.result==="WIN").length,losses:directional.filter(x=>x.result==="LOSS").length,pushes:independent.filter(x=>x.result==="PUSH").length,
    directionalHitRate:directional.length?round(directional.filter(x=>x.result==="WIN").length/directional.length):null,
    edgeBuckets:buckets,edgeHitMonotonic:monotonic,bucketRankCorrelation:round(rankCorr)},
  economics:{economicDecisionN:economicByEvent.length,clvReadyN:clvDecisions.length,probabilityClvReadyN:priceClvDecisions.length,
    avgLineClv:round(mean(clvDecisions.map(x=>x.line_clv))),avgProbabilityClv:round(mean(priceClvDecisions.map(x=>x.probability_clv))),...econ},
  gate,governance:{canQualify:false,canAuthorizeWager:false,autoPromotion:false,historicalEvidenceAloneCannotPromote:true,stateBeforeWeight:true},
  units:independent.map(x=>{const y={...x};delete y.market_rows;return y}),
};
await fs.mkdir(OUT.split("/").slice(0,-1).join("/")||".",{recursive:true});
await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({source:report.source,gameProcessing:report.gameProcessing,projections:report.projections,marketValidation:report.marketValidation,economics:{...report.economics,cumulativeUnits:undefined},gate:report.gate,governance:report.governance},null,2));
