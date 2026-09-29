import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normName } from "../functions/lib/match.js";
import { resolveFinalForSnapshot } from "../functions/lib/projLedger.js";

function final({id="final",start,away,home,awayScore=17,homeScore=21}){
  return {
    id,
    sport:"cfb",
    start,
    away:{name:away,score:awayScore},
    home:{name:home,score:homeScore},
    status:{completed:true,state:"post",detail:"Final"},
  };
}

describe("final-score reconciliation completeness", () => {
  it("normalizes provider diacritics", () => {
    assert.equal(normName("San José State"), normName("San Jose State"));
  });

  it("reconciles Albany to UAlbany on the same kickoff and opponent", () => {
    const row={
      gameId:"snap-albany",
      sport:"CFB",
      date:"2026-09-05",
      start:"2026-09-03T23:00:00Z",
      matchup:"Albany @ Buffalo",
    };
    const hit=resolveFinalForSnapshot(row,[
      final({id:"401866409",start:"2026-09-03T23:00:00Z",away:"UAlbany Great Danes",home:"Buffalo"})
    ]);
    assert.equal(hit?.id,"401866409");
  });

  it("reconciles Southeast Louisiana provider variants", () => {
    const row={
      gameId:"snap-sela",
      sport:"CFB",
      start:"2026-09-19T20:30:00Z",
      matchup:"Southeastern Louisiana @ ULM",
    };
    const hit=resolveFinalForSnapshot(row,[
      final({id:"401868317",start:"2026-09-19T20:30:00Z",away:"SE Louisiana",home:"ULM",awayScore:38,homeScore:35})
    ]);
    assert.equal(hit?.id,"401868317");
  });

  it("does not convert a same-time one-sided coincidence into a final", () => {
    const row={
      gameId:"bad-snapshot",
      sport:"CFB",
      start:"2026-09-19T23:00:00Z",
      matchup:"Tennessee @ Memphis",
    };
    const hit=resolveFinalForSnapshot(row,[
      final({id:"real-game",start:"2026-09-19T23:00:00Z",away:"UT Martin Skyhawks",home:"Memphis",awayScore:21,homeScore:45})
    ]);
    assert.equal(hit,null);
  });
});
