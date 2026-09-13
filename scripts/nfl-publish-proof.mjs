#!/usr/bin/env node
/**
 * NFL research publication proof against live production.
 * Soft evidence only — always exits 0 (never fails collect/health).
 *
 * Env:
 *   BASE             production origin (default https://fbis-myz.pages.dev)
 *   HARVEST_SECRET   operator write secret (header x-harvest-secret)
 *   ARTIFACT_DIR     output directory (default artifacts)
 */
import fs from "node:fs";
import path from "node:path";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const SECRET = process.env.HARVEST_SECRET || "";
const OUT = process.env.ARTIFACT_DIR || "artifacts";

const PREFERRED = [
  { away: "DAL", home: "NYG" },
  { away: "DEN", home: "KC" },
];

function abbr(t) {
  if (!t) return "";
  if (typeof t === "string") return t.toUpperCase();
  return String(t.abbr || t.abbreviation || "").toUpperCase();
}

function projectionKind(g) {
  return String(
    g.projectionKind || g.projection_kind || g.model?.projectionKind || ""
  ).toUpperCase();
}

function projHome(g) {
  const n = Number(
    g.model?.projHome ?? g.projHome ?? g.projHomeScore ?? g.researchProjection?.home
  );
  return Number.isFinite(n) ? n : null;
}

function projAway(g) {
  const n = Number(
    g.model?.projAway ?? g.projAway ?? g.projAwayScore ?? g.researchProjection?.away
  );
  return Number.isFinite(n) ? n : null;
}

function isFbisResearch(g) {
  if (projectionKind(g) !== "FBIS") return false;
  if (projHome(g) == null || projAway(g) == null) return false;
  return true;
}

function gameDateHint(g) {
  if (g.date && /^\d{4}-\d{2}-\d{2}$/.test(g.date)) return g.date;
  if (g.gameDate && /^\d{4}-\d{2}-\d{2}$/.test(g.gameDate)) return g.gameDate;
  const id = String(g.id || "");
  const m = id.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const start = Date.parse(g.start || "");
  if (Number.isFinite(start)) return new Date(start).toISOString().slice(0, 10);
  return null;
}

function preferScore(g) {
  const a = abbr(g.away);
  const h = abbr(g.home);
  const idx = PREFERRED.findIndex((p) => p.away === a && p.home === h);
  return idx === -1 ? 100 : idx;
}

async function getJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { http: res.status, body };
}

fs.mkdirSync(OUT, { recursive: true });

const today = await getJson(`${BASE}/api/today?sport=nfl`);
fs.writeFileSync(path.join(OUT, "nfl-today-after-collect.json"), JSON.stringify(today.body, null, 2));

const games = today.body?.games || [];
const fbis = games.filter(isFbisResearch);
const pregame = fbis.filter((g) => {
  const t = Date.parse(g.start || "");
  return Number.isFinite(t) && t > Date.now() + 5 * 60 * 1000;
});
pregame.sort((a, b) => preferScore(a) - preferScore(b) || Date.parse(a.start) - Date.parse(b.start));

const candidate = pregame[0] || null;
const summary = {
  generatedAt: new Date().toISOString(),
  fbisCount: fbis.length,
  pregameCount: pregame.length,
  sample: fbis.slice(0, 8).map((g) => ({
    id: g.id,
    matchup: `${abbr(g.away)}@${abbr(g.home)}`,
    engine: g.projectionEngine || g.researchProjection?.modelId || null,
    version: g.researchProjection?.modelVersion || g.modelVersion || g.projectionRecipe?.version || null,
    away: projAway(g),
    home: projHome(g),
    maturity: g.projectionMaturity || g.researchProjection?.maturity || null,
    publicationStatus: g.publicationStatus || null,
    start: g.start || null,
    dateHint: gameDateHint(g),
  })),
  publishCandidate: candidate
    ? {
        id: candidate.id,
        matchup: `${abbr(candidate.away)}@${abbr(candidate.home)}`,
        start: candidate.start,
        dateHint: gameDateHint(candidate),
        away: projAway(candidate),
        home: projHome(candidate),
        engine: candidate.projectionEngine || candidate.researchProjection?.modelId || null,
        version: candidate.researchProjection?.modelVersion || candidate.modelVersion || null,
        publicationStatus: candidate.publicationStatus || null,
      }
    : null,
};
fs.writeFileSync(path.join(OUT, "nfl-live-ops-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ fbisCount: summary.fbisCount, candidate: summary.publishCandidate?.id || null }));

let publishResult = { ok: false, reason: "no-pregame-fbis-candidate" };
if (candidate?.id) {
  if (!SECRET) {
    publishResult = { ok: false, reason: "harvest-secret-missing" };
  } else {
    const payload = { sport: "nfl", gameId: candidate.id };
    const dateHint = gameDateHint(candidate);
    if (dateHint) payload.date = dateHint;
    const pub = await getJson(`${BASE}/api/published-projections`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-harvest-secret": SECRET,
      },
      body: JSON.stringify(payload),
    });
    publishResult = { http: pub.http, ...pub.body, request: payload };
    console.log(`nfl_publish_proof candidate=${candidate.id} http=${pub.http}`);
  }
} else {
  console.log("nfl_publish_proof skipped — no pregame FBIS candidate");
}
fs.writeFileSync(path.join(OUT, "nfl-publish-proof.json"), JSON.stringify(publishResult, null, 2));

const listed = await getJson(`${BASE}/api/published-projections?sport=nfl&limit=20`);
fs.writeFileSync(path.join(OUT, "nfl-published-list.json"), JSON.stringify(listed.body, null, 2));
console.log(
  JSON.stringify({
    publishedCount: listed.body?.count ?? listed.body?.rows?.length ?? null,
    http: listed.http,
  })
);

process.exit(0);
