/**
 * Open-Meteo weather for game venues (free, no API key).
 * MLB coords come from Stats API venue hydrate; NFL/CFB use ESPN indoor flag
 * plus city geocoding when lat/lon are absent.
 * Closed roofs / indoor venues skip outdoor weather impact.
 * Attribution: Open-Meteo.com (CC BY 4.0).
 */

import { readCache, writeCache } from "./cache.js";

const TTL_MS = 90 * 60 * 1000;
const ROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

/** Fixed closed / dome venues — outdoor weather never applied. Retractables omitted. */
const FIXED_CLOSED_HINTS = [
  "superdome",
  "ford field",
  "lucas oil stadium",
  "sofi stadium",
  "allegiant stadium",
  "u.s. bank stadium",
  "us bank stadium",
  "alamo dome",
  "alamodome",
  "carrier dome",
  "jma wireless dome",
  "dakota dome",
  "kibbie dome",
  "fargodome",
  "holt arena",
];

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function roundCoord(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function isIndoorRoof(roofType = "") {
  const r = String(roofType || "").toLowerCase();
  return r === "dome" || r === "indoor" || r === "closed" || r === "fixed";
}

export function isRetractableRoof(roofType = "") {
  return /retractable/i.test(String(roofType || ""));
}

export function isClosedVenue({ venueRoof = null, venueIndoor = null, venue = "" } = {}) {
  if (venueIndoor === true) return true;
  if (isIndoorRoof(venueRoof)) return true;
  const name = String(venue || "").toLowerCase();
  if (!name) return false;
  return FIXED_CLOSED_HINTS.some((h) => name.includes(h));
}

/** Parse "Stadium Name (City, ST)" style labels used by ESPN/CFBD. */
export function parseVenueLocation(venue = "") {
  const raw = String(venue || "").trim();
  if (!raw) return { city: "", state: "" };
  const m = raw.match(/\(([^)]+)\)\s*$/);
  if (!m) return { city: "", state: "" };
  const parts = m[1].split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const state = parts[parts.length - 1];
    const city = parts.slice(0, -1).join(", ");
    if (/^[A-Za-z]{2}$/.test(state) || state.length >= 2) {
      return { city, state: state.length === 2 ? state.toUpperCase() : state };
    }
  }
  if (parts.length === 1) return { city: parts[0], state: "" };
  return { city: "", state: "" };
}

/** Map conditions → mild run-environment factor for MLB (1 = neutral). */
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
  return clamp(f, 0.9, 1.12);
}

/**
 * Football outdoor scoring factor. Bad weather suppresses totals;
 * never applied indoors / closed roofs.
 */
export function weatherFootballTotalFactor(wx) {
  if (!wx || wx.indoor) return 1;
  const temp = finite(wx.temperature);
  const wind = finite(wx.windSpeed);
  const precip = finite(wx.precipProbability);
  let f = 1;
  if (temp != null) {
    if (temp <= 25) f -= 0.08;
    else if (temp <= 35) f -= 0.05;
    else if (temp <= 45) f -= 0.03;
  }
  if (wind != null) {
    if (wind >= 25) f -= 0.07;
    else if (wind >= 18) f -= 0.04;
    else if (wind >= 12) f -= 0.02;
  }
  if (precip != null) {
    if (precip >= 70) f -= 0.06;
    else if (precip >= 45) f -= 0.03;
  }
  return clamp(f, 0.85, 1.03);
}

/** Side-context points for NFL pro model (±0.75). */
export function weatherFootballPoints(wx) {
  if (!wx || wx.indoor) return 0;
  const f = weatherFootballTotalFactor(wx);
  return clamp((f - 1) * 10, -0.75, 0.75);
}

