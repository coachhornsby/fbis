import test from "node:test";
import assert from "node:assert/strict";
import { matchupAdvantageTeam, matchupTeamColors, matchupSignalColors, teamHex } from "../src/lib/matchupTeamBrand.js";

const away = { name: "Florida Panthers", abbr: "FLA", color: "C8102E", altColor: "041E42", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/fla.png" };
const home = { name: "Buffalo Sabres", abbr: "BUF", color: "#003087", secondaryColor: "#FFB81C", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/buf.png" };

test("only a resolved matchup-side advantage receives team branding", () => {
  assert.deepEqual(matchupAdvantageTeam({ edge: "FLA" }, away, home), { team: away, side: "away" });
  assert.deepEqual(matchupAdvantageTeam({ advantage: "Buffalo Sabres" }, away, home), { team: home, side: "home" });
  for (const edge of ["EVEN", "UNAVAILABLE", "—", "ATL", "", "DRAW"]) {
    assert.equal(matchupAdvantageTeam({ edge }, away, home), null, edge);
  }
  assert.equal(matchupAdvantageTeam({}, away, home), null);
});

test("rejects ambiguous or unknown team identity instead of inventing a logo", () => {
  const duplicate = { ...home, abbr: "FLA" };
  assert.equal(matchupAdvantageTeam({ edge: "FLA" }, away, duplicate), null);
  assert.equal(matchupAdvantageTeam({ edge: "HOME" }, away, home), null);
});

test("only validates source-provided primary and secondary hex colors", () => {
  assert.deepEqual(matchupTeamColors(away), { primary: "#C8102E", secondary: "#041E42" });
  assert.deepEqual(matchupTeamColors(home), { primary: "#003087", secondary: "#FFB81C" });
  assert.deepEqual(matchupTeamColors({ color: "#abc", altColor: "def" }), { primary: "#abc", secondary: "#def" });
  assert.deepEqual(matchupTeamColors({ color: "rgb(3,2,1)", altColor: "transparent" }), { primary: null, secondary: null });
  assert.equal(teamHex("javascript:alert(1)"), null);
});

test("NHL signal tiles use each club's true secondary outline, including Utah and Anaheim",()=>{
 assert.deepEqual(matchupSignalColors({abbr:"UTA"},"nhl"),
   {primary:"#010101",secondary:"#6CACE4"});
 assert.deepEqual(matchupSignalColors({abbr:"ANA"},"nhl"),
   {primary:"#000000",secondary:"#91764B"});
 assert.deepEqual(matchupSignalColors({abbr:"NJ"},"nhl"),
   {primary:"#E03A3E",secondary:"#000000"});
 assert.equal(matchupSignalColors({abbr:"TBL"},"nhl").secondary,"#000000");
 assert.equal(matchupSignalColors({abbr:"SJS"},"nhl").secondary,"#F38F20");
 const custom={abbr:"ANA",color:"112233",secondaryColor:"#ffee55"};
 assert.deepEqual(matchupSignalColors(custom,"nhl"),
   {primary:"#112233",secondary:"#ffee55"},"live validated colors override fallback");
 assert.deepEqual(matchupSignalColors({abbr:"ANA"},"nba"),
   {primary:null,secondary:null},"never apply NHL palette to a different sport");
 assert.deepEqual(matchupSignalColors({abbr:"UNKNOWN"},"nhl"),
   {primary:null,secondary:null});
});

test("both NHL signal variants show large translucent marks without changing the top hero",async()=>{
 const {readFile}=await import("node:fs/promises");
 const paths=["../src/components/board/CompactGameCard.jsx","../src/components/board/NhlMatchupSignals.jsx"];
 for(const path of paths){
  const code=await readFile(new URL(path,import.meta.url),"utf8");
  assert.match(code,/matchupSignalColors/);
  assert.match(code,/cgc-matchup-team-mark" aria-hidden="true"/);
  assert.match(code,/size=\\{112\\}/);
 }
 const css=await readFile(new URL("../src/components/board/universalPremiumCard.css",import.meta.url),"utf8");
 assert.match(css,/var\\(--fbis-tile-border/);
 assert.match(css,/opacity: \\.20 !important/);
 assert.match(css,/position: absolute !important/);
 assert.match(css,/pointer-events: none !important/);
 assert.match(css,/\\.cgc-matchup-pill\\.is-team-branded \\.cgc-matchup-metric/);
});
