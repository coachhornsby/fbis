import test from "node:test";
import assert from "node:assert/strict";
import { resetCacheMem } from "../functions/lib/cache.js";
import { loadCfbDeepFeatures, attachCfbDeepFeatures } from "../functions/lib/cfbDeepFeed.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";

const FAKE_KEY = "test-cfbd-key-not-real";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json(){ return body; } };
}

test("CFBD deep feed carries current form and matchup features into CFB-FBIS-v2", async () => {
  resetCacheMem();
  const now = Date.parse("2026-09-25T18:00:00.000Z");
  const fetchFn = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/ppa/teams") return response([
      { team:"Ohio State", offense:{ overall:0.30, passing:0.34, rushing:0.21 }, defense:{ overall:-0.10, passing:-0.12, rushing:-0.08 } },
      { team:"Michigan", offense:{ overall:0.14, passing:0.12, rushing:0.18 }, defense:{ overall:-0.05, passing:-0.06, rushing:-0.03 } },
    ]);
    if (path === "/stats/season/advanced") return response([
      { team:"Ohio State", offense:{ successRate:0.49, explosiveness:1.25, lineYards:3.4, pointsPerOpportunity:4.8, plays:140 }, defense:{ successRate:0.34, explosiveness:0.82, havoc:{total:0.19}, lineYards:2.4, stuffRate:0.22, pointsPerOpportunity:2.9 } },
      { team:"Michigan", offense:{ successRate:0.42, explosiveness:1.02, lineYards:3.0, pointsPerOpportunity:3.7, plays:132 }, defense:{ successRate:0.39, explosiveness:0.94, havoc:{total:0.15}, lineYards:2.8, stuffRate:0.18, pointsPerOpportunity:3.4 } },
    ]);
    if (path === "/games") return response([
      { status:"completed", startDate:"2026-09-05T23:00:00.000Z", homeTeam:"Ohio State", awayTeam:"Michigan", homePoints:35, awayPoints:21 },
      { status:"completed", startDate:"2026-09-12T23:00:00.000Z", homeTeam:"Ohio State", awayTeam:"Michigan", homePoints:31, awayPoints:24 },
      { status:"scheduled", startDate:"2026-09-26T23:00:00.000Z", homeTeam:"Ohio State", awayTeam:"Michigan", homePoints:null, awayPoints:null },
    ]);
    return response({ message:"not found" }, 404);
  };

  const feed = await loadCfbDeepFeatures({ CFBD_API_KEY: FAKE_KEY }, { fetchFn, now });
  assert.equal(feed.meta.configured, true);
  assert.equal(feed.meta.completedFormTeams >= 2, true);
  const osu = feed.byEspnId["194"] || feed.bySchool["ohio state"];
  assert.ok(osu);
  assert.equal(osu.gamesPlayed, 2);
  assert.equal(osu.currentPointsForPerGame, 33);
  assert.equal(osu.currentPointsAgainstPerGame, 22.5);
  assert.equal(osu.passEpa, 0.34);
  assert.equal(osu.successRate, 0.49);
  assert.equal(osu.havocRate, 0.19);
  assert.equal(osu.lineYards, 3.4);
  assert.equal(osu.pointsPerOpportunity, 4.8);
  assert.equal(osu.pacePlaysPerGame, 70);
  assert.equal(osu.paceNorm, 0);
  assert.equal(osu.off, undefined);
  assert.equal(osu.def, undefined);

  const [game] = attachCfbDeepFeatures([{
    sport:"cfb",
    home:{ name:"Ohio State", school:"Ohio State", espnId:"194" },
    away:{ name:"Michigan", school:"Michigan", espnId:"130" },
    cfb:{ homeEst:{ priorOff:38, priorDef:17 }, awayEst:{ priorOff:31, priorDef:20 } },
  }], feed);
  assert.equal(game.cfbDeepInput.home.gamesPlayed, 2);
  const proj = projectCfbFbisV2(game);
  assert.equal(proj.ok, true);
  assert.equal(proj.uncertainty.prior_share < 1, true);
  assert.equal(proj.decomposition.PASS_MATCHUP != null, true);
  assert.equal(proj.decomposition.SUCCESS != null, true);
  assert.equal(proj.decomposition.HAVOC != null, true);
  assert.equal(proj.decomposition.TRENCHES != null, true);
  assert.equal(proj.decomposition.FINISHING_DRIVES != null, true);

  const dump = JSON.stringify(feed.meta);
  assert.equal(dump.includes(FAKE_KEY), false);
  assert.equal(dump.includes("Bearer"), false);
});
