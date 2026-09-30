import test from "node:test";
import assert from "node:assert/strict";

import {
  parseKboTeamHitterBasic1,
  parseKboTeamHitterBasic2,
  parseKboTeamPitcherBasic1,
  parseKboTeamPitcherBasic2,
  parseKboPitcherBasic1,
  parseKboPitcherAdvanced,
  mergeKboPitchers,
  parseOfficialStarterPage,
} from "../functions/lib/kboAdvanced.js";
import { projectKboGame } from "../functions/lib/kboFbisV1.js";

test("KBO official advanced team tables parse market-blind offense and pitching features", () => {
  const h1=`<table><tr><td>1</td><td>KT</td><td>.282</td><td>135</td><td>5450</td><td>4710</td><td>764</td><td>1330</td><td>224</td><td>19</td><td>108</td><td>1916</td><td>711</td><td>67</td><td>38</td></tr></table>`;
  const h2=`<table><tr><td>1</td><td>KT</td><td>.281</td><td>542</td><td>8</td><td>73</td><td>1017</td><td>95</td><td>.405</td><td>.364</td><td>.769</td><td>132</td><td>.304</td><td>.313</td></tr></table>`;
  const p1=`<table><tr><td>4</td><td>KT</td><td>4.30</td><td>135</td><td>80</td><td>48</td><td>30</td><td>50</td><td>.625</td><td>1200 0/3</td><td>1200</td><td>1100</td><td>115</td><td>420</td><td>65</td><td>1090</td><td>650</td><td>573</td><td>1.36</td></tr></table>`;
  const p2=`<table><tr><td>4</td><td>KT</td><td>4.30</td><td>0</td><td>7</td><td>62</td><td>20</td><td>5289</td><td>20371</td><td>.270</td><td>190</td><td>25</td><td>47</td><td>43</td><td>25</td><td>62</td><td>1</td></tr></table>`;
  assert.equal(parseKboTeamHitterBasic1(h1)[0].runsPerGame.toFixed(2),"5.66");
  assert.equal(parseKboTeamHitterBasic2(h2)[0].ops,.769);
  assert.equal(parseKboTeamPitcherBasic1(p1)[0].whip,1.36);
  assert.equal(parseKboTeamPitcherBasic2(p2)[0].qs,62);
});

test("KBO pitcher basic and advanced rows merge by official team/name", () => {
  const basic=`<table><tr><td>2</td><td>최민석</td><td>두산</td><td>2.73</td><td>25</td><td>14</td><td>4</td><td>0</td><td>0</td><td>.778</td><td>138 2/3</td><td>125</td><td>7</td><td>53</td><td>7</td><td>121</td><td>54</td><td>42</td><td>1.28</td></tr></table>`;
  const adv=`<table><tr><td>2</td><td>최민석</td><td>두산</td><td>2.73</td><td>.296</td><td>91.4</td><td>16.5</td><td>7.85</td><td>3.44</td><td>2.28</td><td>.315</td><td>.328</td><td>.643</td></tr></table>`;
  const merged=mergeKboPitchers(parseKboPitcherBasic1(basic),parseKboPitcherAdvanced(adv));
  assert.equal(merged.length,1);
  assert.equal(merged[0].team,"DOOSAN");
  assert.equal(merged[0].kPer9,7.85);
  assert.equal(merged[0].oppOps,.643);
});

test("official starter page parser resolves two starter identities when player links are present", () => {
  const html=`<div><a href="/Record/Player/PitcherDetail/Basic.aspx?playerId=11111">송명기</a><a href="/Record/Player/PitcherDetail/Basic.aspx?playerId=22222">최민석</a></div>`;
  const got=parseOfficialStarterPage(html,{});
  assert.equal(got.away.playerId,"11111");
  assert.equal(got.home.name,"최민석");
});

test("KBO v1.1 advanced model uses starter quality and produces starter Ks when resolved", () => {
  const game={id:"KBO-20261001-NC-DOOSAN",home:{abbr:"DOOSAN"},away:{abbr:"NC"}};
  const ctx={
    teams:{
      DOOSAN:{games:136,pct:.519,runsPerGame:4.69,runsAllowedPerGame:4.35},
      NC:{games:135,pct:.49,runsPerGame:5.01,runsAllowedPerGame:5.05},
    },
    advancedTeams:{
      DOOSAN:{games:136,pa:5293,ops:.728,obp:.337,slg:.391,so:935,bb:450,risp:.276,era:3.81,whip:1.34,oppAvg:.253,qs:61},
      NC:{games:135,pa:5286,ops:.751,obp:.349,slg:.402,so:984,bb:464,risp:.272,era:4.70,whip:1.42,oppAvg:.257,qs:46},
    },
    startersByGame:{
      "KBO-20261001-NC-DOOSAN":{
        source:"KBO_GAMECENTER_START_PIT",
        away:{playerId:"111",name:"NC SP",team:"NC",era:4.1,babip:.302,pitchesPerGame:90.3,pitchesPerInning:16.1,kPer9:7.39,bbPer9:2.68,kBb:2.76,oppOps:.747},
        home:{playerId:"222",name:"Doosan SP",team:"DOOSAN",era:2.73,babip:.296,pitchesPerGame:91.4,pitchesPerInning:16.5,kPer9:7.85,bbPer9:3.44,kBb:2.28,oppOps:.643},
      }
    }
  };
  // mirror derived rates ordinarily computed during advanced-load merge
  ctx.advancedTeams.DOOSAN.kRate=935/5293; ctx.advancedTeams.DOOSAN.bbRate=450/5293;
  ctx.advancedTeams.NC.kRate=984/5286; ctx.advancedTeams.NC.bbRate=464/5286;
  const p=projectKboGame(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.modelVersion,"research-v1.1-official-kbo-advanced-starter");
  assert.equal(p.starterState,"OFFICIAL_KBO_STARTERS_RESOLVED");
  assert.ok(p.pitcherKs.home.projection>0);
  assert.ok(p.pitcherKs.away.projection>0);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
});
