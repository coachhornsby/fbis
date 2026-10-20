import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManifestRow,
  buildR2ArchiveManifestRow,
  describeWeeklyReconstructionWindow,
} from "../functions/lib/cfbCollectionManifestPersist.js";
import { DATASET_STATUS } from "../functions/lib/cfbSdvSourceRegistry.js";
import { buildGamesTeamsPlayersReconcileRows } from "../functions/lib/cfbGamesTeamsPlayersReconcile.js";
import { mergeGamesPlayersByCategory } from "../functions/lib/cfbDailyPostgame.js";
import { WEEKLY_COLLECTION_SCHEDULE } from "../functions/lib/cfbWeeklyCollection.js";

test("targetWeek 8 archives statistical throughWeek 7", () => {
  const w = describeWeeklyReconstructionWindow(8);
  assert.equal(w.ok, true);
  assert.equal(w.targetWeek, 8);
  assert.equal(w.throughWeek, 7);
  assert.match(w.note, /statistical week 7/);
});

test("buildManifestRow uses valid DATASET_STATUS keys (never undefined status)", () => {
  const ok = buildManifestRow({
    season: 2026,
    week: 8,
    provider: "cfbd",
    datasetId: "cfbd-games-teams-players",
    required: true,
    httpOk: true,
    httpStatus: 200,
    rowCount: 62,
    teamCoverage: null,
    throughWeek: 7,
  });
  assert.equal(ok.status, DATASET_STATUS.COMPLETE_VERIFIED);
  assert.equal(ok.status, "complete_and_verified");

  const partial = buildManifestRow({
    season: 2026,
    week: 8,
    provider: "cfbd",
    datasetId: "cfbd-ppa-teams",
    required: true,
    httpOk: true,
    rowCount: 80,
    teamCoverage: 80,
  });
  assert.equal(partial.status, DATASET_STATUS.PARTIAL);

  const blocked = buildManifestRow({
    season: 2026,
    week: 8,
    provider: "cfbd",
    datasetId: "cfbd-games",
    required: true,
    allowanceBlocked: true,
    httpOk: false,
    rowCount: 0,
  });
  assert.equal(blocked.status, DATASET_STATUS.BLOCKED_ALLOWANCE);
});

test("R2 reconcile row is complete_and_verified with real object evidence", () => {
  const row = buildR2ArchiveManifestRow({
    season: 2026,
    week: 8,
    datasetId: "cfbd-games-teams-players",
    r2Key: "raw/cfbd/cfb/2026/games_teams/week-7:gamesTeams/c31487d2248d.json",
    objectBytes: 172419,
    throughWeek: 7,
    rowCount: 62,
    uploadedAt: "2026-10-18T08:02:00Z",
  });
  assert.equal(row.status, "complete_and_verified");
  assert.equal(row.row_count, 62);
  assert.equal(row.through_week, 7);
  assert.equal(row.http_ok, 1);
});

test("games-teams-players reconcile builds W7 verified + preserves W8 gap failure", () => {
  const archives = [
    {
      kind: "games_teams",
      key: "raw/cfbd/cfb/2026/games_teams/week-7:gamesTeams/c31487d2248d.json",
      bytes: 172419,
      rowCount: 62,
      jobRunId: "cfb-current-refresh:test",
    },
    {
      kind: "games_players_passing",
      key: "raw/cfbd/cfb/2026/games_players/week-7:gamesPlayers:passing/c45ade2b1a36.json",
      bytes: 158219,
      rowCount: 117,
      jobRunId: "cfb-current-refresh:test",
    },
    {
      kind: "games_players_receiving",
      key: "raw/cfbd/cfb/2026/games_players/week-7:gamesPlayers:receiving/ecf9b08c0f08.json",
      bytes: 491948,
      rowCount: 117,
      jobRunId: "cfb-current-refresh:test",
    },
    {
      kind: "games_players_rushing",
      key: "raw/cfbd/cfb/2026/games_players/week-7:gamesPlayers:rushing/c56b0538442d.json",
      bytes: 394496,
      rowCount: 117,
      jobRunId: "cfb-current-refresh:test",
    },
  ];
  const built = buildGamesTeamsPlayersReconcileRows({ season: 2026, targetWeek: 8, archives });
  assert.equal(built.ok, true);
  assert.equal(built.summary.throughWeek, 7);
  assert.equal(built.summary.gamesTeamsRowCount, 62);
  assert.equal(built.summary.week8StatisticalCollected, false);
  assert.equal(built.summary.pendingCollectionPreservedFailed, true);
  const byId = Object.fromEntries(built.rows.map((r) => [r.manifest_id, r]));
  assert.equal(byId["2026:W7:cfbd-games-teams-players:r2-recon:games-teams-pla"].status, "complete_and_verified");
  assert.equal(byId["2026:W8:cfbd-games-teams-players:r2-recon:games-teams-pla"].status, "complete_and_verified");
  assert.equal(byId["2026:W8:cfbd-games-teams-players:r2-recon:games-teams-pla"].through_week, 7);
  assert.equal(byId["2026:W8:cfbd-games-teams-players:pending-collection"].status, "failed");
  assert.equal(byId["2026:W8:cfbd-games-teams-players:pending-collection"].row_count, 0);
  assert.equal(byId["2026:W8:cfbd-games-teams-players:pending-collection"].through_week, 7);
});

test("category player boxes merge into canonical game reconstruction", () => {
  const merged = mergeGamesPlayersByCategory([
    {
      category: "passing",
      rows: [
        {
          id: 1,
          teams: [{ team: "A", categories: [{ name: "passing", types: [{ athletes: [{ id: 1 }] }] }] }],
        },
      ],
    },
    {
      category: "rushing",
      rows: [
        {
          id: 1,
          teams: [{ team: "A", categories: [{ name: "rushing", types: [{ athletes: [{ id: 2 }] }] }] }],
        },
      ],
    },
    {
      category: "receiving",
      rows: [
        {
          id: 1,
          teams: [{ team: "A", categories: [{ name: "receiving", types: [{ athletes: [{ id: 3 }] }] }] }],
        },
      ],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(
    merged[0].teams[0].categories.map((c) => c.name).sort(),
    ["passing", "receiving", "rushing"]
  );
});

test("weekly reconstruction schedule monitors games-teams-players", () => {
  const recon = WEEKLY_COLLECTION_SCHEDULE.find((s) => s.id === "cfbd-weekly-reconstruction");
  assert.ok(recon.datasets.includes("cfbd-games-teams-players"));
  assert.ok(recon.monitor?.r2Prefixes?.some((p) => p.includes("games_teams")));
  assert.ok(recon.monitor?.alertWhen);
});