export function applyScoreWeatherFactor(home, away, factor = 1) {
  const f = finite(factor) ?? 1;
  if (!Number.isFinite(f) || f === 1) {
    return {
      home: home == null ? null : Number(home),
      away: away == null ? null : Number(away),
      factor: 1,
    };
  }
  const h = finite(home);
  const a = finite(away);
  return {
    home: h == null ? null : Math.round(h * f * 10) / 10,
    away: a == null ? null : Math.round(a * f * 10) / 10,
    factor: f,
  };
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

async function geocodeCity(city, state, caches) {
  const c = String(city || "").trim();
  if (!c) return null;
  const st = String(state || "").trim();
  const key = `v1:geo:${c.toLowerCase()}:${st.toLowerCase()}`;
  const cached = await readCache(key, caches, GEO_TTL_MS);
  if (cached?.lat != null && cached?.lon != null) return cached;
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", c);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const res = await fetch(String(url), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = Array.isArray(json?.results) ? json.results : [];
    let hit = null;
    if (st) {
      hit = rows.find((r) => String(r.admin1 || "").toLowerCase().includes(st.toLowerCase()) || String(r.admin1 || "").toLowerCase() === st.toLowerCase());
    }
    hit = hit || rows.find((r) => String(r.country_code || "").toUpperCase() === "US") || rows[0];
    if (!hit || hit.latitude == null || hit.longitude == null) return null;
    const packed = { lat: Number(hit.latitude), lon: Number(hit.longitude), name: hit.name || c };
    await writeCache(key, packed, caches, GEO_TTL_MS);
    return packed;
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

function packImpact(weather) {
  const runFactor = weatherRunFactor(weather);
  const footballTotalFactor = weatherFootballTotalFactor(weather);
  const footballPoints = weatherFootballPoints(weather);
  return {
    applied: !weather?.indoor,
    runFactor,
    footballTotalFactor,
    footballPoints,
  };
}

/**
 * Attach weather onto slate games. Mutates shallow copies.
 * Expects venueLat/venueLon and/or venueCity; optional venueRoof / venueIndoor / venueId.
 */
export async function attachWeather(games = [], caches = null) {
  const out = [];
  for (const g of games || []) {
    let lat = finite(g.venueLat ?? g.venue?.lat ?? g.venue?.latitude);
    let lon = finite(g.venueLon ?? g.venue?.lon ?? g.venue?.longitude);
    let roof = g.venueRoof || null;
    if (!roof && g.venueId) {
      roof = await fetchMlbVenueRoof(g.venueId, caches);
    }

    const parsed = parseVenueLocation(g.venue);
    let city = String(g.venueCity || "").trim() || parsed.city;
    let state = String(g.venueState || "").trim() || parsed.state;

    const closed = isClosedVenue({
      venueRoof: roof,
      venueIndoor: g.venueIndoor,
      venue: g.venue,
    });

    if (closed) {
      const weather = {
        source: "open-meteo",
        indoor: true,
        roofType: roof || (g.venueIndoor ? "Indoor" : null),
        description: "Indoor / closed roof — outdoor weather not applied",
        temperature: null,
        windSpeed: null,
        precipProbability: null,
        attribution: "Open-Meteo.com (CC BY 4.0)",
      };
      const impact = packImpact(weather);
      out.push({
        ...g,
        venueCity: city || g.venueCity || "",
        venueState: state || g.venueState || "",
        venueRoof: roof || g.venueRoof || null,
        weather,
        weatherImpact: impact,
        mlbContext: { ...(g.mlbContext || {}), weatherRunFactor: 1 },
      });
      continue;
    }

    if ((lat == null || lon == null) && city) {
      const geo = await geocodeCity(city, state, caches);
      if (geo) {
        lat = geo.lat;
        lon = geo.lon;
      }
    }

    if (lat == null || lon == null) {
      out.push({
        ...g,
        venueCity: city || g.venueCity || "",
        venueState: state || g.venueState || "",
        weather: g.weather || null,
        weatherImpact: g.weatherImpact || { applied: false, runFactor: 1, footballTotalFactor: 1, footballPoints: 0 },
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
      const impact = packImpact(weather);
      out.push({
        ...g,
        venueLat: lat,
        venueLon: lon,
        venueCity: city || g.venueCity || "",
        venueState: state || g.venueState || "",
        venueRoof: roof || g.venueRoof || null,
        weather,
        weatherImpact: impact,
        mlbContext: {
          ...(g.mlbContext || {}),
          weatherRunFactor: impact.runFactor,
        },
      });
    } catch {
      out.push({
        ...g,
        venueCity: city || g.venueCity || "",
        venueState: state || g.venueState || "",
        venueRoof: roof || g.venueRoof || null,
        weather: g.weather || {
          source: "open-meteo",
          unavailable: true,
          description: "Weather unavailable for this feed.",
        },
        weatherImpact: { applied: false, runFactor: 1, footballTotalFactor: 1, footballPoints: 0 },
      });
    }
  }
  return out;
}
