import test from "node:test";
import assert from "node:assert/strict";
import { matchupAdvantageTeam, matchupTeamColors, teamHex } from "../src/lib/matchupTeamBrand.js";

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
