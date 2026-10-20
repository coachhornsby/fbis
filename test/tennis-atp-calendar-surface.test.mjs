import test from "node:test";
import assert from "node:assert/strict";
import {atp2026TournamentSurface} from "../functions/lib/tennisAtp2026TournamentSurface.js";
const fixture={tour:"atp",source_event_id:"708-2026",start:"2026-10-20T09:30:00.000Z"};
const espn={source:"ESPN_PUBLIC_RESEARCH",tournament:"Almaty Open"};
test("2026 ATP Tour calendar can provide source-backed tournament-level hard indoor surface",()=>{
 const x=atp2026TournamentSurface(fixture,espn);
 assert.equal(x.surface,"hard");
 assert.equal(x.indoor,true);
 assert.equal(x.tournamentName,"Almaty Open");
 assert.match(x.sourceUrl,/atptour\.com\/en\/tournaments\/almaty/);
 assert.equal(x.officialMatchVerified,false);
 assert.equal(x.canAuthorizeWager,false);
});
test("wrong event ID, venue name, year or tour cannot borrow 2026 ATP surface",()=>{
 assert.equal(atp2026TournamentSurface({...fixture,source_event_id:"not-official"},espn),null);
 assert.equal(atp2026TournamentSurface(fixture,{...espn,tournament:"Another Almaty tournament"}),null);
 assert.equal(atp2026TournamentSurface({...fixture,tour:"wta"},espn),null);
 assert.equal(atp2026TournamentSurface({...fixture,start:"2025-10-20T09:30:00Z"},espn),null);
 assert.equal(atp2026TournamentSurface(fixture,null),null);
});
