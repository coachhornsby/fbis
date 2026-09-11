import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unwrapPalResponse } from "../functions/lib/ballparkpal.js";
import { classifyCheckpoint, pickCanonical, materiallyChanged, snapshotKey } from "../functions/lib/checkpoints.js";
import { accuracyOf, freezeFromGame, collectBoards, harvestAll } from "../functions/lib/projLedger.js";
import { actionAcceptsJob } from "../functions/lib/jobs.js";
import { seriesStats, buildAccuracyPack } from "../functions/lib/accuracyReport.js";
import { attachFlatProps, attachPeriodF5, fetchParlayOdds, summarizeParlayEvent } from "../functions/lib/parlay.js";
import { resetCacheMem } from "../functions/lib/cache.js";
import { todayCT } from "../functions/lib/slateEngine.js";
import { sharpRowsToEvents } from "../functions/lib/sharpApi.js";
import { theRundownEventsToParlay } from "../functions/lib/theRundown.js";

describe("Pal unwrap", () => {
  it("reads data.items so games are not dropped", () => {
    const { data, meta } = unwrapPalResponse({
      meta: { asOf: "2026-08-26T12:00:00Z", requestId: "abc" },
      data: { items: [{ gameId: 1 }, { gameId: 2 }] },
    });
    assert.equal(data.length, 2);
    assert.equal(meta.requestId, "abc");
  });
});

describe("checkpoints", () => {
  it("keeps model-version snapshots distinct without rewriting history", () => {
    assert.notEqual(
      snapshotKey("2026-09-03", "game-1", "MORNING", "FBIS-v1.3"),
      snapshotKey("2026-09-03", "game-1", "MORNING", "FBIS-v1.4")
    );
  });
  it("classifies close inside 45 minutes", () => {
    const start = new Date(Date.now() + 20 * 60000).toISOString();
    assert.equal(classifyCheckpoint({ start }, Date.now()), "CLOSE");
  });

  it("prefers CLOSE over EARLY as canonical", () => {
    const rows = [
      { date: "2026-08-26", id: "1", checkpoint: "EARLY", frozenAt: "a" },
      { date: "2026-08-26", id: "1", checkpoint: "CLOSE", frozenAt: "b" },
    ];
    assert.equal(pickCanonical(rows)[0].checkpoint, "CLOSE");
  });

  it("detects material projection changes", () => {
    assert.equal(materiallyChanged({ projHome: 4.7 }, { projHome: 5.2 }), true);
    assert.equal(materiallyChanged({ projHome: 4.7 }, { projHome: 4.7 }), false);
  });
});

