import test from "node:test";
import assert from "node:assert/strict";
import { tennisCardContext } from "../functions/lib/tennisPlayerBank.js";

// A barrier makes sequential fetching fail: all four independent reads must start.
test("Tennis player, form, H2H and surface queries start concurrently without changing evidence", async () => {
  let started = 0;
  const pending = [];
  const recent = [{
    player1_key: "iga", player2_key: "leylah",
    player1_name: "Iga", player2_name: "Leylah",
    match_date: "2025-01-01", tournament: "Test", surface: "hard",
    winner_key: "iga", score: "6-3 6-3",
  }];
  const payload = (sql) => {
    if (sql.includes("FROM tennis_player_bank")) return { results: [
      { player_key: "iga", player_id: "wta:iga", player_name: "Iga", current_rank: 1 },
      { player_key: "leylah", player_id: "wta:leylah", player_name: "Leylah", current_rank: 25 },
    ] };
    if (sql.includes("FROM tennis_player_profiles_current")) return { results: [
      { player_key: "iga", surface: "hard", profile_json: '{"elo":1900}' },
      { player_key: "leylah", surface: "hard", profile_json: '{"elo":1600}' },
    ] };
    return { results: recent };
  };
  const db = { prepare(sql) { return { bind() { return { all() {
    return new Promise((resolve) => {
      started++;
      pending.push(() => resolve(payload(sql)));
      if (started === 4) queueMicrotask(() => pending.forEach((done) => done()));
    });
  } }; } }; } };
  let timeout;
  try {
    const result = await Promise.race([
      tennisCardContext(db, { tour: "WTA", player1: "Iga", player2: "Leylah", surface: "hard" }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("database reads did not start concurrently")), 2000); }),
    ]);
    assert.equal(started, 4);
    assert.equal(result.players[0].name, "Iga");
    assert.equal(result.players[0].profiles[0].profile.elo, 1900);
    assert.equal(result.players[0].recentForm[0].result, "W");
    assert.equal(result.players[1].recentForm[0].result, "L");
    assert.equal(result.headToHead.meetings, 1);
    assert.equal(result.headToHead.surfacePlayer1Wins, 1);
    assert.equal(result.headToHead.scope, "STORED_HISTORY");
  } finally { clearTimeout(timeout); }
});

test("Tennis H2H read failure retains bounded recent-history fallback", async () => {
  const recent = [{
    player1_key: "iga", player2_key: "leylah",
    player1_name: "Iga", player2_name: "Leylah",
    match_date: "2025-01-01", surface: "hard", winner_key: "leylah",
  }];
  const db = { prepare(sql) { return { bind() { return { all() {
    if (sql.includes("FROM tennis_player_bank")) return Promise.resolve({ results: [] });
    if (sql.includes("FROM tennis_player_profiles_current")) return Promise.resolve({ results: [] });
    if (sql.includes("ORDER BY match_date DESC LIMIT 40")) return Promise.resolve({ results: recent });
    return Promise.reject(new Error("full H2H read unavailable"));
  } }; } }; } };
  const result = await tennisCardContext(db, { tour: "wta", player1: "Iga", player2: "Leylah", surface: "hard" });
  assert.equal(result.headToHead.scope, "RECENT_HISTORY_WINDOW");
  assert.equal(result.headToHead.meetings, 1);
  assert.equal(result.headToHead.player2Wins, 1);
});
