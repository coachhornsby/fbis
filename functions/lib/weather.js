/**
 * Open-Meteo weather for game venues (free, no API key).
 * MLB coords come from Stats API venue hydrate; other sports pass lat/lon if present.
 * Attribution: Open-Meteo.com (CC BY 4.0).
 */

import { readCache, writeCache } from "./cache.js";

const TTL_MS = 90 * 60 * 1000;
const ROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WMO = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function roundCoord(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isIndoorRoof(roofType = "") {
  const r = String(roofType || "").toLowerCase();
  return r === "dome" || r === "indoor" || r === "closed";
}

function isRetractableRoof(roofType = "") {
  return /retractable/i.test(String(roofType || ""));
}

/** Map conditions → mild run-environment factor for MLB deep shadow (1 = neutral). */
export function weatherRunFactor(wx) {
  if (!wx || wx.indoor) return 1;
  const temp = finite(wx.temperature);
  const wind = finite(wx.windSpeed);
  const precip = finite(wx.precipProbability);
  let f = 1;
  if (temp != null) {
    if (temp >= 85) f += 0.03;
    else if (temp <= 50) f -= 0.03;
  }
  if (wind != null && wind >= 15) f += 0.02;
  if (precip != null && precip >= 50) f -= 0.04;
  return Math.max(0.9, Math.min(1.12, f));
}

export async function fetchMlbVenueRoof(venueId, caches) {
  const id = String(venueId || "");
  if (!id) return null;
  const key = `v1:mlb-venue-roof:${id}`;
  const cached = await readCache(key, caches, ROOF_TTL_MS);
  if (cached) return cached.roofType || null;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/venues/${id}?hydrate=fieldInfo`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const venue = Array.isArray(json.venues) ? json.venues[0] : json;
    const roofType = venue?.fieldInfo?.roofType || null;
    await writeCache(key, { roofType }, caches, ROOF_TTL_MS);
    return roofType;
  } catch {
    return null;
  }
}

async function fetchOpenMeteoAt(lat, lon, startIso, caches) {
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  const hourKey = startIso ? String(startIso).slice(0, 13) : "now";
  const key = `v1:open-meteo:${la}:${lo}:${hourKey}`;
  const cached = await readCache(key, caches, TTL_MS);
  if (cached) return cached;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(la));
  url.searchParams.set("longitude", String(lo));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("timezone", "America/Chicago");
  url.searchParams.set("forecast_days", "3");

  const res = await fetch(String(url), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const times = json.hourly?.time || [];
  const target = Date.parse(startIso);
  let idx = 0;
  if (Number.isFinite(target) && times.length) {
    let best = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(Date.parse(times[i]) - target);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
  }
  const code = json.hourly?.weather_code?.[idx];
  const packed = {
    source: "open-meteo",
    asOf: new Date().toISOString(),
    at: times[idx] || null,
    temperature: finite(json.hourly?.temperature_2m?.[idx]),
    precipProbability: finite(json.hourly?.precipitation_probability?.[idx]),
    windSpeed: finite(json.hourly?.wind_speed_10m?.[idx]),
    weatherCode: code ?? null,
    description: WMO[code] || (code == null ? "Conditions available" : `Code ${code}`),
    lat: la,
    lon: lo,
    attribution: "Open-Meteo.com (CC BY 4.0)",
  };
  await writeCache(key, packed, caches, TTL_MS);
  return packed;
}

/**
 * Attach weather onto slate games. Mutates shallow copies.
 * Expects venueLat/venueLon (and optional venueRoof / venueId for MLB).
 */
export async function attachWeather(games = [], caches = null) {
  const out = [];
  for (const g of games || []) {
    const lat = finite(g.venueLat ?? g.venue?.lat ?? g.venue?.latitude);
    const lon = finite(g.venueLon ?? g.venue?.lon ?? g.venue?.longitude);
    let roof = g.venueRoof || null;
    if (!roof && g.venueId) {
      roof = await fetchMlbVenueRoof(g.venueId, caches);
    }

    if (lat == null || lon == null) {
      out.push({ ...g, weather: g.weather || null });
      continue;
    }

    if (isIndoorRoof(roof)) {
      const weather = {
        source: "open-meteo",
        indoor: true,
        roofType: roof,
        description: "Indoor / closed roof — outdoor weather not applied",
        temperature: null,
        windSpeed: null,
        precipProbability: null,
        attribution: "Open-Meteo.com (CC BY 4.0)",
      };
      out.push({
        ...g,
        venueRoof: roof || g.venueRoof || null,
        weather,
        mlbContext: { ...(g.mlbContext || {}), weatherRunFactor: 1 },
      });
      continue;
    }

    try {
      const wx = await fetchOpenMeteoAt(lat, lon, g.start, caches);
      const weather = {
        ...wx,
        indoor: false,
        roofType: roof || null,
        note: isRetractableRoof(roof) ? "Retractable roof — confirm open/closed" : null,
      };
      out.push({
        ...g,
        venueRoof: roof || g.venueRoof || null,
        weather,
        mlbContext: {
          ...(g.mlbContext || {}),
          weatherRunFactor: weatherRunFactor(weather),
        },
      });
    } catch {
      out.push({
        ...g,
        venueRoof: roof || g.venueRoof || null,
        weather: g.weather || {
          source: "open-meteo",
          unavailable: true,
          description: "Weather unavailable for this feed.",
        },
      });
    }
  }
  return out;
}
