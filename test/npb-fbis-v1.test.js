import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNpbBattingPage,
  parseNpbPitchingPage,
  parseNpbScheduleMonth,
  projectNpbGame,
  attachNpbFbisV1,
} from "../functions/lib/npbFbisV1.js";

test("NPB parsers extract official batting and pitching features", () => {
  const batting = `
  <table><tr><th>Player</th><th>G</th><th>PA</th><th>AB</th><th>R</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>TB</th><th>RBI</th><th>SB</th><th>CS</th><th>SH</th><th>SF</th><th>BB</th><th>IBB</th><th>HP</th><th>SO</th><th>GDP</th><th>AVG</th><th>SLG</th><th>OBP</th></tr>
  <tr><td><a href="/bis/players/67890.html">Hitter One</a></td><td>100</td><td>420</td><td>380</td><td>60</td><td>110</td><td>20</td><td>2</td><td>15</td><td>179</td><td>55</td><td>3</td><td>1</td><td>0</td><td>3</td><td>30</td><td>0</td><td>7</td><td>80</td><td>8</td><td>.289</td><td>.471</td><td>.350</td></tr></table>`;
  const pitching = `
  <table><tr><th>Pitcher</th><th>G</th><th>W</th><th>L</th><th>SV</th><th>HLD</th><th>HP</th><th>CG</th><th>SHO</th><th>NWG</th><th>PCT</th><th>BF</th><th>IP</th><th>H</th><th>HR</th><th>BB</th><th>IBB</th><th>HB</th><th>SO</th><th>WP</th><th>BK</th><th>R</th><th>ER</th><th>ERA</th></tr>
  <tr><td><a href="/bis/players/12345.html">Starter One</a></td><td>24</td><td>12</td><td>6</td><td>0</td><td>0</td><td>0</td><td>2</td><td>1</td><td>0</td><td>.667</td><td>600</td><td>150.2</td><td>120</td><td>10</td><td>30</td><td>0</td><td>2</td><td>168</td><td>2</td><td>0</td><td>45</td><td>40</td><td>2.39</td></tr></table>`;
  const b=parseNpbBattingPage(batting);
  const p=parseNpbPitchingPage(pitching);
  assert.equal(b.length,1);
  assert.equal(b[0].playerId,"67890");
  assert.equal(b[0].games,100);
  assert.equal(b[0].runs,60);
  assert.equal(p.length,1);
  assert.equal(p[0].playerId,"12345");
  assert.ok(p[0].kPer9>9);
});

test("NPB schedule parser resolves teams, start and probable-starter IDs", () => {
  const html=`<table>
  <tr><td>9/30（水）</td><td>阪神 - ヤクルト</td><td>甲子園 18:00</td><td></td><td><a href="/bis/players/111.html">先発</a> <a href="/bis/players/222.html">先発</a></td></tr>
  <tr><td></td><td>楽天 - ロッテ</td><td>楽天モバイル 18:00</td><td></td><td><a href="/bis/players/333.html">先発</a> <a href="/bis/players/444.html">先発</a></td></tr>
  <tr><td>10/1（木）</td><td>阪神 - 広島</td><td>甲子園 18:00</td></tr>
  </table>`;
  const g=parseNpbScheduleMonth(html,"2026-09-30");
  assert.equal(g.length,2);
  assert.equal(g[0].home.abbr,"HAN");
  assert.equal(g[0].away.abbr,"YAK");
  assert.equal(g[0].probableStarterIds.home,"111");
  assert.equal(g[1].home.abbr,"RAK");
});

test("NPB model creates independent full-game, F5 and starter-K projections", () => {
  const game={id:"g1",home:{abbr:"HAN"},away:{abbr:"YAK"},probableStarterIds:{home:"1",away:"2"}};
  const ctx={
    teams:{
      HAN:{runsPerGame:4.1,kRate:.19,staffEra:2.8},
      YAK:{runsPerGame:3.5,kRate:.23,staffEra:3.9},
    },
    pitchersByTeam:{
      HAN:[{playerId:"1",name:"Hanshin SP",era:2.4,kPer9:9.2,ipPerGame:6.1}],
      YAK:[{playerId:"2",name:"Yakult SP",era:4.1,kPer9:7.6,ipPerGame:5.3}],
    }
  };
  const p=projectNpbGame(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.marketInformed,false);
  assert.ok(p.total>0);
  assert.ok(p.f5.total>0);
  assert.ok(p.pitcherKs.home.projection>0);
  const attached=attachNpbFbisV1([game],ctx).games[0];
  assert.equal(attached.projectionKind,"FBIS");
  assert.equal(attached.model.maturity,"RESEARCH");
  assert.equal(attached.model.canQualify,false);
});


test("NPB schedule parser respects textual home-away order rather than team registry order", () => {
  const html=`<table>
    <tr><td>10/1（木）</td><td>広島 - 中日</td><td>マツダスタジアム 18:00</td><td></td><td><a href="/bis/players/901.html">先発</a> <a href="/bis/players/902.html">先発</a></td></tr>
    <tr><td></td><td>ロッテ - 日本ハム</td><td>ZOZOマリン 18:00</td><td></td><td><a href="/bis/players/903.html">先発</a> <a href="/bis/players/904.html">先発</a></td></tr>
  </table>`;
  const g=parseNpbScheduleMonth(html,"2026-10-01");
  assert.equal(g.length,2);
  assert.equal(g[0].home.abbr,"HIR");
  assert.equal(g[0].away.abbr,"CHU");
  assert.equal(g[1].home.abbr,"LOT");
  assert.equal(g[1].away.abbr,"HAM");
});
