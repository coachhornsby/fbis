import test from "node:test";
import assert from "node:assert/strict";
import {
  isTennisLibraryActive,
  TENNIS_LIBRARY_ACTIVE_STATE,
  TENNIS_LIBRARY_INACTIVE_STATE,
} from "../functions/lib/tennisActiveLibrary.js";
import { resolveTennisFixturePlayers } from "../functions/lib/tennisFixturePlayerLink.js";

test("active library membership requires RANKED_ACTIVE or positive current_rank", () => {
  assert.equal(isTennisLibraryActive({ active_state: TENNIS_LIBRARY_ACTIVE_STATE, current_rank: 12 }), true);
  assert.equal(isTennisLibraryActive({ active_state: TENNIS_LIBRARY_INACTIVE_STATE, current_rank: null }), false);
  assert.equal(isTennisLibraryActive({ active_state: "UNKNOWN", current_rank: 5 }), true);
  assert.equal(isTennisLibraryActive({ active_state: "UNKNOWN", current_rank: 0 }), false);
  assert.equal(isTennisLibraryActive(null), false);
});

test("fixture identity prefers the ranked-active canonical row when names collide", async () => {
  const rows = {
    tennis_players: [
      {
        player_id: "tennis:wta:old",
        player_name: "Test Player",
        current_rank: null,
        ranking_points: null,
        country_code: "US",
        official_source: "WTA_OFFICIAL",
        headshot_url: null,
        career_wins: 1,
        career_losses: 1,
        source_as_of: "2020-01-01",
        active_state: TENNIS_LIBRARY_INACTIVE_STATE,
      },
      {
        player_id: "tennis:wta:new",
        player_name: "Test Player",
        current_rank: 44,
        ranking_points: 900,
        country_code: "US",
        official_source: "WTA_OFFICIAL",
        headshot_url: null,
        career_wins: 10,
        career_losses: 4,
        source_as_of: "2026-10-15",
        active_state: TENNIS_LIBRARY_ACTIVE_STATE,
      },
    ],
    tennis_player_bank: [],
  };
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes("FROM tennis_players")) return { results: rows.tennis_players };
              if (sql.includes("FROM tennis_player_bank")) return { results: rows.tennis_player_bank };
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const resolved = await resolveTennisFixturePlayers(db, {
    id: "fx-1",
    tour: "wta",
    away_name: "Test Player",
    home_name: "Other Athlete",
  });
  // Second name missing => not fully verified, but first match should pick ranked-active id.
  assert.equal(resolved.players[0].fbisPlayerId, "tennis:wta:new");
  assert.equal(resolved.players[0].rank, 44);
});
