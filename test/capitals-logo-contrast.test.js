import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {isWashingtonCapitalsLogo} from "../src/lib/teamLogoPresentation.js";

test("Washington Capitals logo treatment is restricted to NHL identity",()=>{
  assert.equal(isWashingtonCapitalsLogo({sport:"nhl",abbr:"WSH",name:"Washington Capitals"}),true);
  assert.equal(isWashingtonCapitalsLogo({sport:"NHL",name:"Washington Capitals",abbr:"—"}),true);
  assert.equal(isWashingtonCapitalsLogo({canonicalId:"nhl-wsh",abbr:"WSH"}),true);
  assert.equal(isWashingtonCapitalsLogo({sport:"nfl",abbr:"WSH",name:"Washington Commanders"}),false);
  assert.equal(isWashingtonCapitalsLogo({sport:"nhl",abbr:"NYR",name:"New York Rangers"}),false);
  assert.equal(isWashingtonCapitalsLogo({sport:"nhl",abbr:"—",name:"Unknown"}),false);
  assert.equal(isWashingtonCapitalsLogo({abbr:"WSH",name:"Washington Capitals"}),false);
});

test("Capitals treatment outlines only the mark and preserves default logos",()=>{
  const jsx=fs.readFileSync("src/components/TeamLogo.jsx","utf8");
  const css=fs.readFileSync("src/index.css","utf8");
  assert.match(jsx,/const isCapitals = isWashingtonCapitalsLogo\(team, \{abbr, name\}\)/);
  assert.match(jsx,/const plate = \(tone === "dark" \|\| tone === "auto"\) && !isCapitals;/);
  assert.match(jsx,/isCapitals \? " team-logo-capitals" : ""/);
  assert.match(css,/\.team-logo-wrap\.team-logo-capitals\s*\{[^}]*background:transparent !important;/);
  assert.match(css,/\.team-logo-wrap\.team-logo-capitals \.team-logo\s*\{[^}]*drop-shadow\(0 0 1px rgba\(255,255,255/);
  assert.doesNotMatch(css.slice(css.indexOf("/* Washington Capitals:")),/background:\s*(?:white|#fff)(?:;|\s|!)/i);
});
