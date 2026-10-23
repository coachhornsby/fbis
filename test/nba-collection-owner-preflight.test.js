import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveNbaResearchOwnerDb } from "../functions/lib/nbaResearchOwnerDb.js";
import { collectBoards } from "../functions/lib/projLedger.js";

const source = readFileSync(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
const primary = { prepare() { throw new Error("PRIMARY_NBA_PRODUCT_WRITE"); } };
const shard = { prepare() { return { bind() { return this; }, all: async () => ({ results: [] }) }; } };
const base = { DB: primary, NBA_DB: shard, SPORT_DB_MODE_NBA: "sport",
  SPORT_DB_STRICT_NBA: "1", SPORT_DB_LEDGER_READY_NBA: "1" };

test("NBA collection ownership preflight happens before any sport-specific collection loop", () => {
  assert.match(source, /import \{ resolveNbaResearchOwnerDb \} from "\.\/nbaResearchOwnerDb\.js"/);
  const entry = source.indexOf("export async function collectBoards(");
  const preflight = source.indexOf('if (sportList.includes("nba"))', entry);
  const resolver = source.indexOf("await resolveNbaResearchOwnerDb(env)", preflight);
  const failClosed = source.indexOf('NBA_COLLECTION_OWNER_UNAVAILABLE:', resolver);
  const verifiedEnv = source.indexOf("env = owner.env;", failClosed);
  const loop = source.indexOf("for (const sport of sportList)", verifiedEnv);
  assert.ok(entry >= 0 && preflight > entry && resolver > preflight &&
    failClosed > resolver && verifiedEnv > failClosed && loop > verifiedEnv);
});

test("unapproved NBA sport mode denies collection ownership without PRIMARY fallback", async () => {
  const denied = await resolveNbaResearchOwnerDb(base);
  assert.equal(denied.ok, false);
  assert.equal(denied.db, null);
  const revokedCache = await resolveNbaResearchOwnerDb({
    ...base, SPORT_CUTOVER_RECEIPT_NBA: "stale",
    __fbisCutoverApprovals: new Map([["nba:stale", { status: "APPROVED" }]]),
  });
  assert.equal(revokedCache.ok, false);
  assert.equal(revokedCache.db, null);
});

test("NBA shadow collection keeps PRIMARY authoritative and never gains wagering authority", async () => {
  const owner = await resolveNbaResearchOwnerDb({ ...base, SPORT_DB_MODE_NBA: "shadow" });
  assert.equal(owner.ok, true);
  assert.equal(owner.db, primary);
  assert.equal(owner.canAuthorizeWager, false);
});

test("NBA sport collection refuses invalid authority before requesting a slate", async () => {
  let builders = 0;
  const result = await collectBoards({
    ...base,
    SPORT_CUTOVER_RECEIPT_NBA: "unapproved",
    CORE_DB: { prepare() { return { bind() { return this; }, all: async () => ({ results: [] }) }; } },
  }, {
    sport: "nba",
    odds: "cache",
    buildSlateFn: async () => { builders++; throw new Error("BUILDER_MUST_NOT_RUN"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(builders, 0);
  assert.ok(result.errors.some(e => String(e).includes("NBA_COLLECTION_OWNER_UNAVAILABLE")));
});
