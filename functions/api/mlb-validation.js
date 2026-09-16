import { querySnapshots } from "../lib/store.js";
import { buildMlbMarketValidation } from "../lib/mlbMarketValidation.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

function ctDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolveSince(daysRaw) {
  const today = ctDateParts();
  const token = String(daysRaw || "30").toLowerCase();
  if (token === "season") return `${today.slice(0, 4)}-03-01`;
  if (token === "lifetime") return "2025-01-01";
  const days = Math.max(1, Math.min(365, Number(token) || 30));
  return shiftDate(today, -(days - 1));
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const since = resolveSince(url.searchParams.get("days"));
    const checkpoint = String(url.searchParams.get("checkpoint") || "LATEST").toUpperCase();
    const version = url.searchParams.get("version") || null;
    const q = await querySnapshots(
      { DB: context.env.DB },
      {
        sport: "mlb",
        since,
        checkpoint: checkpoint === "LATEST" ? null : checkpoint,
        version: version || undefined,
      }
    );
    if (!q.ok) {
      return json({
        ok: false,
        sport: "mlb",
        since,
        checkpoint,
        error: q.reason || "snapshot-query-failed",
      }, 503);
    }

    const report = buildMlbMarketValidation(q.rows || []);
    return json({
      ok: true,
      since,
      checkpoint,
      version,
      ...report,
    });
  } catch (err) {
    return json({ ok: false, sport: "mlb", error: String(err?.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
