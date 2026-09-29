import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadNhlResearchPrior,
  projectNhlResearchGame,
  NHL_RESEARCH_MODEL_ID,
} from "../functions/lib/nhlResearchModel.js";
import { promoteNhlResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import { qualificationIntegrity } from "../functions/lib/slateEngine.js";
import { enrichTeam } from "../functions/lib/teams.js";
import { readFile } from "node:fs/promises";

describe("NHL research opening baseline", () => {
  it("loads previous-season official team summaries and remains market independent", async () => {
    const rows = Array.from({ length: 32 }, (_, i) => ({
      teamId: i + 1,
      teamFullName: i === 0 ? "Carolina Hurricanes" : i === 1 ? "Florida Panthers" : `Team ${i}`,
      gamesPlayed: 82,
      goalsForPerGame: i === 0 ? 3.55 : i === 1 ? 3.20 : 3.05,
      goalsAgainstPerGame: i === 0 ? 2.88 : i === 1 ? 2.75 : 3.05,
      powerPlayPct: 22,
      penaltyKillPct: 81,
      shotsForPerGame: 30,
      shotsAgainstPerGame: 29,
    }));
    const teams = rows.map((row, i) => ({
      id: row.teamId,
      fullName: row.teamFullName,
      rawTricode: i === 0 ? "CAR" : i === 1 ? "FLA" : `T${String(i).padStart(2,"0")}`,
    }));
    const prior = await loadNhlResearchPrior("2026-09-29", {
      fetcher: async (url) => ({
        ok: true,
        json: async () => ({ data: String(url).includes("/team?") ? teams : rows }),
      }),
    });
    assert.equal(prior.ok, true);
    assert.equal(prior.seasonId, 20252026);
    assert.equal(prior.marketInformed, false);
    assert.equal(prior.canQualify, false);
    assert.equal(prior.teams, 32);
  });

  it("keeps valid NHL provider abbreviations without a canonical registry row", () => {
    const nyr = enrichTeam("nhl", { name: "New York Rangers", abbr: "NYR", nhlId: "3" });
    const vgk = enrichTeam("nhl", { name: "Vegas Golden Knights", abbr: "VGK", nhlId: "54" });
    assert.equal(nyr.abbr, "NYR");
    assert.equal(vgk.abbr, "VGK");
  });

  it("has an official NHL schedule fallback when ESPN is unavailable in production", async () => {
    const core = await readFile(new URL("../functions/lib/slateEngineCore.js", import.meta.url), "utf8");
    assert.match(core, /api-web\.nhle\.com\/v1\/schedule/);
    assert.match(core, /fetchNhlOfficialSchedule/);
    assert.match(core, /id === "nhl"/);
  });

  it("projects independent scores and promotes them as RESEARCH only", () => {
    const prior = {
      ok: true,
      seasonId: 20252026,
      source: "NHL_STATS_TEAM_SUMMARY",
      leagueAvgGoals: 3.05,
      byAbbr: {
        CAR: { abbr:"CAR", goalsForPerGame:3.55, goalsAgainstPerGame:2.88 },
        FLA: { abbr:"FLA", goalsForPerGame:3.20, goalsAgainstPerGame:2.75 },
      },
    };
    const game = {
      id:"nhl-open",
      sport:"nhl",
      home:{abbr:"CAR",name:"Hurricanes"},
      away:{abbr:"FLA",name:"Panthers"},
      odds:{spread:-1.5,total:6.0},
      projectionKind:"PINNACLE_IMPLIED",
      model:{projectionKind:"PINNACLE_IMPLIED",projHome:3.75,projAway:2.25},
    };
    const proj = projectNhlResearchGame(game, prior);
    assert.equal(proj.ok, true);
    assert.equal(proj.modelId, NHL_RESEARCH_MODEL_ID);
    assert.equal(proj.marketInformed, false);
    assert.equal(proj.canQualify, false);
    assert.ok(Number.isFinite(proj.home));
    assert.ok(Number.isFinite(proj.away));

    const promoted = promoteNhlResearchToBoard([{ ...game, nhlResearch: proj }]).games[0];
    assert.equal(promoted.projectionKind, "FBIS");
    assert.equal(promoted.projectionMaturity, "RESEARCH");
    assert.equal(promoted.canQualify, false);
    assert.equal(promoted.canAuthorizeWager, false);
    assert.equal(promoted.model.pHomeFinal, null);
    assert.equal(promoted.marketProjHome, 3.75);
    assert.equal(qualificationIntegrity("nhl", promoted).ok, false);
  });
});
