#!/usr/bin/env node
import fs from "node:fs/promises";
import { buildLineupMatchup, buildStatcastProfiles } from "../functions/lib/mlbPitchMatchup.js";
import { parseStatcastCsv } from "../functions/lib/mlbPitchMatchupFeed.js";
import { MLB_PITCH_ZONE_K_CALIBRATION, MLB_DEEP_ID, MLB_DEEP_VERSION } from "../functions/lib/mlbDeepModel.js";

const file=process.env.MARKET_FILE||"market.json";
const out=process.env.OUT||"pitcher-k-pit.json";
const UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const LEAGUE_K=.225, LOOKBACK=90;
const BOOK_ORDER=["Pinnacle","Circa Sports","DraftKings","FanDuel","BetMGM","bet365","Fanatics","Caesars","Novig","Parx Casino","Fliff"];
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const day=v=>String(v||"").slice(0,10);
const shift=(d,n)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const fold=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[.'’]/g,"").replace(/\s+/g," ").trim();
const norm=s=>{let z=String(s||"").trim();const i=z.lastIndexOf(" (");if(i>0&&z.endsWith(")"))z=z.slice(0,i);return fold(z).replace(/\b(ii|iii|iv|jr|sr)\b/g,"").replace(/\s+/g," ").trim()};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};
const mae=a=>mean(a.map(Math.abs));
const rmse=a=>Math.sqrt(mean(a.map(x=>x*x)));
const americanProfit=(price,win)=>{if(!win)return -1;const p=Number(price);return p>0?p/100:100/Math.abs(p)};
const implied=p=>{p=Number(p);if(!Number.isFinite(p)||p===0)return null;return p>0?100/(p+100):Math.abs(p)/(Math.abs(p)+100)};
const noVig=(over,under)=>{const a=implied(over),b=implied(under);return a!=null&&b!=null&&a+b>0?a/(a+b):null};

