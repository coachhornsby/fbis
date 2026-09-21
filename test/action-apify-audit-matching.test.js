/**
 * Regression fixtures for the Capability Audit matching failures:
 * CFB AMBIGUOUS (ESPN + synthetic board clones) and NFL UNMATCHED (Sunday
 * games outside Fri/Sat Chicago today+tomorrow slate window).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { matchEventWithConfidence } from "../functions/lib/actionApifyCandidate.js";
import {
  matchShadowEvent,
  normalizePlayerProps,
  inventoryPlayerPropFields,
} from "../functions/lib/actionApifyShadow.js";
import { namesMatchStrict } from "../functions/lib/match.js";
import {
  defaultFbisSlateDates,
  calendarDateChicago,
  loadFbisSlateForMatching,
} from "../functions/lib/actionApifyEvidence.js";

const CFB_AUDIT = [
  {
    actionGameId: "287974",
    away: "Oklahoma Sooners",
    home: "Michigan Wolverines",
    awayAbbr: "OU",
    homeAbbr: "MICH",
    startTime: "2026-09-12T16:00:00.000Z",
    espnId: "401856679",
    boardId: "ncaaf_michiganwolverines_oklahomasooners_2026-09-12_b2",
    fbisHome: "Michigan",
    fbisAway: "Oklahoma",
  },
  {
    actionGameId: "287975",
    away: "Ohio State Buckeyes",
    home: "Texas Longhorns",
    awayAbbr: "OSU",
    homeAbbr: "TEX",
    startTime: "2026-09-12T23:30:00.000Z",
    espnId: "401856682",
    boardId: "ncaaf_texaslonghorns_ohiostatebuckeyes_2026-09-12_b2",
    fbisHome: "Texas",
    fbisAway: "Ohio State",
  },
  {
    actionGameId: "288997",
    away: "Alabama Crimson Tide",
    home: "Kentucky Wildcats",
    awayAbbr: "ALA",
    homeAbbr: "UK",
    startTime: "2026-09-12T19:30:00.000Z",
    espnId: "401856674",
    boardId: "ncaaf_alabamacrimsontide_kentuckywildcats_2026-09-12_b2",
    fbisHome: "Kentucky",
    fbisAway: "Alabama",
  },
];

const NFL_AUDIT = [
  {
    actionGameId: "290853",
    away: "Buffalo Bills",
    home: "Houston Texans",
    awayAbbr: "BUF",
    homeAbbr: "HOU",
    startTime: "2026-09-13T17:00:00.000Z",
    fbisId: "nfl_bills_texans_2026-09-13_b2",
  },
  {
    actionGameId: "290851",
    away: "New Orleans Saints",
    home: "Detroit Lions",
    awayAbbr: "NO",
    homeAbbr: "DET",
    startTime: "2026-09-13T17:00:00.000Z",
    fbisId: "nfl_lions_saints_2026-09-13_b2",
  },
  {
    actionGameId: "290845",
    away: "Tampa Bay Buccaneers",
    home: "Cincinnati Bengals",
    awayAbbr: "TB",
    homeAbbr: "CIN",
    startTime: "2026-09-13T17:00:00.000Z",
    fbisId: "nfl_bengals_buccaneers_2026-09-13_b2",
  },
  {
    actionGameId: "290800",
    away: "Dallas Cowboys",
    home: "New York Giants",
    awayAbbr: "DAL",
    homeAbbr: "NYG",
    startTime: "2026-09-14T00:20:00.000Z",
    fbisId: "nfl_cowboys_giants_2026-09-13_b3",
  },
];

test("CFB audit games: Action full names match FBIS school names via mascot fluff + abbr", () => {
  assert.equal(namesMatchStrict("Michigan Wolverines", "Michigan"), true);
  assert.equal(namesMatchStrict("Oklahoma Sooners", "Oklahoma"), true);
  assert.equal(namesMatchStrict("Ohio State Buckeyes", "Ohio State"), true);
  assert.equal(namesMatchStrict("Texas Longhorns", "Texas"), true);
  assert.equal(namesMatchStrict("Alabama Crimson Tide", "Alabama"), true);
  assert.equal(namesMatchStrict("Kentucky Wildcats", "Kentucky"), true);
  // Fail-closed: do not collapse distinct schools.
  assert.equal(namesMatchStrict("Michigan", "Michigan State"), false);
  assert.equal(namesMatchStrict("Texas", "Texas Tech"), false);
});

test("CFB audit games: ESPN + synthetic board clones collapse to ESPN id (not AMBIGUOUS)", () => {
  for (const g of CFB_AUDIT) {
    const action = {
      homeTeam: g.home,
      awayTeam: g.away,
      homeAbbr: g.homeAbbr,
      awayAbbr: g.awayAbbr,
      league: "ncaaf",
      startTime: g.startTime,
    };
    const candidates = [
      {
        id: g.boardId,
        sport: "cfb",
        homeTeam: g.fbisHome,
        awayTeam: g.fbisAway,
        homeAbbr: g.homeAbbr,
        awayAbbr: g.awayAbbr,
        startTime: g.startTime.replace(".000Z", "Z").replace(":00.000Z", "Z"),
      },
      {
        id: g.espnId,
        sport: "cfb",
        homeTeam: g.fbisHome,
        awayTeam: g.fbisAway,
        homeAbbr: g.homeAbbr,
        awayAbbr: g.awayAbbr,
        startTime: g.startTime,
      },
    ];
    const m = matchEventWithConfidence(action, candidates);
    assert.ok(["EXACT", "HIGH"].includes(m.confidence), `${g.actionGameId} conf=${m.confidence}`);
    assert.equal(m.comparisonEligible, true, g.actionGameId);
    assert.equal(m.candidate?.id, g.espnId, g.actionGameId);
    assert.equal(m.matched, true);
  }
});

test("NFL audit games: full-name Action rows match when Sunday candidates are in slate", () => {
  for (const g of NFL_AUDIT) {
    const action = {
      homeTeam: g.home,
      awayTeam: g.away,
      homeAbbr: g.homeAbbr,
      awayAbbr: g.awayAbbr,
      league: "nfl",
      startTime: g.startTime,
    };
    const candidates = [
      {
        id: g.fbisId,
        sport: "nfl",
        homeTeam: g.home,
        awayTeam: g.away,
        homeAbbr: g.homeAbbr,
        awayAbbr: g.awayAbbr,
        startTime: g.startTime.replace(".000Z", "Z"),
      },
    ];
    const m = matchShadowEvent(action, candidates);
    assert.equal(m.matched, true, g.actionGameId);
    assert.equal(m.candidate?.id, g.fbisId, g.actionGameId);
  }
});

test("NFL Fri-night Chicago slate horizon includes Sunday board date (audit DATE_BOUNDARY fix)", () => {
  // Capability audit ran ~2026-09-12T04:26Z ⇒ Chicago still 2026-09-11.
  const auditNow = new Date("2026-09-12T04:26:00.000Z");
  assert.equal(calendarDateChicago(auditNow), "2026-09-11");
  const mlb = defaultFbisSlateDates(auditNow, { sport: "mlb" });
  assert.deepEqual(mlb, ["2026-09-11", "2026-09-12"]);
  const nfl = defaultFbisSlateDates(auditNow, { sport: "nfl" });
  // Football horizon is a full upcoming week so early-week collections still see Sunday/Monday.
  assert.ok(nfl.includes("2026-09-13"), `nfl slate missing Sunday: ${nfl.join(",")}`);
  assert.ok(nfl.includes("2026-09-14"), `nfl slate missing Mon: ${nfl.join(",")}`);
  assert.equal(nfl[0], "2026-09-11");
  assert.ok(nfl.length >= 7, `expected week-long NFL horizon, got ${nfl.join(",")}`);
});

test("player-prop normalizer: flat fixture fields + nested player/books Actor shape", () => {
  const flat = normalizePlayerProps([
    {
      playerId: "p1",
      playerName: "QB One",
      team: "Alabama",
      market: "pass_yards",
      line: 245.5,
      overOdds: -115,
      underOdds: -105,
      book: "DraftKings",
      timestamp: "2026-09-13T10:00:00.000Z",
    },
  ]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].playerId, "p1");
  assert.equal(flat[0].playerName, "QB One");
  assert.equal(flat[0].market, "pass_yards");
  assert.equal(flat[0].line, 245.5);
  assert.equal(flat[0].overOdds, -115);
  assert.equal(flat[0].underOdds, -105);
  assert.equal(flat[0].book, "draftkings");
  assert.equal(flat[0].observedAt, "2026-09-13T10:00:00.000Z");

  const nested = normalizePlayerProps([
    {
      player: { id: 99, name: "Josh Allen", teamAbbr: "BUF", position: "QB" },
      type: "passing_yards",
      line: 267.5,
      books: [
        { book: "FanDuel", overOdds: -110, underOdds: -110 },
        { bookName: "DraftKings", over: -108, under: -112 },
      ],
      updatedAt: "2026-09-12T12:00:00Z",
    },
  ]);
  assert.equal(nested.length, 2);
  assert.equal(nested[0].providerPlayerId, "99");
  assert.equal(nested[0].playerName, "Josh Allen");
  assert.equal(nested[0].market, "passing_yards");
  assert.equal(nested[0].position, "QB");
  assert.ok(nested.every((r) => r.overOdds != null && r.underOdds != null));
  assert.ok(nested.every((r) => r.observedAt === "2026-09-12T12:00:00Z"));

  const inv = inventoryPlayerPropFields([
    { player: { id: 1, name: "x" }, type: "passing_yards", books: [{ book: "a", overOdds: -110 }] },
  ]);
  assert.equal(inv.samples, 1);
  assert.ok(inv.topLevelKeys.some((k) => k.key === "player"));
  assert.ok(inv.nestedKeys.some((k) => k.key === "player.id"));
});

test("player-prop normalizer does not invent ids/prices/timestamps", () => {
  const rows = normalizePlayerProps([
    { playerName: "Unknown", market: "rush_yards", line: 55.5 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerId, null);
  assert.equal(rows[0].providerPlayerId, null);
  assert.equal(rows[0].overOdds, null);
  assert.equal(rows[0].underOdds, null);
  assert.equal(rows[0].observedAt, null);
  assert.equal(rows[0].identityConfidence, "HIGH"); // name present, no forced provider id
});


test("explicit Chicago ACTION date searches adjacent storage partitions and filters by kickoff date", async () => {
  const calls=[];
  const query=async (_env,{sport,date})=>{
    calls.push(date);
    const rows=date==="2026-09-22" ? [{
      id:"nfl-mnf",sport:"nfl",date:"2026-09-22",start:"2026-09-22T00:15:00.000Z",
      homeName:"Los Angeles Rams",awayName:"New York Giants",homeAbbr:"LAR",awayAbbr:"NYG"
    }] : [];
    return {ok:true,rows};
  };
  const slate=await loadFbisSlateForMatching(query,{}, {sport:"nfl",date:"2026-09-21",now:new Date("2026-09-21T17:00:00Z")});
  assert.deepEqual(calls,["2026-09-20","2026-09-21","2026-09-22"]);
  assert.equal(slate.fbisEvents.length,1);
  assert.equal(slate.fbisEvents[0].id,"nfl-mnf");
});
