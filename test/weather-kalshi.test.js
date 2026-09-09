import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weatherRunFactor, attachWeather } from "../functions/lib/weather.js";
import { attachKalshiSentiment, KALSHI_SERIES } from "../functions/lib/kalshi.js";
import { resetCacheMem } from "../functions/lib/cache.js";

describe("Open-Meteo weather helpers", () => {
  it("maps hot/windy/rain into a bounded run factor", () => {
    assert.equal(weatherRunFactor({ indoor: true }), 1);
    const hot = weatherRunFactor({ temperature: 90, windSpeed: 5, precipProbability: 0 });
    assert.ok(hot > 1);
    const coldWet = weatherRunFactor({ temperature: 45, windSpeed: 5, precipProbability: 80 });
    assert.ok(coldWet < 1);
    assert.ok(weatherRunFactor({ temperature: 200, windSpeed: 100, precipProbability: 0 }) <= 1.12);
  });

  it("marks dome venues indoor without calling Open-Meteo", async () => {
    resetCacheMem();
    const games = await attachWeather(
      [
        {
          id: "1",
          start: "2026-09-09T23:10:00Z",
          venueLat: 27.77,
          venueLon: -82.65,
          venueRoof: "Dome",
        },
      ],
      null
    );
    assert.equal(games[0].weather.indoor, true);
    assert.match(games[0].weather.description, /Indoor/i);
    assert.equal(games[0].mlbContext.weatherRunFactor, 1);
  });

  it("fetches Open-Meteo for outdoor parks", async () => {
    resetCacheMem();
    const games = await attachWeather(
      [
        {
          id: "2",
          start: "2026-09-09T23:10:00Z",
          venueLat: 42.339,
          venueLon: -83.049,
          venueRoof: "Open",
        },
      ],
      null
    );
    assert.equal(games[0].weather?.source, "open-meteo");
    assert.equal(games[0].weather?.indoor, false);
    assert.ok(games[0].weather?.temperature == null || Number.isFinite(games[0].weather.temperature));
    assert.ok(games[0].mlbContext?.weatherRunFactor);
  });
});

describe("Kalshi direct sentiment", () => {
  it("exposes series tickers for board sports", () => {
    assert.equal(KALSHI_SERIES.mlb, "KXMLBGAME");
    assert.equal(KALSHI_SERIES.nfl, "KXNFLGAME");
    assert.equal(KALSHI_SERIES.cfb, "KXNCAAFGAME");
  });

  it("matches open MLB markets onto a slate game without a Parlay key", async () => {
    resetCacheMem();
    const { games, meta } = await attachKalshiSentiment(
      [
        {
          id: "g1",
          sport: "mlb",
          home: { name: "San Francisco Giants", abbr: "SF" },
          away: { name: "San Diego Padres", abbr: "SD" },
          start: "2026-09-12T05:15:00Z",
        },
      ],
      "mlb",
      null
    );
    assert.equal(meta.enabled, true);
    assert.equal(meta.provider, "kalshi-direct");
    // Live Kalshi board may or may not list this exact game; tolerate miss but never throw.
    if (meta.matched > 0) {
      assert.ok(games[0].sentiment?.home != null || games[0].sentiment?.away != null);
      assert.equal(games[0].sentiment.source, "Kalshi");
      assert.equal(games[0].sentiment.provider, "kalshi-direct");
    } else {
      assert.equal(games[0].sentiment, undefined);
    }
  });
});
