import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SPORTS, BOARD_SPORTS, projectGame } from "../functions/lib/slateEngineCore.js";
import { qualificationIntegrity } from "../functions/lib/slateEngine.js";

test("core slate/harvest pipeline includes all six learning sports", () => {
  for (const sport of ["mlb","nfl","cfb","cbb","nba","nhl"]) {
    assert.ok(BOARD_SPORTS.includes(sport), sport);
    assert.ok(SPORTS[sport], sport);
  }
  assert.equal(SPORTS.nhl.espn, "hockey/nhl");
});

test("NHL market-implied benchmark is explicit and cannot qualify", () => {
  const game = {
    sport: "nhl",
    home: { name: "Home", abbr: "HOM", record: "1-0" },
    away: { name: "Away", abbr: "AWY", record: "0-1" },
    odds: {
      spread: -1.5,
      total: 6.5,
      homeMl: -160,
      awayMl: 140,
    },
    projHomeScore: 4,
    projAwayScore: 2.5,
    projectionKind: "PINNACLE_IMPLIED",
  };
  const model = projectGame("nhl", game);
  assert.equal(model.projectionKind, "PINNACLE_IMPLIED");
  const gate = qualificationIntegrity("nhl", {
    ...game,
    model,
    projectionKind: model.projectionKind,
  });
  assert.equal(gate.ok, false);
  assert.match(String(gate.reason || gate.code), /market|independent|projection/i);
});

test("projection API and LLM selector enumerate all six sports without granting model authority", async () => {
  const api = await readFile(new URL("../functions/api/projections.js", import.meta.url), "utf8");
  for (const sport of ["mlb","nfl","cfb","cbb","nba","nhl"]) {
    assert.match(api, new RegExp(`["']${sport}["']`), sport);
  }

  const orchestrator = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(orchestrator, /LLM_GATE_SPORTS[\s\S]*mlb[\s\S]*cfb[\s\S]*nfl[\s\S]*cbb[\s\S]*nba[\s\S]*nhl/);
  assert.match(orchestrator, /game\.projection\?\.independent!==true/);
});
