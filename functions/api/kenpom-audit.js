import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const BASE = "https://kenpom.com/api.php";
const PROBES = [
  ["ratings", { y: "2026" }],
  ["archive", { d: "2026-03-01" }],
  ["archive-preseason", { endpoint: "archive", preseason: "true", y: "2026" }],
  ["four-factors", { y: "2026" }],
  ["pointdist", { y: "2026" }],
  ["height", { y: "2026" }],
  ["misc-stats", { y: "2026" }],
  ["fanmatch", { d: "2026-03-01" }],
  ["conf-ratings", { y: "2026" }],
  ["program-ratings", {}],
  ["teams", { y: "2026" }],
  ["conferences", { y: "2026" }],
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function probe(apiKey, name, params) {
  const url = new URL(BASE);
  url.searchParams.set("endpoint", params.endpoint || name);
  for (const [k, v] of Object.entries(params)) {
    if (k === "endpoint" || v == null) continue;
    url.searchParams.set(k, String(v));
  }
  const started = Date.now();
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "FBIS-CBB/2.1",
      },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    const rows = Array.isArray(body) ? body.length : Array.isArray(body?.data) ? body.data.length : null;
    return {
      name,
      ok: res.ok && rows !== 0,
      httpStatus: res.status,
      rows,
      latencyMs: Date.now() - started,
      payloadType: Array.isArray(body) ? "array" : body == null ? "empty" : typeof body,
      error: res.ok ? null : (body?.error?.message || body?.error || `HTTP ${res.status}`),
    };
  } catch (err) {
    return { name, ok: false, httpStatus: 0, rows: null, latencyMs: Date.now() - started, error: String(err?.message || err) };
  }
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  const apiKey = String(context.env.KENPOM_API_KEY || "").trim();
  if (!apiKey) {
    return json({ ok: false, configured: false, error: "KENPOM_API_KEY not configured", probes: [] }, 200);
  }
  const probes = [];
  for (const [name, params] of PROBES) probes.push(await probe(apiKey, name, params));
  const working = probes.filter((p) => p.ok).map((p) => p.name);
  const failed = probes.filter((p) => !p.ok).map((p) => ({ name: p.name, httpStatus: p.httpStatus, error: p.error }));
  return json({
    ok: working.length === probes.length,
    configured: true,
    testedAt: new Date().toISOString(),
    working,
    failed,
    summary: { total: probes.length, working: working.length, failed: failed.length },
    probes,
    secretExposed: false,
  });
}
