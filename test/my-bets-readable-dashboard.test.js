import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const view=fs.readFileSync("src/MyBetsView.jsx","utf8");
const graph=fs.readFileSync("src/MyBetsIntelligence.jsx","utf8");
const styles=fs.readFileSync("src/myBets.css","utf8");
const dashboardStyles=fs.readFileSync("src/myBetsIntelligence.css","utf8");

test("My Bets no longer forces tiny font sizes in the manual final-score editor",()=>{
  assert.doesNotMatch(view,/fontSize:\s*(?:10|11|12)(?!\d)/);
  assert.match(view,/className="bets-score-entry"/);
  assert.match(styles,/\.bets-dashboard \.bets-ledger-table td input\s*\{/);
  assert.match(styles,/font-size:16px!important/);
});

test("My Bets keeps readable wager columns instead of shrinking the history to fit",()=>{
  assert.match(styles,/min-width:2240px/);
  assert.match(styles,/\.bets-dashboard \.bets-ledger-table th\s*\{/);
  assert.match(styles,/font-size:16px;/);
  assert.match(styles,/\.bets-dashboard \.bets-ledger-table :is\(th,td\):nth-child\(1\)/);
});

test("My Bets performance cards and profit chart have legible text and values",()=>{
  assert.match(dashboardStyles,/\.bets-dashboard \.mbi-kpi small\s*\{/);
  assert.match(dashboardStyles,/\.bets-dashboard \.mbi-bar small\s*\{/);
  assert.match(dashboardStyles,/\.bets-dashboard \.mbi-curve-facts/);
  assert.match(graph,/Peak <b>\{money\(high\)\}<\/b>/);
  assert.match(graph,/Low <b>\{money\(low\)\}<\/b>/);
  assert.match(graph,/Current <b className=/);
});
