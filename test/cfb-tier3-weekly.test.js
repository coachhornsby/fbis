import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCfbTier3WeeklyCsv, saveCfbTier3WeeklySnapshot } from "../functions/lib/cfbTier3Weekly.js";
import {
  CFB_TIER3_COLUMN_NAMES,
  CFB_TIER3_FEATURE_COLUMNS,
  CFB_TIER3_HEADER_SHA256,
  CFB_TIER3_SCHEMA_VERSION,
  assertCfbTier3Header,
  cfbTier3FeatureRegistry,
  diffCfbTier3Header,
} from "../functions/lib/cfbTier3FeatureRegistry.js";
import { onRequestPost, onRequestGet } from "../functions/api/college-tier3.js";

// Synthetic values only — never commit proprietary Tier 3 row contents.
const featureDefaults = Object.fromEntries(CFB_TIER3_FEATURE_COLUMNS.map((name, i) => [name, String((i % 17) / 10)]));
function syntheticRow({
  id = "401752873",
  week = "7",
  home = "Georgia",
  away = "Auburn",
  homeConf = "SEC",
  awayConf = "SEC",
  spread = "-19.5",
} = {}) {
  const values = {
    id,
    start_date: "2026-10-17 19:30:00",
    season: "2026",
    season_type: "regular",
    week,
    neutral_site: "False",
    home_team: home,
    home_conference: homeConf,
    away_team: away,
    away_conference: awayConf,
    spread,
    ...featureDefaults,
  };
  return CFB_TIER3_COLUMN_NAMES.map((c) => values[c]).join(",");
}
const csv = (items = [syntheticRow()]) => CFB_TIER3_COLUMN_NAMES.join(",") + "\n" + items.join("\n") + "\n";

test("frozen Tier 3 registry preserves exact 83-column Week 7 golden header", () => {
  const reg = cfbTier3FeatureRegistry();
  assert.equal(reg.columnCount, 83);
  assert.equal(reg.featureColumns.length, 72);
  assert.equal(reg.marketColumns.length, 1);
  assert.equal(reg.metaColumns.length, 10);
  assert.equal(reg.schemaVersion, CFB_TIER3_SCHEMA_VERSION);
  assert.equal(reg.headerSha256, CFB_TIER3_HEADER_SHA256);
  assert.deepEqual(assertCfbTier3Header(CFB_TIER3_COLUMN_NAMES).headerSha256, CFB_TIER3_HEADER_SHA256);
  const drift = diffCfbTier3Header([...CFB_TIER3_COLUMN_NAMES.slice(0, 82), "extra_col"]);
  assert.equal(drift.orderOk, false);
  assert.ok(drift.unexpected.includes("extra_col"));
});

test("Tier 3 validates weekly CSV against frozen schema and isolates opening spread", async () => {
  const v = await parseCfbTier3WeeklyCsv(csv(), {
    receivedAt: "2026-10-15T07:00:00Z",
    filename: "training_data_2026_week07.csv",
  });
  assert.equal(v.rowCount, 1);
  assert.equal(v.featureCount, 72);
  assert.equal(v.columnCount, 83);
  assert.equal(v.schemaVersion, CFB_TIER3_SCHEMA_VERSION);
  assert.equal(v.headerSha256, CFB_TIER3_HEADER_SHA256);
  assert.equal(v.games[0].openingSpread, -19.5);
  assert.ok(Object.hasOwn(v.games[0].features, "home_adjusted_epa"));
  assert.ok(!Object.hasOwn(v.games[0].features, "spread"));
  assert.equal(v.providerPublishedAt, null);
  assert.equal(v.games[0].pointInTimeStatus, "source_feature_cutoff_unverified");
  assert.equal(v.canAuthorizeWager, false);
  assert.equal(v.canInfluenceProjection, false);
  assert.equal(v.games[0].authority, "research_only");
  assert.equal(v.games[0].identityStatus, "matched");
  assert.ok(v.games[0].homeCanonicalId);
  assert.ok(v.games[0].awayCanonicalId);
});

test("Tier 3 snapshot id stable and duplicates or mixed weeks rejected", async () => {
  const a = await parseCfbTier3WeeklyCsv(csv());
  const b = await parseCfbTier3WeeklyCsv(csv());
  assert.equal(a.sourceSha256, b.sourceSha256);
  assert.equal(a.snapshotId, b.snapshotId);
  await assert.rejects(parseCfbTier3WeeklyCsv(csv([syntheticRow(), syntheticRow()])), /DUPLICATE/);
  await assert.rejects(
    parseCfbTier3WeeklyCsv(csv([syntheticRow(), syntheticRow({ id: "401752874", week: "8" })])),
    /MIXED_SNAPSHOT/
  );
});