describe("accuracy", () => {
  it("keeps calibration for home p below 50%", () => {
    const row = {
      projHome: 4,
      projAway: 5,
      actualHome: 3,
      actualAway: 6,
      actualTotal: 9,
      pHomeFinal: 0.42,
      impliedHome: 0.45,
    };
    const acc = accuracyOf([row]);
    assert.ok(acc.calibrationHome.some((b) => b.n === 1 && b.bucket.startsWith("40")));
    assert.ok(acc.calibration.some((b) => b.n === 1));
  });

  it("tracks score winner and probability winner separately", () => {
    const row = {
      projHome: 5.2,
      projAway: 3.8,
      actualHome: 6,
      actualAway: 4,
      actualTotal: 10,
      pHomeFinal: 0.42,
    };
    const acc = accuracyOf([row]);
    assert.equal(acc.winnerHitScore, 1);
    assert.equal(acc.winnerHitProb, 0);
  });

  it("reports within-X total accuracy", () => {
    const acc = accuracyOf([
      { projHome: 4.5, projAway: 4.2, actualHome: 5, actualAway: 4, actualTotal: 9 },
    ]);
    assert.equal(acc.withinTotal1, 1);
    assert.ok(acc.withinTotal05 != null);
  });

  it("does not treat zero bias as zero error", () => {
    const st = seriesStats(
      [
        { actual: 10, proj: 6 },
        { actual: 6, proj: 10 },
      ],
      true
    );
    assert.equal(st.bias, 0);
    assert.equal(st.mae, 4);
    assert.ok(st.medianAbs > 0);
  });

  it("compares Pal, proprietary, and ensemble", () => {
    const pack = buildAccuracyPack(
      [
        {
          projHome: 4.8,
          projAway: 3.9,
          palHome: 5.1,
          palAway: 3.6,
          actualHome: 5,
          actualAway: 4,
          pHomeFinal: 0.58,
          pScore: 0.57,
          pPal: 0.6,
          pMarket: 0.52,
        },
      ],
      { model: "ensemble", perGame: true }
    );
    const pal = pack.models.find((m) => m.key === "pal");
    const ens = pack.models.find((m) => m.key === "ensemble");
    assert.equal(pal.n, 1);
    assert.equal(ens.n, 1);
    assert.ok(pack.table.rows.some((r) => r.key === "total" && r.n === 1));
  });

  it("freezes Pal runs beside Savant", () => {
    const frozen = freezeFromGame("2026-08-26", {
      id: "9",
      sport: "mlb",
      home: { name: "Mets", abbr: "NYM" },
      away: { name: "Braves", abbr: "ATL" },
      venue: "Citi Field",
      homeSp: { name: "Kodai Senga" },
      model: { projHome: 4.1, projAway: 4.8, palHome: 3.9, palAway: 5.2, pHomeFinal: 0.44, layers: { pal: 0.41, score: 0.46 } },
      bpp: { homeRuns: 3.9, awayRuns: 5.2, lineupsOfficial: true, asOf: "now" },
    });
    assert.equal(frozen.palHome, 3.9);
    assert.equal(frozen.projHome, 4.1);
    assert.equal(frozen.park, "Citi Field");
    assert.equal(frozen.checkpoint, "LINEUP_CONFIRMED");
  });
});

