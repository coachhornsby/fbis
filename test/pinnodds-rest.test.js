import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
 PINNODDS_SPORTS,americanFromDecimal,matchPinnOddsEvent,normalizePinnOddsEvent,
 reservePinnOddsRequest,pinnOddsBudgetStatus,collectPinnOddsPrematch,
} from "../functions/lib/pinnOddsRest.js";
import { runScheduledPinnOdds,PINNODDS_REST_CRON } from "../workers/pinnodds-rest-scheduler.mjs";

const now=new Date("2026-10-13T12:00:00Z");
const event={event_id:12345,league_id:20,league_name:"Premier League",starts:"2026-10-14T20:00:00Z",home:"Arsenal",away:"Chelsea",periods:{num_0:{number:0,money_line:{home:2.45,draw:3.30,away:2.90},spreads:{"-0.5":{hdp:-0.5,home:2.06,away:1.82}},totals:{"2.5":{points:2.5,over:1.90,under:1.98}},team_total:{home:{points:1.5,over:1.86,under:2}}}}};
function d1(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT)");
 return readFile(new URL("../migrations/0101_pinnodds_market_research_foundation.sql",import.meta.url),"utf8").then(sql=>{
  db.exec(sql);
  db.exec("CREATE TABLE games (id TEXT,sport TEXT,start TEXT,home_name TEXT,away_name TEXT)");
  return {db,DB:{prepare(sql){return {bind(...params){return {
   run(){const r=db.prepare(sql).run(...params);return {meta:{changes:r.changes}};},
   first(){return db.prepare(sql).get(...params)||null;},
   all(){return {results:db.prepare(sql).all(...params)};}
  }}}}}};
 });
}
function response(data,headers={}){return new Response(JSON.stringify(data),{status:200,headers:{"x-data-status":"fresh","x-data-age-ms":"0","x-data-board":"prematch",...headers}})}
test("PinnOdds REST source maps to independent FBIS sports; no WS",()=>{
 assert.deepEqual(PINNODDS_SPORTS[5],["nfl","cfb"]);
 assert.equal(PINNODDS_REST_CRON,"12,32,52 * * * *");
 assert.equal(americanFromDecimal(2.50),150);
 assert.equal(americanFromDecimal(1.80),-125);
 assert.equal(americanFromDecimal(null),null);
});
test("three-way soccer draw is not misrepresented as two-way, quotes are research-only",()=>{
 const offers=normalizePinnOddsEvent(event,1,{match:{sport:"soccer",eventId:"77",reason:"TWO_PARTICIPANT_START_VERIFIED"}});
 assert.equal(offers.length,9);
 assert.equal(offers.filter(x=>x.marketFamily==="moneyline_3way").length,3);
 assert.ok(offers.every(x=>x.fetchedAt===null&&x.executionEligible===false&&x.source==="PinnOdds"));
 assert.ok(offers.some(x=>x.marketFamily==="team_total"));
 assert.ok(offers.some(x=>x.marketFamily==="spread"&&x.side==="away"&&x.line===0.5));
});
test("alternate team-total ladders preserve every threshold without duplicating the primary",()=>{
 const e={...event,periods:{num_0:{...event.periods.num_0,
  team_totals:{home:{"0.5":{points:0.5,over:1.75,under:2.1},
    "1.5":{points:1.5,over:1.86,under:2.0}},away:{}}}}};
 const offers=normalizePinnOddsEvent(e,1,{match:{sport:"soccer",eventId:"77"}});
 const totals=offers.filter(o=>o.marketFamily==="team_total");
 assert.equal(totals.length,4);
 assert.equal(new Set(totals.map(o=>o.sourceOutcomeId)).size,4);
 assert.deepEqual(totals.filter(o=>o.side==="home_over").map(o=>o.line).sort(),[0.5,1.5]);
 assert.ok(totals.every(o=>o.raw.alternateLadder&&o.executionEligible===false));
});
test("special-market events stay quarantined until player identity and settlement verified",async()=>{
 const {DB}=await d1();
 const env={DB,PINNODDS_API_KEY:"test-only-secret"};
 const e={event_id:99999,special:"Pitcher Strikeouts",special_category:"Player Props",
   parent_id:12345,home:event.home,away:event.away,starts:event.starts};
 const fetchImpl=async(url,opts)=>{
   assert.match(url,/include_specials=1/);
   assert.equal(opts.headers["x-api-key"],"test-only-secret");
   return response({last:42,events:[e]});
 };
 const result=await collectPinnOddsPrematch(env,{sportId:6,now,fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.quarantinedSpecials,1);
 assert.equal(result.offers,0);
 assert.equal(result.matchedEvents,0);
});
test("event orientation and uniqueness are mandatory",()=>{
 const game={id:"77",sport:"soccer",start:event.starts,home_name:"Arsenal",away_name:"Chelsea"};
 assert.equal(matchPinnOddsEvent(event,[game],1,now.getTime()).eventId,"77");
 assert.equal(matchPinnOddsEvent(event,[game,game],1,now.getTime()).reason,"AMBIGUOUS_MATCH");
 assert.equal(matchPinnOddsEvent(event,[{...game,home_name:"Chelsea",away_name:"Arsenal"}],1,now.getTime()).reason,"UNMATCHED_EVENT");
});
test("shared D1 reservations cap routine at 80, diagnostic at 20, day at 100",async()=>{
 const {DB}=await d1();
 for(let i=0;i<80;i++){
  const t=new Date(now.getTime()+Math.floor(i/15)*60000);
  assert.equal((await reservePinnOddsRequest(DB,{sportId:1,now:t,requestId:"routine-"+i})).ok,true);
 }
 assert.equal((await reservePinnOddsRequest(DB,{sportId:1,now:new Date(now.getTime()+3600000),requestId:"blocked-routine"})).ok,false);
 for(let i=0;i<20;i++){
  const t=new Date(now.getTime()+3600000+Math.floor(i/15)*60000);
  assert.equal((await reservePinnOddsRequest(DB,{sportId:2,purpose:"diagnostic",now:t,requestId:"diag-"+i})).ok,true);
 }
 assert.equal((await reservePinnOddsRequest(DB,{sportId:3,purpose:"diagnostic",now:new Date(now.getTime()+7200000)})).ok,false);
 const status=await pinnOddsBudgetStatus(DB,{now:new Date(now.getTime()+7200000)});
 assert.deepEqual([status.used,status.routine,status.diagnostic,status.remaining],[100,80,20,0]);
});
test("per-minute cap holds across simulated workers and UTC midnight resets",async()=>{
 const {DB}=await d1();
 for(let i=0;i<19;i++)assert.equal((await reservePinnOddsRequest(DB,{sportId:1,now,requestId:"min-"+i})).ok,true);
 assert.equal((await reservePinnOddsRequest(DB,{sportId:2,now})).ok,false);
 const next=new Date("2026-10-14T00:00:00Z");
 assert.equal((await reservePinnOddsRequest(DB,{sportId:2,now:next})).ok,true);
});
test("first full, next delta and stale-withheld attempts have exact source semantics",async()=>{
 const {DB,db}=await d1();
 let urls=[];
 const env={DB,PINNODDS_API_KEY:"test-only-secret"};
 const fetchImpl=async url=>{urls.push(url);return response({last:42,events:[]})};
 const first=await collectPinnOddsPrematch(env,{sportId:1,now,fetchImpl});
 assert.equal(first.ok,true);assert.equal(first.mode,"FULL");assert.equal(first.offers,0);
 const next=await collectPinnOddsPrematch(env,{sportId:1,now:new Date(now.getTime()+1200000),fetchImpl});
 assert.equal(next.mode,"INCREMENTAL");assert.match(urls[1],/since=42/);
 const stale=await collectPinnOddsPrematch(env,{sportId:1,now:new Date(now.getTime()+2400000),fetchImpl:async()=>response({last:43,events:[]},{"x-data-status":"stale"})});
 assert.equal(stale.ok,false);assert.equal(stale.reason,"STALE_UNKNOWN_OR_WRONG_BOARD");
 assert.equal(db.prepare("SELECT provider_cursor FROM pinnodds_feed_state WHERE sport_id=1").get().provider_cursor,42);
 const used=await pinnOddsBudgetStatus(DB,{now});assert.equal(used.used,3);
});
test("disabled collector sends zero network requests and does not spend quota",async()=>{
 const {DB}=await d1();
 const output=await runScheduledPinnOdds({DB,PINNODDS_API_KEY:"test-only-secret",PINNODDS_COLLECT_ENABLED:"false"},{now});
 assert.equal(output.networkRequests,0);
 assert.equal((await pinnOddsBudgetStatus(DB,{now})).used,0);
});
test("no secret or live orders in code; schema has no execution authority",async()=>{
 const src=await readFile(new URL("../functions/lib/pinnOddsRest.js",import.meta.url),"utf8");
 assert.doesNotMatch(src,/WebSocket\s*\(|EventSource\s*\(|api\.polymarket.*orders/);
 assert.match(src,/x-portal-apikey/);
 assert.match(src,/canAuthorizeWager:false/);
 const wrangler=await readFile(new URL("../wrangler.orchestrator.toml",import.meta.url),"utf8");
 assert.match(wrangler,/PINNODDS_COLLECT_ENABLED = "false"/);
 assert.match(wrangler,/binding = "DB"/);
});