test("Tier 3 blocks outcome targets, schema drift, and nonnumeric features", async () => {
  const badHeader = csv().replace("home_adjusted_epa", "winner");
  await assert.rejects(parseCfbTier3WeeklyCsv(badHeader), /TARGET_LEAKAGE|SCHEMA_HEADER_MISMATCH/);
  const shortHeader = CFB_TIER3_COLUMN_NAMES.slice(0, 20).join(",") + "\n" + "1,2,3\n";
  await assert.rejects(parseCfbTier3WeeklyCsv(shortHeader), /SCHEMA_COLUMN_COUNT|CSV width mismatch/);
  const mutated = csv().replace(",0,", ",bad,");
  // First numeric feature slot may not match that naive replace; force one known feature.
  const cols = CFB_TIER3_COLUMN_NAMES.join(",");
  const badRow = syntheticRow().split(",");
  const idx = CFB_TIER3_COLUMN_NAMES.indexOf("home_adjusted_epa");
  badRow[idx] = "not-a-number";
  await assert.rejects(parseCfbTier3WeeklyCsv(cols + "\n" + badRow.join(",") + "\n"), /NON_NUMERIC_FEATURE/);
  assert.ok(mutated); // keep linter quiet if unused after rewrite
});

test("ambiguous Miami alone fails closed; qualified Miami maps", async () => {
  const ambiguous = await parseCfbTier3WeeklyCsv(
    csv([syntheticRow({ id: "401752875", home: "Miami", away: "Clemson", homeConf: "ACC", awayConf: "ACC" })])
  );
  assert.ok(["partial_match", "unresolved"].includes(ambiguous.games[0].identityStatus));
  const qualified = await parseCfbTier3WeeklyCsv(
    csv([
      syntheticRow({
        id: "401752876",
        home: "Miami (FL)",
        away: "Clemson",
        homeConf: "ACC",
        awayConf: "ACC",
      }),
    ])
  );
  assert.ok(["matched", "partial_match"].includes(qualified.games[0].identityStatus));
});

test("private R2 + D1 write without any network HTTP or model promotion", async () => {
  const history = [];
  const saved = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...params) {
          return { sql, params };
        },
      };
    },
    async batch(stmts) {
      history.push(...stmts);
      return [{ meta: { changes: 1 } }];
    },
  };
  const ARCHIVE = {
    async put(key, raw) {
      saved.push({ key, raw });
    },
  };
  const input = csv();
  const snapshot = await parseCfbTier3WeeklyCsv(input);
  const res = await saveCfbTier3WeeklySnapshot({ TIER3_DB: DB, ARCHIVE }, snapshot, input);
  assert.equal(res.ok, true);
  assert.equal(res.networkCalls, 0);
  assert.equal(history.length, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].raw, input);
  assert.match(saved[0].key, /licensed\/cfbd\/tier3/);
  assert.equal(res.canAuthorizeWager, false);
  assert.equal(res.schemaVersion, CFB_TIER3_SCHEMA_VERSION);
});

test("operator route denies missing or incorrect harvest token before parsing", async () => {
  for (const headers of [{}, { "x-harvest-secret": "bad" }]) {
    const req = new Request("https://fbis.example/api/college-tier3", {
      method: "POST",
      headers: { "content-type": "text/csv", ...headers },
      body: csv(),
    });
    const res = await onRequestPost({ request: req, env: { HARVEST_SECRET: "correct" } });
    assert.equal(res.status, 401);
  }
  const list = await onRequestGet({
    request: new Request("https://fbis.example/api/college-tier3"),
    env: { HARVEST_SECRET: "correct" },
  });
  assert.equal(list.status, 401);
});

test("uploaded Week 7 proprietary CSV validates offline when present locally", async () => {
  // Proprietary file is uploaded to the agent workspace only — never committed.
  const local =
    "/home/ubuntu/.cursor/projects/workspace/uploads/training_data_2026_week07_e5ca.csv";
  let raw;
  try {
    raw = readFileSync(local, "utf8");
  } catch {
    return; // skip when file is absent (CI)
  }
  const v = await parseCfbTier3WeeklyCsv(raw, {
    receivedAt: "2026-10-15T07:51:00Z",
    filename: "training_data_2026_week07.csv",
  });
  assert.equal(v.rowCount, 59);
  assert.equal(v.featureCount, 72);
  assert.equal(v.columnCount, 83);
  assert.equal(v.season, 2026);
  assert.equal(v.week, 7);
  assert.equal(v.headerSha256, CFB_TIER3_HEADER_SHA256);
  assert.equal(
    v.sourceSha256,
    "6f8f00e0b16742a8c71d7e65ec070b015d8baff15c4bff38536fb57e56118f72"
  );
  assert.equal(v.canAuthorizeWager, false);
  assert.ok(v.identityCounts.matched + (v.identityCounts.partial_match || 0) + (v.identityCounts.unresolved || 0) === 59);
});