describe("Parlay collect budget", () => {
  it("attaches complete flattened sportsbook player props without treating them as model probabilities", () => {
    const [event] = attachFlatProps([{ id: "e1", home_team: "Yankees", away_team: "Astros" }], [{
      event_id: "e1", player_name: "Aaron Judge", market_key: "player_total_bases", market_label: "Total Bases",
      line: 1.5, over_price: -105, under_price: -115, source: "fanduel", source_title: "FanDuel", snapshot_time: "2026-08-27T15:00:00Z",
    }]);
    assert.equal(event.playerProps.length, 1);
    assert.equal(event.playerProps[0].playerName, "Aaron Judge");
    assert.equal(event.playerProps[0].overPrice, -105);
    assert.equal(event.playerProps[0].underPrice, -115);
    assert.equal(event.playerProps[0].probability, undefined);
  });
  it("accepts the documented flattened prop field names", () => {
    const [event] = attachFlatProps([{ id: "canonical-1", home_team: "Chicago Cubs", away_team: "Cincinnati Reds" }], [{
      canonical_event_id: "canonical-1", player: "Pete Crow-Armstrong", market: "player_total_bases",
      line: 1.5, over_price: 105, under_price: -125, bookmaker: "fanduel", bookmaker_title: "FanDuel",
      last_update: "2026-08-28T15:00:00Z",
    }]);
    assert.equal(event.playerProps.length, 1);
    assert.equal(event.playerProps[0].playerName, "Pete Crow-Armstrong");
    assert.equal(event.playerProps[0].marketKey, "player_total_bases");
    assert.equal(event.playerProps[0].bookmaker, "FanDuel");
  });
  it("packs documented F5 period-market rows into a priced sportsbook market", () => {
    const [event] = attachPeriodF5([{ id: "e1", home_team: "Chicago Cubs", away_team: "Cincinnati Reds", bookmakers: [] }], [
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "h2h", side: "home", price: -115 },
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "h2h", side: "away", price: 105 },
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "spread", side: "home", line: -0.5, price: 120 },
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "spread", side: "away", line: 0.5, price: -140 },
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "total", side: "over", line: 4.5, price: -105 },
      { home_team: "Chicago Cubs", away_team: "Cincinnati Reds", period_key: "F5", source: "pinnacle", market: "total", side: "under", line: 4.5, price: -115 },
    ]);
    const packed = summarizeParlayEvent(event, "mlb").f5;
    assert.equal(packed.homeMl, -115);
    assert.equal(packed.spread, -0.5);
    assert.equal(packed.total, 4.5);
    assert.equal(packed.book, "pinnacle");
  });
  it("skips the network on cache-only collects", async () => {
    const r = await fetchParlayOdds("mlb", "fake-key", null, { cacheOnly: true });
    assert.equal(r.meta.skipped, true);
    assert.equal(r.events.length, 0);
    assert.equal(r.meta.propFeedStatus, "skipped");
  });

  it("reuses stale MLB props when live prop feed errors", async () => {
    resetCacheMem();
    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    let nowMs = Date.parse("2026-08-28T16:00:00Z");
    Date.now = () => nowMs;
    let round = 1;
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("/v1/sports/baseball_mlb/odds")) {
        if (round === 1) {
          return new Response(JSON.stringify([{
            id: "evt-1",
            home_team: "Chicago Cubs",
            away_team: "Pittsburgh Pirates",
            commence_time: "2026-08-28T23:00:00Z",
            bookmakers: [],
          }]), { status: 200 });
        }
        return new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
      }
      if (s.includes("/v1/sports/baseball_mlb/props")) {
        if (round === 1) {
          return new Response(JSON.stringify([{
            event_id: "evt-1",
            home_team: "Chicago Cubs",
            away_team: "Pittsburgh Pirates",
            player_name: "Dansby Swanson",
            market_key: "player_hits",
            line: 0.5,
            over_price: -115,
            under_price: -105,
            source: "fanduel",
          }]), { status: 200 });
        }
        return new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
      }
      if (s.includes("bookmakers=kalshi")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (s.includes("/live/period_markets")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      const seeded = await fetchParlayOdds("mlb", "fake-key", null);
      assert.equal(seeded.meta.propFeedStatus, "available");
      nowMs += 7 * 60 * 60 * 1000;
      round = 2;
      const stale = await fetchParlayOdds("mlb", "fake-key", null);
      assert.equal(stale.meta.propFeedStatus, "stale");
      assert.ok(stale.events.length > 0);
      assert.ok((stale.events[0].playerProps || []).length > 0);
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
      resetCacheMem();
    }
  });

  it("falls back to TheOdds game lines when Parlay credits are exhausted", async () => {
    resetCacheMem();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("/v1/sports/baseball_mlb/odds")) {
        return new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
      }
      if (s.includes("api.the-odds-api.com/v4/sports/baseball_mlb/odds")) {
        return new Response(JSON.stringify([{
          id: "evt-99",
          home_team: "Chicago Cubs",
          away_team: "Pittsburgh Pirates",
          commence_time: "2026-08-28T23:00:00Z",
          bookmakers: [
            {
              key: "pinnacle",
              title: "Pinnacle",
              markets: [
                { key: "h2h", outcomes: [{ name: "Chicago Cubs", price: -130 }, { name: "Pittsburgh Pirates", price: 115 }] },
                { key: "spreads", outcomes: [{ name: "Chicago Cubs", price: -110, point: -1.5 }, { name: "Pittsburgh Pirates", price: -110, point: 1.5 }] },
                { key: "totals", outcomes: [{ name: "Over", price: -108, point: 8.5 }, { name: "Under", price: -112, point: 8.5 }] },
              ],
            },
          ],
        }]), { status: 200 });
      }
      if (s.includes("bookmakers=kalshi")) return new Response(JSON.stringify([]), { status: 200 });
      if (s.includes("/live/period_markets")) return new Response(JSON.stringify([]), { status: 200 });
      if (s.includes("/v1/sports/baseball_mlb/props")) return new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      const out = await fetchParlayOdds("mlb", "parlay-key", null, { backupApiKey: "the-odds-key" });
      assert.equal(out.meta.source, "theodds-backup");
      assert.ok(out.events.length >= 1);
      assert.equal(out.events[0].homeMl, -130);
      assert.equal(out.events[0].total, 8.5);
    } finally {
      globalThis.fetch = realFetch;
      resetCacheMem();
    }
  });

  it("keeps successful TheOdds/SharpAPI/TheRundown fallback attribution after cache round-trip", async () => {
    const { writeCache } = await import("../functions/lib/cache.js");
    const { isUnusableCachedOddsMeta } = await import("../functions/lib/marketLineage.js");
    const observedAt = new Date().toISOString();
    const cases = [
      { provider: "theodds", source: "theodds-backup", opts: { backupApiKey: "odds-key" } },
      { provider: "sharpapi", source: "sharpapi-soft-backup", opts: { sharpApiKey: "sharp-key" } },
      { provider: "therundown", source: "therundown-soft-backup", opts: { theRundownApiKey: "rundown-key" } },
    ];
    for (const c of cases) {
      resetCacheMem();
      const realFetch = globalThis.fetch;
      let liveHits = 0;
      globalThis.fetch = async () => {
        liveHits += 1;
        return new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
      };
      try {
        await writeCache(
          "v7:odds-props-v3:baseball_mlb",
          {
            events: [
              {
                homeTeam: "Chicago Cubs",
                awayTeam: "Pittsburgh Pirates",
                homeMl: -130,
                awayMl: 115,
                spread: -1.5,
                total: 8.5,
              },
            ],
            meta: {
              source: c.source,
              provider: c.provider,
              games: 1,
              pinGames: c.provider === "theodds" ? 1 : 0,
              parlayError: 'Parlay 403: {"detail":{"error":"OUT_OF_USAGE_CREDITS"}}',
              observedAt,
              asOf: observedAt,
              failClosed: false,
            },
          },
          null,
          15 * 60 * 1000
        );
        const out = await fetchParlayOdds("mlb", "parlay-key", null, c.opts);
        assert.equal(out.meta.source, c.source, `${c.provider} source must survive cache read`);
        assert.equal(out.meta.provider, c.provider);
        assert.equal(out.meta.cached, true);
        assert.match(String(out.meta.parlayError || ""), /OUT_OF_USAGE_CREDITS/);
        assert.equal(isUnusableCachedOddsMeta(out.meta), false);
        assert.equal(liveHits, 0, `${c.provider} must serve from cache without re-hitting providers`);
        assert.ok(out.events.length >= 1);
      } finally {
        globalThis.fetch = realFetch;
        resetCacheMem();
      }
    }
  });

  it("heals already-poisoned cached fallback source labels using provider identity", async () => {
    const { writeCache } = await import("../functions/lib/cache.js");
    resetCacheMem();
    const realFetch = globalThis.fetch;
    const observedAt = new Date().toISOString();
    globalThis.fetch = async () => new Response("[]", { status: 200 });
    try {
      await writeCache(
        "v7:odds-props-v3:baseball_mlb",
        {
          events: [{ homeTeam: "Detroit Tigers", awayTeam: "Minnesota Twins", homeMl: -120, awayMl: 102 }],
          meta: {
            // Poisoned label that older cache-read rewrite produced in health/response paths.
            source: "parlay-credit-exhausted",
            provider: "sharpapi",
            games: 1,
            pinGames: 0,
            parlayError: "OUT_OF_USAGE_CREDITS",
            observedAt,
            asOf: observedAt,
            failClosed: false,
          },
        },
        null,
        15 * 60 * 1000
      );
      const out = await fetchParlayOdds("mlb", "parlay-key", null, { sharpApiKey: "sharp-key" });
      assert.equal(out.meta.source, "sharpapi-soft-backup");
      assert.equal(out.meta.provider, "sharpapi");
      assert.match(String(out.meta.parlayError || ""), /OUT_OF_USAGE_CREDITS/);
      assert.equal(out.meta.cached, true);
      assert.ok(out.events.length >= 1);
    } finally {
      globalThis.fetch = realFetch;
      resetCacheMem();
    }
  });

  it("keeps Parlay success unchanged and fail-closes when primary + backups all fail", async () => {
    resetCacheMem();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("parlay-api.com/v1/sports/baseball_mlb/odds")) {
        return new Response(
          JSON.stringify([
            {
              id: "evt-ok",
              home_team: "Chicago Cubs",
              away_team: "Pittsburgh Pirates",
              commence_time: "2026-08-28T23:00:00Z",
              bookmakers: [
                {
                  key: "pinnacle",
                  title: "Pinnacle",
                  markets: [
                    { key: "h2h", outcomes: [{ name: "Chicago Cubs", price: -140 }, { name: "Pittsburgh Pirates", price: 120 }] },
                    { key: "spreads", outcomes: [{ name: "Chicago Cubs", price: -110, point: -1.5 }, { name: "Pittsburgh Pirates", price: -110, point: 1.5 }] },
                    { key: "totals", outcomes: [{ name: "Over", price: -110, point: 8 }, { name: "Under", price: -110, point: 8 }] },
                  ],
                },
              ],
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      const ok = await fetchParlayOdds("mlb", "parlay-key", null);
      assert.equal(ok.meta.source, "parlay");
      assert.equal(ok.meta.provider, "parlay");
      assert.ok(ok.events.length >= 1);
    } finally {
      globalThis.fetch = realFetch;
      resetCacheMem();
    }

    globalThis.fetch = async () => new Response('{"detail":{"error":"OUT_OF_USAGE_CREDITS"}}', { status: 403 });
    try {
      const dead = await fetchParlayOdds("mlb", "parlay-key", null, {
        backupApiKey: "odds-key",
        sharpApiKey: "sharp-key",
        theRundownApiKey: "rundown-key",
      });
      assert.equal(dead.events.length, 0);
      assert.equal(dead.meta.source, "parlay-credit-exhausted-backup-failed");
      assert.ok(dead.meta.parlayError);
    } finally {
      globalThis.fetch = realFetch;
      resetCacheMem();
    }
  });

  it("maps SharpAPI soft books without populating pin fields", () => {
    const events = sharpRowsToEvents([
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "draftkings",
        market_type: "moneyline",
        selection_type: "home",
        selection: "Detroit Tigers",
        odds_american: -120,
        line: null,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "draftkings",
        market_type: "moneyline",
        selection_type: "away",
        selection: "Minnesota Twins",
        odds_american: 102,
        line: null,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "fanduel",
        market_type: "run_line",
        selection_type: "home",
        selection: "Detroit Tigers",
        odds_american: 180,
        line: -1.5,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "fanduel",
        market_type: "run_line",
        selection_type: "away",
        selection: "Minnesota Twins",
        odds_american: -235,
        line: 1.5,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "fanduel",
        market_type: "total_runs",
        selection_type: "over",
        selection: "Over",
        odds_american: -110,
        line: 8.5,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
      {
        event_id: "mlb-1",
        sport: "baseball",
        league: "mlb",
        sportsbook: "fanduel",
        market_type: "total_runs",
        selection_type: "under",
        selection: "Under",
        odds_american: -110,
        line: 8.5,
        event_start_time: "2026-09-09T17:10:00Z",
        home_team: "Detroit Tigers",
        away_team: "Minnesota Twins",
        is_live: false,
        is_main_line: true,
      },
    ], "mlb");
    const packed = summarizeParlayEvent(events[0], "mlb");
    assert.equal(packed.homeMl, -120);
    assert.equal(packed.spread, -1.5);
    assert.equal(packed.total, 8.5);
    assert.equal(packed.pinPresent, false);
    assert.equal(packed.pinHomeMl, null);
    assert.equal(packed.softSource, "sharpapi");
  });

  it("maps The Rundown soft books with full team names", () => {
    const [event] = theRundownEventsToParlay([{
      event_id: "tr-1",
      event_date: "2026-09-09T17:10:00Z",
      teams_normalized: [
        { is_away: true, is_home: false, name: "Minnesota", mascot: "Twins" },
        { is_away: false, is_home: true, name: "Detroit", mascot: "Tigers" },
      ],
      markets: [
        {
          market_id: 1,
          participants: [
            { name: "Detroit Tigers", lines: [{ prices: { "19": { price: -117, is_main_line: true } } }] },
            { name: "Minnesota Twins", lines: [{ prices: { "19": { price: -103, is_main_line: true } } }] },
          ],
        },
        {
          market_id: 2,
          participants: [
            { name: "Detroit Tigers", lines: [{ value: "+1.5", prices: { "19": { price: -200, is_main_line: true } } }] },
            { name: "Minnesota Twins", lines: [{ value: "-1.5", prices: { "19": { price: 164, is_main_line: true } } }] },
          ],
        },
        {
          market_id: 3,
          participants: [
            { name: "Over", lines: [{ value: "8.5", prices: { "22": { price: -110, is_main_line: true } } }] },
            { name: "Under", lines: [{ value: "8.5", prices: { "22": { price: -110, is_main_line: true } } }] },
          ],
        },
      ],
    }], "mlb");
    const packed = summarizeParlayEvent(event, "mlb");
    assert.equal(packed.homeTeam, "Detroit Tigers");
    assert.equal(packed.awayTeam, "Minnesota Twins");
    assert.equal(packed.homeMl, -117);
    assert.equal(packed.total, 8.5);
    assert.equal(packed.pinPresent, false);
    assert.equal(packed.softSource, "therundown");
  });

  it("uses SharpAPI cache-only backup when TheOdds is absent", async () => {
    resetCacheMem();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("api.sharpapi.io/api/v1/odds") && s.includes("market=moneyline")) {
        return new Response(JSON.stringify({
          data: [
            {
              event_id: "mlb-1",
              sportsbook: "draftkings",
              market_type: "moneyline",
              selection_type: "home",
              selection: "Detroit Tigers",
              odds_american: -120,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
            {
              event_id: "mlb-1",
              sportsbook: "draftkings",
              market_type: "moneyline",
              selection_type: "away",
              selection: "Minnesota Twins",
              odds_american: 102,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
          ],
        }), { status: 200, headers: { "X-Ratelimit-Remaining": "11", "X-Ratelimit-Limit": "12", "X-Tier": "free" } });
      }
      if (s.includes("api.sharpapi.io/api/v1/odds") && s.includes("market=run_line")) {
        return new Response(JSON.stringify({
          data: [
            {
              event_id: "mlb-1",
              sportsbook: "fanduel",
              market_type: "run_line",
              selection_type: "home",
              selection: "Detroit Tigers",
              odds_american: 180,
              line: -1.5,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
            {
              event_id: "mlb-1",
              sportsbook: "fanduel",
              market_type: "run_line",
              selection_type: "away",
              selection: "Minnesota Twins",
              odds_american: -235,
              line: 1.5,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
          ],
        }), { status: 200, headers: { "X-Ratelimit-Remaining": "10", "X-Ratelimit-Limit": "12", "X-Tier": "free" } });
      }
      if (s.includes("api.sharpapi.io/api/v1/odds") && s.includes("market=total_runs")) {
        return new Response(JSON.stringify({
          data: [
            {
              event_id: "mlb-1",
              sportsbook: "fanduel",
              market_type: "total_runs",
              selection_type: "over",
              selection: "Over",
              odds_american: -110,
              line: 8.5,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
            {
              event_id: "mlb-1",
              sportsbook: "fanduel",
              market_type: "total_runs",
              selection_type: "under",
              selection: "Under",
              odds_american: -110,
              line: 8.5,
              home_team: "Detroit Tigers",
              away_team: "Minnesota Twins",
              event_start_time: "2026-09-09T17:10:00Z",
              is_live: false,
              is_main_line: true,
            },
          ],
        }), { status: 200, headers: { "X-Ratelimit-Remaining": "9", "X-Ratelimit-Limit": "12", "X-Tier": "free" } });
      }
      throw new Error(`unexpected fetch ${s}`);
    };
    try {
      const out = await fetchParlayOdds("mlb", null, null, { cacheOnly: true, sharpApiKey: "sharp-key" });
      assert.equal(out.meta.source, "sharpapi-free-cacheonly");
      assert.ok(out.events.length >= 1);
      assert.equal(out.events[0].pinPresent, false);
      assert.equal(out.events[0].softSource, "sharpapi");
      assert.equal(out.events[0].homeMl, -120);
      assert.equal(out.events[0].spread, -1.5);
      assert.equal(out.events[0].total, 8.5);
    } finally {
      globalThis.fetch = realFetch;
      resetCacheMem();
    }
  });
});

describe("collect and harvest fail honestly", () => {
  function emptySlate(sport, date, extra = {}) {
    return {
      sport,
      date,
      games: extra.games || [],
      parlay: extra.parlay || { enabled: true },
      pal: { meta: { enabled: false } },
    };
  }

  it("does not stamp success when ESPN/scoreboard collection throws", async () => {
    const out = await collectBoards(
      {},
      {
        odds: "cache",
        buildSlateFn: async () => {
          throw new Error("ESPN 502");
        },
      }
    );
    assert.equal(out.status, "failed");
    assert.equal(out.ok, false);
    assert.equal(out.successful_at, null);
    assert.ok(out.errors.some((e) => /ESPN/.test(e)));
  });

  it("fails a full collect when Parlay errors", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "full",
        buildSlateFn: async (sport, date) => emptySlate(sport, date, { parlay: { error: "credits" } }),
      }
    );
    assert.notEqual(out.status, "success");
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => /Parlay/.test(e)));
  });

  it("fails when D1 is unbound", async () => {
    const out = await collectBoards(
      {},
      { odds: "cache", buildSlateFn: async (sport, date) => emptySlate(sport, date) }
    );
    assert.equal(out.status, "failed");
    assert.equal(out.d1.bound, false);
    assert.equal(out.successful_at, null);
  });

  it("fails required writes when D1 rejects snapshots", async () => {
    const env = pipelineDb({ rejectWrites: true });
    const out = await collectBoards(env, {
      odds: "cache",
      buildSlateFn: async (sport, date) =>
        emptySlate(sport, date, {
          games: [
            {
              id: "1",
              sport,
              start: new Date(Date.now() + 3600000).toISOString(),
              status: { live: false, completed: false },
              home: { abbr: "HOM", name: "Home" },
              away: { abbr: "AWY", name: "Away" },
              model: { projHome: 4, projAway: 4, pHomeFinal: 0.5, layers: {} },
            },
          ],
        }),
    });
    assert.notEqual(out.status, "success");
    assert.ok(out.snapshots_failed > 0 || out.errors.length);
  });

  it("marks one-sport failure as partial", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        buildSlateFn: async (sport, date) => {
          if (sport === "mlb") throw new Error("mlb down");
          return emptySlate(sport, date);
        },
      }
    );
    assert.equal(out.status, "partial");
    assert.equal(out.sports.filter((s) => !s.ok).length, 1);
    assert.equal(out.successful_at, null);
  });

  it("marks all-sport failure as failed", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        buildSlateFn: async () => {
          throw new Error("all down");
        },
      }
    );
    assert.equal(out.status, "failed");
  });

  it("can collect and harvest one sport without touching the others", async () => {
    const seen = [];
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        sport: "mlb",
        buildSlateFn: async (sport, date) => {
          seen.push(sport);
          return emptySlate(sport, date);
        },
      }
    );
    assert.deepEqual([...new Set(seen)], ["mlb"]);
    assert.equal(out.status, "success");
    assert.equal(out.sports.length, 1);
    assert.equal(out.sports[0].sport, "mlb");

    const harvested = [];
    const harvest = await harvestAll(1, { DB: pipelineDb().DB }, {
      sport: "mlb",
      fetchResultsFn: async (sport) => {
        harvested.push(sport);
        return [];
      },
    });
    assert.deepEqual([...new Set(harvested)], ["mlb"]);
    assert.equal(harvest.sport, "mlb");
    assert.equal(harvest.status, "success");
  });

  it("can collect one football date without the four-day window", async () => {
    const days = [];
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        sport: "cfb",
        dayOffset: 0,
        buildSlateFn: async (sport, date) => {
          days.push(date);
          return emptySlate(sport, date);
        },
      }
    );
    assert.equal(days.length, 1);
    assert.equal(out.status, "success");
  });

  it("idempotent rerun reports already-present snapshots", async () => {
    const env = pipelineDb();
    const slateFn = async (sport, date) =>
      emptySlate(sport, date, {
        games: [
          {
            id: "9",
            sport,
            start: new Date(Date.now() + 7200000).toISOString(),
            status: { live: false, completed: false },
            home: { abbr: "HOM", name: "Home" },
            away: { abbr: "AWY", name: "Away" },
            model: { projHome: 4.1, projAway: 3.9, pHomeFinal: 0.52, layers: {} },
          },
        ],
      });
    const first = await collectBoards(env, { odds: "cache", buildSlateFn: slateFn });
    const second = await collectBoards(env, { odds: "cache", buildSlateFn: slateFn });
    assert.equal(first.status, "success");
    assert.equal(second.status, "success");
    assert.ok(second.snapshots_already_present >= 1 || second.snapshots_inserted === 0);
  });

  it("harvest scoreboard failure is not success when games still need grading", async () => {
    resetCacheMem();
    const env = pipelineDb();
    const today = todayCT();
    env.caches = {
      async match() {
        return new Response(
          JSON.stringify({
            games: {
              [`${today}:1`]: {
                id: "1",
                sport: "mlb",
                date: today,
                actualHome: null,
                matchup: "AWY @ HOM",
              },
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      },
      async put() {},
    };
    const out = await harvestAll(1, env, {
      sport: "mlb",
      fetchResultsFn: async () => {
        throw new Error("scoreboard down");
      },
    });
    assert.notEqual(out.status, "success");
    assert.equal(out.ok, false);
    assert.equal(out.successful_at, null);
  });

  it("harvest scoreboard 403 succeeds when remaining games have not kicked off", async () => {
    resetCacheMem();
    const env = pipelineDb();
    const today = todayCT();
    env.caches = {
      async match() {
        return new Response(
          JSON.stringify({
            games: {
              [`${today}:1`]: {
                id: "1",
                sport: "cfb",
                date: today,
                actualHome: null,
                start: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
                matchup: "AWY @ HOM",
              },
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      },
      async put() {},
    };
    const out = await harvestAll(1, env, {
      sport: "cfb",
      fetchResultsFn: async () => {
        throw new Error("ESPN CFB 403");
      },
    });
    assert.equal(out.status, "success");
    assert.equal(out.ok, true);
  });

  it("harvest with no open games succeeds when a scoreboard 403s", async () => {
    resetCacheMem();
    const out = await harvestAll(1, { DB: pipelineDb().DB }, {
      sport: "nba",
      fetchResultsFn: async () => {
        throw new Error("ESPN NBA 403");
      },
    });
    assert.equal(out.status, "success");
    assert.equal(out.ok, true);
  });

  it("workflow rejects a partial response", () => {
    assert.equal(actionAcceptsJob(207, { ok: false, status: "partial" }), false);
    assert.equal(actionAcceptsJob(200, { ok: true, status: "partial" }), false);
    assert.equal(actionAcceptsJob(500, { ok: false, status: "failed" }), false);
    assert.equal(actionAcceptsJob(200, { ok: true, status: "success" }), true);
  });
});

function pipelineDb({ rejectWrites = false } = {}) {
  const snaps = new Map();
  const meta = new Map();
  const jobs = [];
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (rejectWrites && sql.includes("INSERT")) {
                  throw new Error("D1 write rejected");
                }
                if (sql.includes("INSERT OR IGNORE") && sql.includes("prediction_snapshots")) {
                  const id = args[0];
                  if (!snaps.has(id)) {
                    snaps.set(id, { id });
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                if (sql.includes("store_meta")) {
                  meta.set(args[0], args[1]);
                  return { meta: { changes: 1 } };
                }
                if (sql.includes("job_runs")) {
                  jobs.push({ id: args[0], status: args[5] });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("SELECT 1")) return { ok: 1 };
                if (sql.includes("job_runs")) return jobs.at(-1) || null;
                if (sql.includes("COUNT")) return { n: snaps.size };
                return null;
              },
              async all() {
                if (sql.includes("store_meta")) {
                  return { results: [...meta.entries()].map(([k, v]) => ({ k, v })) };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
}
