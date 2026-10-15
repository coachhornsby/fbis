import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithCfbBackoff } from "../functions/lib/cfbProviderBackoff.js";
import { loadCfbDeepFeatures } from "../functions/lib/cfbDeepFeed.js";
import { loadCfbCurrentForm } from "../functions/lib/cfbd.js";
import { resetCacheMem } from "../functions/lib/cache.js";

const url = (path) => `https://api.collegefootballdata.com${path}`;
const key = "offline-test-key";

test("429 stops a burst of queued provider calls and persists cooldown", async () => {
  resetCacheMem();
  let networkCalls = 0;
  const transport = async () => {
    networkCalls++;
    return new Response(JSON.stringify({ message: "rate limited" }), {
      status: 429, headers: { "Retry-After": "120" },
    });
  };
  const calls = ["/ppa/teams?year=2026", "/stats/season/advanced?year=2026", "/games?year=2026"]
    .map(path => fetchWithCfbBackoff(url(path), { headers: { Authorization: `Bearer ${key}` } }, {}, transport));
  const responses = await Promise.all(calls);
  assert.equal(networkCalls, 1, "requests queued behind a 429 must not reach the provider");
  assert.deepEqual(responses.map(r => r.status), [429, 429, 429]);
  assert.equal(responses.filter(r => r.headers.get("X-FBIS-Cooldown") === "true").length, 2);
  const next = await fetchWithCfbBackoff(url("/talent?year=2026"), {}, {}, transport);
  assert.equal(next.status, 429);
  assert.equal(networkCalls, 1);
});

test("concurrent identical CFBD reads only hit provider once", async () => {
  resetCacheMem();
  let networkCalls = 0;
  const transport = async () => {
    networkCalls++;
    await Promise.resolve();
    return Response.json([{ team: "Alabama" }]);
  };
  const a = fetchWithCfbBackoff(url("/ratings/sp?year=2026"), {}, {}, transport);
  const b = fetchWithCfbBackoff(url("/ratings/sp?year=2026"), {}, {}, transport);
  const responses = await Promise.all([a, b]);
  assert.equal(networkCalls, 1);
  assert.equal((await responses[0].json())[0].team, "Alabama");
  assert.equal((await responses[1].json())[0].team, "Alabama");
});

test("cache-only miss never sends a CFBD request", async () => {
  resetCacheMem();
  let calls = 0;
  const fetchFn = async () => { calls++; throw Error("unexpected provider call"); };
  const env = { CFBD_API_KEY: key, cfbdCacheOnly: true };
  const now = Date.parse("2026-10-15T12:30:00.000Z");
  const deep = await loadCfbDeepFeatures(env, { fetchFn, now });
  const form = await loadCfbCurrentForm(env, { fetchFn, now });
  assert.equal(deep.meta.cacheOnly, true);
  assert.equal(form.meta?.configured, true);
  assert.equal(calls, 0);
});

test("repeated deep-feature refresh reuses cached result within its TTL", async () => {
  resetCacheMem();
  let calls = 0;
  const fetchFn = async () => { calls++; return Response.json([]); };
  const env = { CFBD_API_KEY: key };
  const now = Date.parse("2026-10-15T12:30:00.000Z");
  const first = await loadCfbDeepFeatures(env, { fetchFn, now });
  const afterFirst = calls;
  const second = await loadCfbDeepFeatures(env, { fetchFn, now });
  assert.ok(afterFirst >= 3 && afterFirst <= 4);
  assert.equal(calls, afterFirst, "second invocation should not refetch within TTL");
  assert.deepEqual(second.meta, first.meta);
});
