import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  pregameStartingGoalieIds,
  classifyGoaliePregameEvidence,
  NHL_PREGAME_CONFIRMATION_SOURCE,
  NHL_PREGAME_SCRATCH_SOURCE,
} from "../functions/lib/nhlPersistentProfiles.js";
import { resolveNhlGoalieStarterEvidence } from "../functions/lib/nhlGoalieStarterEvidence.js";

const ddl = readFileSync(new URL("../migrations/0056_nhl_persistent_profiles.sql", import.meta.url), "utf8");
const confirmationMigration = readFileSync(new URL("../migrations/0117_nhl_goalie_confirmation.sql", import.meta.url), "utf8");

function database({ applyConfirmation = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(ddl.split(/;\s*\n/).filter((statement) => /nhl_goalie_profiles/.test(statement)).join(";\n") + ";");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  if (applyConfirmation) db.exec(confirmationMigration);
  return db;
}

const writerSource = readFileSync(new URL("../functions/lib/nhlPersistentProfiles.js", import.meta.url), "utf8");
function productionGoalieUpsert() {
  const start = writerSource.indexOf("INSERT INTO nhl_goalie_profiles (");
  assert.ok(start > 0, "writer must contain the goalie upsert");
  const end = writerSource.indexOf("`", start);
  return writerSource.slice(start, end);
}

const goalieRow = (over = {}) => ({
  playerId: "8477992", playerName: "Test Starter", teamKey: "buf", hierarchyRank: 1,
  goalieState: "CONFIRMED_STARTER", expectedStartProbability: 1, games: 10, starts: 9,
  savePct: 0.915, gaa: 2.44, lastGameId: "2026020100", lastGameAt: "2026-10-18T23:00:00Z",
  rollingShotsFaced: 29.1, rollingSaves: 26.6, restDays: 2, stateConfidence: 0.97,
  confirmationGameId: "2026020150", confirmationObservedAt: "2026-10-20T16:00:00Z",
  confirmationSource: NHL_PREGAME_CONFIRMATION_SOURCE, evidenceClass: "POSITIVE", raw: {}, ...over,
});

function write(db, g, now = "2026-10-20T17:00:00Z") {
  db.prepare(productionGoalieUpsert()).run(
    g.playerId, g.playerName || "Unknown", g.teamKey, g.hierarchyRank, g.goalieState,
    g.expectedStartProbability, g.games, g.starts, g.savePct, g.gaa, g.lastGameId, g.lastGameAt,
    g.rollingShotsFaced, g.rollingSaves, g.restDays, g.stateConfidence, now,
    g.confirmationObservedAt ?? null, g.confirmationGameId ?? null, g.confirmationSource ?? null,
    g.evidenceClass || "MISSING",
    JSON.stringify(g.raw), now);
}

test("an explicit pregame starter marker is confirmation and time-on-ice is not", () => {
  const announced = pregameStartingGoalieIds({
    playerByGameStats: { homeTeam: { goalies: [{ playerId: 1, starter: true, toi: "0:00" }, { playerId: 2, toi: "65:00" }] } },
  });
  assert.deepEqual([...announced], ["1"]);
  assert.equal(pregameStartingGoalieIds({}).size, 0);
  assert.deepEqual(classifyGoaliePregameEvidence({}), { evidenceClass: "MISSING", reason: "NO_PREGAME_ANNOUNCEMENT" });
  assert.equal(classifyGoaliePregameEvidence({ announced: true }).evidenceClass, "POSITIVE");
  assert.equal(classifyGoaliePregameEvidence({ announced: true, ruledOut: true }).evidenceClass, "NEGATIVE");
});

test("0117 lets the production writer persist a pregame confirmation", () => {
  const db = database();
  write(db, goalieRow());
  const row = db.prepare("SELECT * FROM nhl_goalie_profiles WHERE player_id=?").get("8477992");
  assert.equal(row.goalie_state, "CONFIRMED_STARTER");
  assert.equal(row.confirmation_game_id, "2026020150");
  assert.equal(row.confirmation_source, NHL_PREGAME_CONFIRMATION_SOURCE);
  assert.equal(row.confirmation_observed_at, "2026-10-20T16:00:00Z");
  assert.equal(row.evidence_class, "POSITIVE");
});

test("a persisted confirmation resolves before the game", () => {
  const db = database();
  write(db, goalieRow());
  const rows = db.prepare("SELECT * FROM nhl_goalie_profiles WHERE team_key=?").all("buf");
  const evidence = resolveNhlGoalieStarterEvidence(
    { goalies: { buf: rows }, teams: { buf: { next_game_id: "2026020150" } } },
    "BUF",
    { eventId: "2026020150", gameStart: "2026-10-20T23:00:00Z", cutoff: "2026-10-20T22:00:00Z", projectionGoalieId: "8477992" },
  );
  assert.equal(evidence.state, "CONFIRMED");
  assert.equal(evidence.evidenceClass, "POSITIVE");
  assert.equal(evidence.playerId, "8477992");
  assert.equal(evidence.source, NHL_PREGAME_CONFIRMATION_SOURCE);
});

test("a refresh does not restamp an announcement first seen earlier", () => {
  const db = database();
  write(db, goalieRow(), "2026-10-20T16:00:00Z");
  write(db, goalieRow({ confirmationObservedAt: "2026-10-20T22:30:00Z" }), "2026-10-20T22:30:00Z");
  const row = db.prepare("SELECT * FROM nhl_goalie_profiles WHERE player_id=?").get("8477992");
  assert.equal(row.confirmation_observed_at, "2026-10-20T16:00:00Z");
  assert.equal(row.source_updated_at, "2026-10-20T22:30:00Z");
});

test("clearing a confirmation is missing evidence, and a scratch is negative evidence", () => {
  const db = database();
  write(db, goalieRow());
  write(db, goalieRow({
    goalieState: "EXPECTED_G1", expectedStartProbability: 0.68,
    confirmationGameId: null, confirmationObservedAt: null, confirmationSource: null, evidenceClass: "MISSING",
  }));
  const cleared = db.prepare("SELECT * FROM nhl_goalie_profiles WHERE player_id=?").get("8477992");
  assert.equal(cleared.confirmation_observed_at, null);
  assert.equal(cleared.evidence_class, "MISSING");
  write(db, goalieRow({
    goalieState: "RULED_OUT", expectedStartProbability: 0, evidenceClass: "NEGATIVE",
    confirmationSource: NHL_PREGAME_SCRATCH_SOURCE, confirmationObservedAt: "2026-10-20T18:00:00Z",
  }));
  const ruledOut = db.prepare("SELECT * FROM nhl_goalie_profiles WHERE player_id=?").get("8477992");
  assert.equal(ruledOut.evidence_class, "NEGATIVE");
  assert.equal(ruledOut.goalie_state, "RULED_OUT");
  const evidence = resolveNhlGoalieStarterEvidence(
    { goalies: { buf: [ruledOut] }, teams: { buf: { next_game_id: "2026020150" } } },
    "BUF",
    { eventId: "2026020150", gameStart: "2026-10-20T23:00:00Z", cutoff: "2026-10-20T22:00:00Z", projectionGoalieId: "8477992" },
  );
  assert.equal(evidence.state, "HISTORICAL_PROXY_UNVERIFIED");
  assert.equal(evidence.evidenceClass, "NEGATIVE");
});

test("the shipped 0056 schema cannot store confirmation columns", () => {
  const db = database({ applyConfirmation: false });
  const cols = db.prepare("PRAGMA table_info(nhl_goalie_profiles)").all().map((column) => column.name);
  assert.equal(cols.includes("confirmation_observed_at"), false);
  assert.equal(cols.includes("evidence_class"), false);
});
