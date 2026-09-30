import test from "node:test";
import assert from "node:assert/strict";
import { parseKboSchedule, parseKboStandings, projectKboGame, attachKboFbisV1 } from "../functions/lib/kboFbisV1.js";

test("KBO schedule parser converts KST start times to UTC and resolves teams", () => {
  const html=`<table>
    <tr><td>10.01(THU)</td><td>REGULAR</td><td>18:30</td><td>NC</td><td>:</td><td>DOOSAN</td><td>JAMSIL</td></tr>
    <tr><td>18:30</td><td>HANWHA</td><td>:</td><td>SAMSUNG</td><td>DAEGU</td></tr>
    <tr><td>10.03(SAT)</td><td>REGULAR</td><td>14:00</td><td>KIA</td><td>:</td><td>LG</td><td>JAMSIL</td></tr>
  </table>`;
  const games=parseKboSchedule(html,"2026-10-01");
  assert.equal(games.length,2);
  assert.equal(games[0].away.abbr,"NC");
  assert.equal(games[0].home.abbr,"DOOSAN");
  assert.equal(games[0].start,"2026-10-01T09:30:00.000Z");
});

test("KBO standings parser captures team run environment", () => {
  const html=`<table>
    <tr><th>RK</th><th>TEAM</th><th>GAMES</th><th>W</th><th>L</th><th>D</th><th>PCT</th><th>GB</th><th>STREAK</th><th>HOME</th><th>AWAY</th></tr>
    <tr><td>1</td><td>KT</td><td>132</td><td>80</td><td>48</td><td>4</td><td>.625</td><td>0</td><td>W1</td><td>42-23-1</td><td>38-25-3</td></tr>
    <tr><th>RK</th><th>TEAM</th><th>AVG</th><th>ERA</th><th>RUNS</th><th>RUNS ALLOWED</th><th>HR</th></tr>
    <tr><td>1</td><td>KT</td><td>.281</td><td>4.24</td><td>743</td><td>610</td><td>105</td></tr>
  </table>`;
  const teams=parseKboStandings(html);
  assert.equal(teams.KT.games,132);
  assert.ok(teams.KT.runsPerGame>5);
  assert.ok(teams.KT.runsAllowedPerGame>4);
});

test("KBO model produces market-blind full game and F5 research scores", () => {
  const game={id:"k1",home:{abbr:"KIA"},away:{abbr:"KT"}};
  const ctx={teams:{
    KIA:{games:132,pct:.554,runsPerGame:5.33,runsAllowedPerGame:4.63},
    KT:{games:134,pct:.623,runsPerGame:5.64,runsAllowedPerGame:4.67},
  }};
  const p=projectKboGame(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.ok(p.total>0);
  assert.ok(p.f5.total>0);
  assert.equal(p.starterState,"BLOCKED_OFFICIAL_PROBABLE_STARTER_FEED");
  const attached=attachKboFbisV1([game],ctx).games[0];
  assert.equal(attached.projectionKind,"FBIS");
  assert.equal(attached.model.maturity,"RESEARCH");
});
