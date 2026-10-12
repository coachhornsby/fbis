import test from "node:test";
import assert from "node:assert/strict";
import { fetchParlayOdds } from "../functions/lib/parlay.js";
import { resetCacheMem } from "../functions/lib/cache.js";

test("MLB free bookmaker date cache cannot borrow next-day rolling fixtures", async () => {
  resetCacheMem();
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async (url) => {
    requests++;
    const market=new URL(url).searchParams.get("market");
    const row=(id,at,selection,odds)=>({
      event_id:id, home_team:"Milwaukee Brewers",away_team:"Los Angeles Dodgers",
      event_start_time:at,sportsbook:"draftkings",
      // Real free tiers sometimes omit original bookmaker quote timestamps.
      market_type:"moneyline",selection_type:selection,odds_american:odds,
    });
    const rows=market==="moneyline" ? [
      row("mlb-11","2026-10-12T00:00:00Z","home",-110),
      row("mlb-11","2026-10-12T00:00:00Z","away",100),
      row("mlb-12","2026-10-13T00:00:00Z","home",-120),
      row("mlb-12","2026-10-13T00:00:00Z","away",110),
    ] : [];
    return new Response(JSON.stringify({data:rows}),{status:200,headers:{"content-type":"application/json"}});
  };
  try {
    const opts={cacheOnly:true,strictCacheOnly:false,backupApiKey:null,
      sharpApiKey:"synthetic-key",theRundownApiKey:null};
    const first=await fetchParlayOdds("mlb",null,null,{...opts,date:"2026-10-11"});
    assert.equal(first.events.length,1);
    assert.equal(first.events[0].parlayId,"mlb-11");
    const calls=requests;
    assert.equal(first.meta.observedAt,null);
    const repeat=await fetchParlayOdds("mlb",null,null,{...opts,date:"2026-10-11"});
    assert.equal(repeat.events.length,1);
    assert.equal(repeat.meta.freshnessStatus,"source-timestamp-unverified");
    assert.equal(requests,calls,"receipt-bounded unverified cache must avoid repeated provider charges");
    const second=await fetchParlayOdds("mlb",null,null,{...opts,date:"2026-10-12"});
    assert.equal(second.events.length,1);
    assert.equal(second.events[0].parlayId,"mlb-12");
    assert.ok(requests>calls,"different game date must invoke fresh provider path");
  } finally {
    globalThis.fetch=previous;
    resetCacheMem();
  }
});
