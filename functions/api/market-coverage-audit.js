/**
 * Read-only platform market coverage audit.
 * GET /api/market-coverage-audit?lookbackHours=48
 */
import { auditPartitionedMarketCoverage } from "../lib/marketCoverageAudit.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lookbackHours = Math.min(168, Math.max(1, Number(url.searchParams.get("lookbackHours") || 48) || 48));
  if (!context.env?.DB?.prepare) {
    return json({ ok: false, error: "DATABASE_UNAVAILABLE" }, 503);
  }
  try {
    const report = await auditPartitionedMarketCoverage(context.env, { lookbackHours, now: new Date() });
    return json(report);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
