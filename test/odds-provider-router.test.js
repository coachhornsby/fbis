import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasUsableMarketSummary, providerMarketAsOf } from "../functions/lib/parlay.js";
import {
  ODDS_PROVIDER_ORDER,
  canQualifyFromOddsResolution,
  isFreshComplete,
  planOddsSecretSync,
  providerConfigured,
  resolveOddsProviders,
  shouldSyncPagesSecret,
} from "../functions/lib/oddsProviderRouter.js";
import {
  shouldPutPagesSecret,
  syncPagesSecretsSkipEmpty,
} from "../scripts/lib/pagesSecretSync.js";

function okResult(provider, events, extra = {}) {
  return {
    provider,
    ok: true,
    complete: true,
    events,
    asOf: extra.asOf || new Date().toISOString(),
    quotaRemaining: extra.quotaRemaining ?? 100,
    meta: extra.meta || {},
    ...extra,
  };
}

describe("market completeness", () => {
  it("does not turn a request receipt into a bookmaker quote clock", () => {
    const events = [{home_team:"Home",away_team:"Away",bookmakers:[{
      key:"pinnacle",title:"Pinnacle",last_update:"2026-10-12T05:55:00Z",
      markets:[{key:"h2h",outcomes:[{name:"Home",price:-120},{name:"Away",price:105}]}],
    }]}];
    assert.equal(providerMarketAsOf(events,"nfl","2026-10-12T05:59:00Z"),"2026-10-12T05:55:00.000Z");
    assert.equal(providerMarketAsOf(events,"nfl","2024-10-12T06:00:00Z"),"2024-10-12T06:00:00.000Z");
    const noSource=structuredClone(events);delete noSource[0].bookmakers[0].last_update;
    assert.equal(providerMarketAsOf(noSource,"nfl"),null);
    assert.equal(providerMarketAsOf([],"nfl"),null);
  });

  it("rejects event shells with no usable prices", () => {
    assert.equal(hasUsableMarketSummary({ homeMl: null, awayMl: null, spread: null, total: null }), false);
    assert.equal(hasUsableMarketSummary({ homeMl: -120, awayMl: 105 }), true);
    assert.equal(
      hasUsableMarketSummary({ spread: -4.5, spreadPrice: -110, pinSpreadHomePrice: -110, pinSpreadAwayPrice: -110 }),
      true
    );
    assert.equal(
      hasUsableMarketSummary({ total: 221.5, totalPrice: -108, pinOverPrice: -108, pinUnderPrice: -112 }),
      true
    );
  });
});

describe("owner-approved odds provider router", () => {
  it("uses PinnOdds only and preserves its original source clock",async()=>{
    assert.deepEqual([...ODDS_PROVIDER_ORDER],["pinnodds"]);
    const asOf=new Date().toISOString();
    const r=await resolveOddsProviders({configured:providerConfigured({pinnoddsApiKey:"test-only"}),
      fetchers:{pinnodds:async()=>okResult("pinnodds",[{id:1}],{asOf})}});
    assert.equal(r.provider,"pinnodds");assert.equal(r.asOf,asOf);
    assert.equal(canQualifyFromOddsResolution(r),true);
  });
  it("fails closed for absent, incomplete, stale, future or quota-reserved PinnOdds data",async()=>{
    const nowMs=Date.parse("2026-11-06T13:00:00Z");
    for(const extra of [
      {ok:false}, {incomplete:true}, {asOf:"2026-11-06T12:00:00Z"},
      {asOf:"2026-11-06T13:01:00Z"}, {quotaRemaining:0}
    ]) {
      const r=await resolveOddsProviders({nowMs,configured:{pinnodds:true},quotaReserve:{pinnodds:1},
        fetchers:{pinnodds:async()=>okResult("pinnodds",[{id:1}],{asOf:"2026-11-06T12:59:00Z",...extra})}});
      assert.equal(r.failClosed,true);
    }
  });
  it("does not qualify old cached fallback resolutions",()=>{
    for(const provider of ["parlay","theodds","sharpapi","therundown"])
      assert.equal(canQualifyFromOddsResolution({ok:true,failClosed:false,provider,events:[{id:1}]}),false);
  });
});

describe("Pages odds-secret sync",()=>{
  it("plans only PinnOdds and skips empty secrets",()=>{
    assert.deepEqual(planOddsSecretSync({THEODDS_API_KEY:"test-only"}).writes,[]);
    assert.deepEqual(planOddsSecretSync({PINNODDS_API_KEY:"test-only"}).writes,["PINNODDS_API_KEY"]);
    assert.equal(shouldSyncPagesSecret("").write,false);
    assert.equal(shouldPutPagesSecret(""),false);
  });
  it("skips retired credentials even when nonempty",async()=>{
    const puts=[];
    const r=await syncPagesSecretsSkipEmpty({THEODDS_API_KEY:"test-only",APIFY_TOKEN:"test-only",
      CFBD_API_KEY:"test-only",CBBD_API_KEY:""},(name)=>puts.push(name));
    assert.deepEqual(puts,["CFBD_API_KEY"]);assert.equal(r.skipped.length,3);
  });
});
