import test from "node:test";
import assert from "node:assert/strict";
import {
  serializeCoalesceMemory,
  hydrateCoalesceMemory,
} from "../services/polymarket-us-stream/historyRecovery.mjs";

test("coalesce memory survives serialize/hydrate for DO storage", () => {
  const mem = new Map([
    ["nhl|e1|moneyline|home", { contract_price: 0.55, collected_at: "2026-10-20T14:00:00Z" }],
    ["nba|e2|moneyline|away", { contract_price: 0.61, collected_at: "2026-10-20T14:01:00Z" }],
  ]);
  const serialized = serializeCoalesceMemory(mem);
  assert.equal(serialized.length, 2);
  const restored = hydrateCoalesceMemory(serialized);
  assert.equal(restored.size, 2);
  assert.equal(restored.get("nhl|e1|moneyline|home").contract_price, 0.55);
  assert.equal(restored.get("nba|e2|moneyline|away").collected_at, "2026-10-20T14:01:00Z");
});

test("serializeCoalesceMemory caps entries to bound DO storage", () => {
  const mem = new Map();
  for (let i = 0; i < 100; i += 1) mem.set(`k${i}`, { contract_price: i / 100, collected_at: "2026-10-20T14:00:00Z" });
  const capped = serializeCoalesceMemory(mem, 10);
  assert.equal(capped.length, 10);
});
