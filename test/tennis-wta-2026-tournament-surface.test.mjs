import test from "node:test";
import assert from "node:assert/strict";
import {wta2026TournamentSurface} from "../functions/lib/tennisAtp2026TournamentSurface.js";
test("independent WTA 2026 hard outdoor surface only from exact event and source",()=>{
 const fixtures=[
  [{tour:"wta",source_event_id:"963-2026",start:"2026-10-20T12:00:00Z"}, {source:"ESPN_PUBLIC_RESEARCH",tournament:"BNB Ningbo Open"}],
  [{tour:"wta",source_event_id:"345-2026",start:"2026-10-20T12:00:00Z"}, {source:"ESPN_PUBLIC_RESEARCH",tournament:"Kinoshita Group Japan Open"}]
 ];
 for(const [f,e] of fixtures){
  const r=wta2026TournamentSurface(f,e);
  assert.equal(r.surface,"hard");
  assert.equal(r.indoor,false);
  assert.equal(r.officialMatchVerified,false);
  assert.equal(r.canAuthorizeWager,false);
  assert.match(r.sourceUrl,/wtatennis.com/);
 }
 assert.equal(wta2026TournamentSurface({...fixtures[0][0],source_event_id:"unrelated"},fixtures[0][1]),null);
 assert.equal(wta2026TournamentSurface(fixtures[0][0],{...fixtures[0][1],tournament:"Different Event"}),null);
 assert.equal(wta2026TournamentSurface({...fixtures[0][0],tour:"atp"},fixtures[0][1]),null);
});