async function fetchJson(url,retries=4){
 let last;for(let i=0;i<retries;i++){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"application/json"}});if(r.ok)return r.json();last=new Error("HTTP "+r.status+" "+url);}catch(e){last=e}await new Promise(r=>setTimeout(r,500*(i+1)))}throw last;
}
async function fetchText(url,retries=4){
 let last;for(let i=0;i<retries;i++){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"text/csv,*/*",Referer:"https://baseballsavant.mlb.com/"}});if(r.ok)return r.text();last=new Error("HTTP "+r.status+" "+url);}catch(e){last=e}await new Promise(r=>setTimeout(r,700*(i+1)))}throw last;
}
function unwrapWrangler(j){
 if(Array.isArray(j)){for(const x of j){if(Array.isArray(x?.results))return x.results}}
 if(Array.isArray(j?.result)){for(const x of j.result){if(Array.isArray(x?.results))return x.results}}
 if(Array.isArray(j?.results))return j.results;
 return [];
}
function startingLineup(team={}){
 const ps=Object.values(team.players||{}).map(p=>({id:Number(p.person?.id),order:Number(p.battingOrder),name:p.person?.fullName})).filter(p=>Number.isFinite(p.id)&&Number.isFinite(p.order)&&p.order>0).sort((a,b)=>a.order-b.order);
 const exact=ps.filter(p=>p.order%100===0);if(exact.length>=8)return exact.slice(0,9);
 const by=new Map();for(const p of ps){const slot=Math.floor(p.order/100);if(slot>=1&&slot<=9&&!by.has(slot))by.set(slot,p)}
 return [...by.entries()].sort((a,b)=>a[0]-b[0]).map(([,p])=>p).slice(0,9);
}
function starter(team={}){
 const id=Number((team.pitchers||[])[0]);if(!Number.isFinite(id))return null;
 const p=team.players?.["ID"+id]||{};return {id,name:p.person?.fullName||null,actualKs:finite(p.stats?.pitching?.strikeOuts)};
}
async function pitcherStats(id,through){
 const u=new URL("https://statsapi.mlb.com/api/v1/people/"+id+"/stats");u.searchParams.set("stats","byDateRange");u.searchParams.set("group","pitching");u.searchParams.set("startDate","2026-03-01");u.searchParams.set("endDate",through);u.searchParams.set("gameType","R");
 const j=await fetchJson(u);const s=j?.stats?.[0]?.splits?.[0]?.stat||{};const ip=finite(s.inningsPitched),gs=finite(s.gamesStarted),so=finite(s.strikeOuts),bf=finite(s.battersFaced);
 return {kPer9:ip>0&&so!=null?so*9/ip:null,inningsPerStart:gs>0&&ip!=null?ip/gs:null,battersFacedPerInning:ip>0&&bf!=null?bf/ip:null};
}
async function teamStats(id,through){
 const u=new URL("https://statsapi.mlb.com/api/v1/teams/"+id+"/stats");u.searchParams.set("stats","byDateRange");u.searchParams.set("group","hitting");u.searchParams.set("startDate","2026-03-01");u.searchParams.set("endDate",through);u.searchParams.set("gameType","R");
 const j=await fetchJson(u);const s=j?.stats?.[0]?.splits?.[0]?.stat||{};const so=finite(s.strikeOuts),pa=finite(s.plateAppearances);return {kRate:pa>0&&so!=null?so/pa:null};
}
function statcastUrl(role,ids,start,end){
 const u=new URL("https://baseballsavant.mlb.com/statcast_search/csv");
 for(const [k,v] of [["all","true"],["type","details"],["player_type",role],["game_date_gt",start],["game_date_lt",end],["hfGT","R|PO|"],["min_pitches","0"],["min_results","0"],["group_by","name"],["sort_col","pitches"],["sort_order","desc"],["min_pas","0"]])u.searchParams.set(k,v);
 for(const id of ids)u.searchParams.append(role==="pitcher"?"pitchers_lookup[]":"batters_lookup[]",String(id));return u;
}
async function profiles(role,ids,date){
 const clean=[...new Set(ids.map(Number).filter(Number.isFinite))];if(!clean.length)return {};
 const end=shift(date,-1),start=shift(date,-LOOKBACK);const csv=await fetchText(statcastUrl(role,clean,start,end));return buildStatcastProfiles(parseStatcastCsv(csv),{role,asOf:date+"T00:00:00Z"});
}
function projectK(ps,oppK,match){
 const ip=clamp(finite(ps.inningsPerStart)??5.35,3,7.5),k9=finite(ps.kPer9),bfpi=finite(ps.battersFacedPerInning),lk=finite(match?.lineupKRate);
 if(k9==null||bfpi==null||lk==null)return null;
 const base=clamp((k9/9)*ip*clamp((finite(oppK)??LEAGUE_K)/LEAGUE_K,.78,1.22),1,12.5);
 const bf=clamp(bfpi*ip,12,36),raw=clamp(lk*bf,1,12.5);
 const c=MLB_PITCH_ZONE_K_CALIBRATION,projection=clamp(base*c.baselineWeight+raw*c.pitchZoneWeight+c.offset,1,12.5);
 const sigma=Math.sqrt(Math.max(.25,bf*lk*(1-lk)));
 return {projection,baseline:base,raw,sigma,expectedInnings:ip,expectedBattersFaced:bf,lineupKRate:lk};
}
function resolveStarter(name,starters){
 const n=norm(name),m=starters.filter(s=>norm(s.name)===n);return m.length===1?m[0]:null;
}
function chooseEntry(rows){
 const good=rows.filter(r=>r.book_line!=null&&r.book_over_price!=null&&r.book_under_price!=null);
 for(const b of BOOK_ORDER){const xs=good.filter(r=>String(r.book)===b).sort((a,b)=>String(a.source_as_of).localeCompare(String(b.source_as_of)));if(xs.length)return xs.at(-1)}
 return null;
}
function chooseClose(rows,book,start){
 return rows.filter(r=>String(r.book)===String(book)&&r.book_line!=null&&r.book_over_price!=null&&r.book_under_price!=null&&String(r.source_as_of)<start).sort((a,b)=>String(a.source_as_of).localeCompare(String(b.source_as_of))).at(-1)||null;
}
const raw=JSON.parse(await fs.readFile(file,"utf8"));const rows=unwrapWrangler(raw);
const byGame=new Map();for(const r of rows){if(!byGame.has(String(r.game_id)))byGame.set(String(r.game_id),[]);byGame.get(String(r.game_id)).push(r)}
const units=[],rejects={AMBIGUOUS_OR_NONSTARTER:0,STATE_MISSING:0,MARKET_AFTER_START:0,NO_ENTRY_PRICE:0,NO_CLOSE_PRICE:0,FEED_ERROR:0};
for(const [gameId,marketRows] of byGame){
 let feed;try{feed=await fetchJson("https://statsapi.mlb.com/api/v1.1/game/"+gameId+"/feed/live")}catch{rejects.FEED_ERROR+=marketRows.length;continue}
 const date=day(feed.gameData?.datetime?.dateTime),start=feed.gameData?.datetime?.dateTime,box=feed.liveData?.boxscore?.teams||{};
 const home=starter(box.home),away=starter(box.away);if(!home||!away)continue;
 const starters=[home,away],resolved=marketRows.map(r=>({...r,_starter:resolveStarter(r.subject_name,starters)})).filter(r=>r._starter);
 rejects.AMBIGUOUS_OR_NONSTARTER+=marketRows.length-resolved.length;
 const needed=[...new Set(resolved.map(r=>r._starter.id))];
 const projections={};
 for(const spid of needed){
   const side=home.id===spid?"home":"away",oppSide=side==="home"?"away":"home",sp=side==="home"?home:away,oppTeam=feed.gameData?.teams?.[oppSide]?.id;
   const lineup=startingLineup(box[oppSide]);if(lineup.length<8){rejects.STATE_MISSING++;continue}
   try{
    const through=shift(date,-1);const [ps,ts,pp,bp]=await Promise.all([pitcherStats(spid,through),teamStats(oppTeam,through),profiles("pitcher",[spid],date),profiles("batter",lineup.map(x=>x.id),date)]);
    const match=buildLineupMatchup({pitcherProfile:pp[String(spid)]||null,batterProfiles:lineup.map(x=>bp[String(x.id)]).filter(Boolean),expectedInnings:ps.inningsPerStart,battersFacedPerInning:ps.battersFacedPerInning});
    const pr=projectK(ps,ts.kRate,match);if(!pr){rejects.STATE_MISSING++;continue}
    projections[spid]={...pr,actual:sp.actualKs,name:sp.name,stateCutoff:through};
   }catch{rejects.STATE_MISSING++}
 }
 const byUnit=new Map();
 for(const r of resolved){
   if(String(r.source_as_of)>=start){rejects.MARKET_AFTER_START++;continue}
   const p=projections[r._starter.id];if(!p)continue;
   const key=[gameId,r._starter.id,"pitcher_strikeouts",MLB_DEEP_VERSION,r.checkpoint].join("|");
   if(!byUnit.has(key))byUnit.set(key,{key,gameId,date,start,checkpoint:r.checkpoint,playerId:String(r._starter.id),playerName:r._starter.name,projection:p,rows:[]});
   byUnit.get(key).rows.push(r);
 }
 const allResolved=resolved.filter(r=>String(r.source_as_of)<start);
 for(const u of byUnit.values()){
   const entry=chooseEntry(u.rows);if(!entry){rejects.NO_ENTRY_PRICE++;continue}
   const samePlayerAll=allResolved.filter(r=>String(r._starter.id)===u.playerId);
   const close=chooseClose(samePlayerAll,entry.book,start);if(!close)rejects.NO_CLOSE_PRICE++;
   const line=Number(entry.book_line),sel=u.projection.projection>line?"OVER":u.projection.projection<line?"UNDER":"PUSH";
   const actual=u.projection.actual,result=sel==="OVER"?(actual>line?"WIN":actual===line?"PUSH":"LOSS"):sel==="UNDER"?(actual<line?"WIN":actual===line?"PUSH":"LOSS"):"PUSH";
   const ep=sel==="OVER"?entry.book_over_price:entry.book_under_price,cp=close?(sel==="OVER"?close.book_over_price:close.book_under_price):null;
   const eNv=noVig(entry.book_over_price,entry.book_under_price),cNv=close?noVig(close.book_over_price,close.book_under_price):null;
   const entryProb=sel==="OVER"?eNv:eNv==null?null:1-eNv,closeProb=sel==="OVER"?cNv:cNv==null?null:1-cNv;
   const lineClv=close?(sel==="OVER"?Number(close.book_line)-line:sel==="UNDER"?line-Number(close.book_line):0):null;
   const profit=result==="PUSH"?0:americanProfit(ep,result==="WIN");
   units.push({
    evidence_class:"HISTORICAL_PIT_RECONSTRUCTED",projection_unit_key:u.key,event_id:gameId,event_date:date,player_id:u.playerId,player_name:u.playerName,market:"pitcher_strikeouts",
    model_id:MLB_DEEP_ID,model_version:MLB_DEEP_VERSION,projection:u.projection.projection,baseline_projection:u.projection.baseline,raw_pitch_zone_projection:u.projection.raw,sigma:u.projection.sigma,
    state_cutoff:u.projection.stateCutoff,checkpoint:u.checkpoint,entry_book:entry.book,entry_timestamp:entry.source_as_of,entry_line:line,entry_over_price:entry.book_over_price,entry_under_price:entry.book_under_price,
    close_timestamp:close?.source_as_of||null,close_line:close?.book_line??null,close_over_price:close?.book_over_price??null,close_under_price:close?.book_under_price??null,
    selection:sel,actual_value:actual,result,line_clv:lineClv,probability_clv:entryProb!=null&&closeProb!=null?closeProb-entryProb:null,profit_units:profit,
    settlement_source:"MLB_STATS_FINAL",temporal_integrity:true,canQualify:false,canAuthorizeWager:false,source_offer_count:u.rows.length
   });
 }
}
units.sort((a,b)=>String(a.entry_timestamp).localeCompare(String(b.entry_timestamp)));
const errs=units.map(u=>u.projection-u.actual_value),baseErrs=units.map(u=>u.baseline_projection-u.actual_value);
const directional=units.filter(u=>u.selection!=="PUSH"),wins=directional.filter(u=>u.result==="WIN").length;
let cum=0,peak=0,maxDd=0;for(const u of units){cum+=u.profit_units;peak=Math.max(peak,cum);maxDd=Math.max(maxDd,peak-cum)}
const dates=[...new Set(units.map(u=>u.event_date))];
const checkpoints={};for(const u of units)checkpoints[u.checkpoint]=(checkpoints[u.checkpoint]||0)+1;
const summary={
 generatedAt:new Date().toISOString(),model:{id:MLB_DEEP_ID,version:MLB_DEEP_VERSION,calibration:MLB_PITCH_ZONE_K_CALIBRATION},
 rawMarketRows:rows.length,independentUnits:units.length,dates:dates.length,dateList:dates,checkpoints,rejects,
 projection:{mae:mae(errs),rmse:rmse(errs),bias:mean(errs),baselineMae:mae(baseErrs),relativeMaeImprovement:mae(baseErrs)?(mae(baseErrs)-mae(errs))/mae(baseErrs):null},
 directional:{n:directional.length,wins,hitRate:directional.length?wins/directional.length:null,over:directional.filter(u=>u.selection==="OVER").length,under:directional.filter(u=>u.selection==="UNDER").length},
 economics:{closeReady:units.filter(u=>u.close_timestamp).length,probabilityClvReady:units.filter(u=>u.probability_clv!=null).length,roiReady:units.filter(u=>Number.isFinite(u.profit_units)).length,profitUnits:units.reduce((s,u)=>s+u.profit_units,0),roi:units.length?units.reduce((s,u)=>s+u.profit_units,0)/units.length:null,maxDrawdown:maxDd,meanLineClv:mean(units.map(u=>u.line_clv).filter(Number.isFinite)),meanProbabilityClv:mean(units.map(u=>u.probability_clv).filter(Number.isFinite))},
 temporalIntegrity:units.every(u=>u.temporal_integrity===true&&u.entry_timestamp<u.start)
};
await fs.writeFile(out,JSON.stringify({summary,units},null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
