import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  weatherRunFactor,
  weatherFootballTotalFactor,
  applyScoreWeatherFactor,
  attachWeather,
  isClosedVenue,
} from "../functions/lib/weather.js";
import { attachKalshiSentiment, KALSHI_SERIES } from "../functions/lib/kalshi.js";
import { projectMatchup } from "../functions/lib/savant.js";
import { projectNflFormV0 } from "../functions/lib/nflModel.js";
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

  it("suppresses football totals in cold/wind/rain and skips indoor", () => {
    assert.equal(weatherFootballTotalFactor({ indoor: true }), 1);
    const bad = weatherFootballTotalFactor({ temperature: 20, windSpeed: 28, precipProbability: 80 });
    assert.ok(bad < 1);
    assert.ok(bad >= 0.85);
    const scaled = applyScoreWeatherFactor(24, 21, bad);
    assert.ok(scaled.home < 24);
    assert.ok(scaled.away < 21);
  });

  it("detects closed NFL/CFB domes by venue name", () => {
    assert.equal(isClosedVenue({ venue: "Caesars Superdome" }), true);
    assert.equal(isClosedVenue({ venue: "Ford Field" }), true);
    assert.equal(isClosedVenue({ venueIndoor: true, venue: "Lumen Field" }), true);
    assert.equal(isClosedVenue({ venue: "Lumen Field", venueIndoor: false }), false);
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
    assert.equal(games[0].weatherImpact.footballTotalFactor, 1);
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
    assert.ok(games[0].weatherImpact?.footballTotalFactor);
  });

  it("geocodes outdoor NFL venues from city when lat/lon missing", async () => {
    resetCacheMem();
    const games = await attachWeather(
      [
        {
          id: "nfl-1",
          sport: "nfl",
          start: "2026-09-10T00:20:00Z",
          venue: "Lumen Field",
          venueCity: "Seattle",
          venueState: "WA",
          venueIndoor: false,
        },
      ],
      null
    );
    assert.equal(games[0].weather?.indoor, false);
    assert.ok(games[0].venueLat != null);
    assert.ok(games[0].weatherImpact?.applied);
  });

  it("applies MLB weather run factor into Savant matchup math", () => {
    const base = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.0, awaySpEra: 4.0, park: 1 });
    const boosted = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.0, awaySpEra: 4.0, park: 1.05 });
    assert.ok(boosted.home > base.home);
    assert.ok(boosted.away > base.away);
  });

  it("applies football weather factor into NFL form projections", () => {
    const form = {
      games: 8,
      pointsFor: 200,
      pointsAgainst: 180,
    };
    const clear = projectNflFormV0(
      { neutralSite: false, weatherImpact: { footballTotalFactor: 1 } },
      { homePrior: form, awayPrior: form, homeCurrent: form, awayCurrent: form }
    );
    const storm = projectNflFormV0(
      { neutralSite: false, weatherImpact: { footballTotalFactor: 0.9 }, weather: { indoor: false } },
      { homePrior: form, awayPrior: form, homeCurrent: form, awayCurrent: form }
    );
    assert.equal(clear.ok, true);
    assert.equal(storm.ok, true);
    assert.ok(storm.total < clear.total);
    assert.equal(storm.provenance.weatherTotalFactor, 0.9);
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
    if (meta.matched > 0) {
      assert.ok(games[0].sentiment?.home != null || games[0].sentiment?.away != null);
      assert.equal(games[0].sentiment.source, "Kalshi");
      assert.equal(games[0].sentiment.provider, "kalshi-direct");
    } else {
      assert.equal(games[0].sentiment, undefined);
    }
  });
});
