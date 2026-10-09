import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScheduleProfile,
  attachNflPersistentProfiles,
  haversineMiles,
  injuryType,
  injurySeverityClass,
  parseNflRoster,
} from "../functions/lib/nflTeamProfiles.js";

test('NFL roster parser keeps athletes and excludes nested position and status metadata', () => {
  const position = { id: '8', displayName: 'Quarterback', abbreviation: 'QB', leaf: true,
    parent: { id: '70', displayName: 'Offense', abbreviation: 'OFF', leaf: false } };
  const athlete = { id: '123456', displayName: 'Fixture Athlete', position,
    status: { id: '1', displayName: 'Active', type: 'active' }, jersey: '9' };
  const rows = parseNflRoster({ athletes: [{ position: 'QB', items: [athlete] }] });
  assert.deepEqual(rows.map(({ id, name, position }) => ({ id, name, position })),
    [{ id: '123456', name: 'Fixture Athlete', position: 'QB' }]);
  assert.equal(rows[0].raw, athlete);
  assert.equal(rows[0].jersey, '9');
});
test('NFL roster parser preserves wrapper identity, duplicate handling and valid position groups', () => {
  const a = { athlete: { id: '123456', fullName: 'Fixture Athlete', position: { abbreviation: 'C' } } };
  const rows = parseNflRoster({ items: [a, a] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '123456'); assert.equal(rows[0].position, 'C');
  assert.deepEqual(parseNflRoster({ athletes: [{ displayName: 'No Identity', position: { abbreviation: 'QB' } }] }), []);
});

function event({id,date,home,away,week=1,city="Houston",venue="Example Stadium",neutralSite=false}){
  return {
    id,
    date,
    week:{number:week},
    season:{type:2},
    competitions:[{
      date,
      neutralSite,
      venue:{fullName:venue,address:{city}},
      competitors:[
        {homeAway:"home",team:{abbreviation:home}},
        {homeAway:"away",team:{abbreviation:away}},
      ],
    }],
  };
}

test("NFL schedule profile derives rest, travel and schedule stress without market inputs", () => {
  const rows=buildScheduleProfile([
    event({id:"1",date:"2026-09-13T17:00:00Z",home:"HOU",away:"IND",week:1,city:"Houston"}),
    event({id:"2",date:"2026-09-17T00:15:00Z",home:"DEN",away:"HOU",week:2,city:"Denver"}),
    event({id:"3",date:"2026-09-27T17:00:00Z",home:"SEA",away:"HOU",week:3,city:"Seattle"}),
  ],"HOU",2026,Date.parse("2026-09-10T12:00:00Z"));

  assert.equal(rows.length,3);
  assert.equal(rows[0].site,"HOME");
  assert.equal(rows[1].site,"ROAD");
  assert.equal(rows[1].shortWeek,true);
  assert.ok(rows[1].travelMiles>800);
  assert.ok(rows[1].stressFlags.includes("SHORT_WEEK"));
  assert.ok(rows[1].scheduleStressScore>0);
  assert.equal(rows[2].roadTripGameNumber,2);
});

test("NFL schedule profile recognizes international venue as travel stress", () => {
  const rows=buildScheduleProfile([
    event({id:"1",date:"2026-09-13T17:00:00Z",home:"NYG",away:"DAL",week:1,city:"East Rutherford"}),
    event({id:"2",date:"2026-09-20T13:30:00Z",home:"DAL",away:"NYG",week:2,city:"London",venue:"Wembley Stadium",neutralSite:true}),
  ],"NYG",2026,Date.parse("2026-09-10T12:00:00Z"));
  assert.equal(rows[1].international,true);
  assert.ok(rows[1].stressFlags.includes("INTERNATIONAL"));
  assert.ok(rows[1].timeZonesCrossed>=4);
});

test("profile attachment is contextual and explicitly research-only for schedule stress", () => {
  const games=[{sport:"nfl",home:{abbr:"SF"},away:{abbr:"SEA"}}];
  const out=attachNflPersistentProfiles(games,{
    teams:{sf:{team_key:"sf",schedule_stress_score:.2},sea:{team_key:"sea",schedule_stress_score:.7}},
    players:{sf:[{player_name:"A"}],sea:[{player_name:"B"}]},
  });
  assert.equal(out[0].nflPersistentProfile.configured,true);
  assert.equal(out[0].nflPersistentProfile.researchOnlyScheduleStress,true);
  assert.equal(out[0].nflPersistentProfile.home.players.length,1);
});

test("haversine helper produces plausible cross-country distance", () => {
  const miles=haversineMiles({lat:37.4,lon:-122.0},{lat:40.8,lon:-74.1});
  assert.ok(miles>2400&&miles<2700);
});


test("NFL persistent profile injury classification records type without inventing a recovery date", () => {
  assert.equal(injuryType("Right high ankle sprain"),"ANKLE");
  assert.equal(injuryType("Concussion protocol"),"CONCUSSION");
  assert.equal(injurySeverityClass("OUT","Right ankle sprain"),"UNAVAILABLE");
  assert.equal(injurySeverityClass("QUESTIONABLE","Hamstring"),"ELEVATED_AVAILABILITY_RISK");
});


test("normal Sunday-to-Sunday cadence is not a short week when kickoff windows differ", () => {
  const rows=buildScheduleProfile([
    event({id:"1",date:"2026-09-13T20:25:00Z",home:"DAL",away:"NYG",week:1,city:"Arlington"}),
    event({id:"2",date:"2026-09-20T17:00:00Z",home:"CHI",away:"DAL",week:2,city:"Chicago"}),
  ],"DAL",2026,Date.parse("2026-09-10T12:00:00Z"));
  assert.equal(rows[1].shortWeek,false);
  assert.ok((Date.parse(rows[1].start_time)-Date.parse(rows[0].start_time))/3600000 > 144);
});

test("Monday-to-Sunday turnaround remains classified as a short week", () => {
  const rows=buildScheduleProfile([
    event({id:"1",date:"2026-09-15T00:15:00Z",home:"HOU",away:"DAL",week:1,city:"Houston"}),
    event({id:"2",date:"2026-09-20T17:00:00Z",home:"DAL",away:"NYG",week:2,city:"Arlington"}),
  ],"DAL",2026,Date.parse("2026-09-10T12:00:00Z"));
  assert.equal(rows[1].shortWeek,true);
});
