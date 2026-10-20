import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const view=fs.readFileSync("src/MyBetsView.jsx","utf8");
const logo=fs.readFileSync("src/components/TeamLogo.jsx","utf8");
const betsCss=fs.readFileSync("src/myBets.css","utf8");
const shellCss=fs.readFileSync("src/index.css","utf8");

test("My Bets overrides both legacy centered desktop width caps within its route",()=>{
  assert.match(betsCss,/\.bets-dashboard\{--bets-line:[^}]*max-width:1600px/);
  assert.match(shellCss,/\.fbis-shell-main:not\(\.route-player-props\) \.main-content\s*\{[\s\S]*?width:min\(1500px,100%\)/);
  assert.match(betsCss,/\.fbis-shell-main\.route-bets \.main-content\.bets-dashboard\s*\{[^}]*?width:\s*100%;[^}]*?max-width:\s*none;/);
  assert.match(betsCss,/\.fbis-shell-main\.route-bets \.bets-ledger-table\s*\{[^}]*?min-width:\s*2200px;/);
});

test("TeamLogo gets configurable sizing and bare fallback without changing defaults",()=>{
  assert.match(logo,/logoSize = 36, logoTone = "dark"/);
  assert.match(logo,/size=\{logoSize\} tone=\{logoTone\}/);
  assert.match(logo,/team-logo-fallback\$\{plate \? " team-logo-plate" : ""\}/);
  assert.match(view,/logoSize=\{54\}/);
  assert.match(view,/logoTone="none"/);
  assert.match(betsCss,/\.bets-dashboard \.bets-ledger-table \.team-logo-wrap\s*\{[^}]*background:\s*transparent !important;[^}]*box-shadow:\s*none !important;/);
});

test("Ordinary athlete headshots are 50% larger, while combo leg images retain their size",()=>{
  const ordinary=[...view.matchAll(/size=\{compact \? 48 : 66\}/g)];
  assert.equal(ordinary.length,2,"both tennis and noncombo player prop rows use 48px compact and 66px full-size images");
  assert.match(view,/function TennisParticipants/);
  assert.match(view,/function PlayerPropParticipants/);
  assert.match(view,/function ComboSelection/);
  assert.match(view,/<PlayerHeadshot name=\{leg.player\} sport=\{bet.sport\} size=\{38\}/);
});
