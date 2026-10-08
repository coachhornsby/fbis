import test from "node:test";
import assert from "node:assert/strict";
import { validateTennisEvent, proveTennisEvent } from "../functions/lib/tennisEventIntegrity.js";
import { autoDecisionForMarket } from "../functions/api/tennis-v2-snapshot.js";
import { buildTennisResearchSlate, buildTodayBoard } from "../functions/lib/todayBoard.js";
const p1={fbis_player_id:"tennis:wta:332285",display_name:"Iva Jovic",tour:"wta"};
const p2={fbis_player_id:"tennis:wta:326408",display_name:"Iga Swiatek",tour:"wta"};
const event={match_id:"wta:beijing:LS011",player1_id:p1.fbis_player_id,player2_id:p2.fbis_player_id,p1,p2,tour:"wta",source:"WTA_OFFICIAL",observed_at:"2099-10-06T12:00:00Z",match_time:"2099-10-07T04:44:00Z",tournament_name:"China Open",surface:"hard",completion_state:"SCHEDULED"};
const proof={matchId:event.match_id,source:event.source,observedAt:event.observed_at,player1Id:p1.fbis_player_id,player2Id:p2.fbis_player_id,startTime:event.match_time,surface:event.surface,tournament:event.tournament_name};
const row={canonical_event_id:"tennis:action:114678",tour:"wta",player1:"Iva Jovic",player2:"Iga Świątek",event_start_time:event.match_time,tournament:"China Open",surface:"hard",pure_p1:.236,decision_timestamp:"2099-10-06T19:09:43Z",context_json:JSON.stringify({eventProof:proof})};
test("only exact official event and point-in-time projection evidence can publish",()=>assert.equal(validateTennisEvent(row,event,{projection:true}).valid,true));
test("actual Roland Garros/clay/start-time defect fails closed without relabeling probability",()=>{
  assert.equal(validateTennisEvent({...row,surface:"clay",tournament:"Roland Garros"},event,{projection:true}).reason,"SURFACE_MISMATCH");
  assert.equal(validateTennisEvent({...row,tournament:"Roland Garros"},event,{projection:true}).reason,"TOURNAMENT_MISMATCH");
  assert.equal(validateTennisEvent({...row,event_start_time:"2099-10-07T05:00:00Z"},event,{projection:true}).reason,"EVENT_START_MISMATCH");
});
test("opponent, tour, swapped projection identities, stale provenance and missing probabilities fail closed",()=>{
  for(const [change,reason] of [[{player2:"Other Player"},"PLAYER_IDENTITY_MISMATCH"],[{tour:"atp"},"TOUR_MISMATCH"],[{context_json:null},"PROJECTION_EVENT_PROVENANCE_MISMATCH"],[{context_json:JSON.stringify({eventProof:{...proof,player1Id:p2.fbis_player_id}})},"PROJECTION_EVENT_PROVENANCE_MISMATCH"],[{context_json:JSON.stringify({eventProof:{...proof,observedAt:"2099-10-06T20:00:00Z"}})},"PROJECTION_CUTOFF_MISMATCH"],[{pure_p1:null},"PROJECTION_PROBABILITY_MISSING"]]) assert.equal(validateTennisEvent({...row,...change},event,{projection:true}).reason,reason);
  assert.equal(validateTennisEvent(row,{...event,completion_state:"COMPLETED"},{projection:true}).reason,"EVENT_NOT_UPCOMING");
});
test("missing canonical event withholds the actual production snapshot and all probabilities",async()=>{
  const actual={...row,event_start_time:"2026-10-07T05:00:00Z",decision_timestamp:"2026-10-06T19:09:43.397Z",surface:"clay",tournament:"Roland Garros",context_json:JSON.stringify({profileSource:"SACKMANN_TENNIS_ABSTRACT_RESEARCH",surface:"clay"})};
  const db={prepare(sql){return {bind(){return {all:async()=>({results:sql.includes("FROM ranked d")?[actual]:[]})};}};}};
  assert.equal((await proveTennisEvent(db,actual)).reason,"OFFICIAL_EVENT_MISSING");
  const slate=await buildTennisResearchSlate("2026-10-07",{DB:db});
  assert.deepEqual(slate.games,[]);
  assert.equal(slate.research.withheld,1);
  assert.equal(slate.research.blockedEvents[0].reason,"OFFICIAL_EVENT_MISSING");
  assert.equal(slate.research.canAuthorizeWager,false);
  const board=await buildTodayBoard("2026-10-07",{DB:db},{focusSport:"tennis"});
  assert.equal(board.feeds.tennis.ok,false);
  assert.match(board.feeds.tennis.error,/TENNIS_EVENT_INTEGRITY_BLOCKED/);
  assert.equal(board.feeds.tennis.sources.tennisV2.withheld,1);
});

test("prospective generation stops before reading profiles or writing when official identity is absent",async()=>{
 const queries=[];const db={prepare(sql){queries.push(sql);return {bind(){return {all:async()=>({results:[]})};}};}};
 const result=await autoDecisionForMarket(db,{...row,provider:"ACTION_APIFY",collected_at:"2026-10-08T02:59:00Z",observed_at:"2026-10-08T02:59:00Z"},{now:Date.parse("2026-10-08T03:00:00Z")});
 assert.equal(result.inserted,false);assert.equal(result.reason,"OFFICIAL_EVENT_MISSING");
 assert.equal(queries.length,1);assert.doesNotMatch(queries[0],/INSERT|tennis_player_profiles_current/);
});
