import { buildSlate, resolveSlateDate, todayCT } from "../lib/slateEngine.js";
import { buildNflWeeklyResearchReport } from "../lib/nflWeeklyResearchReport.js";
import { listPublishedProjections } from "../lib/publishedProjectionStore.js";
import { summarizeHistoricalScoreCases } from "../lib/nflHistoricalScoreCases.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const rawDate = url.searchParams.get("date") || todayCT();
    const resolved = resolveSlateDate(rawDate, { maxPast: 7, maxFuture: 2 });
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 400);

    const env = {
      PARLAY_API_KEY: context.env.PARLAY_API_KEY,
      THEODDS_API_KEY: context.env.THEODDS_API_KEY,
      SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
      THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
      DB: context.env.DB,
      ARCHIVE: context.env.ARCHIVE,
      caches: caches.default,
    };

    const slate = await buildSlate("nfl", resolved.date, env);
    const publishedRows = await listPublishedProjections(context.env, {
      sport: "nfl",
      date: resolved.date,
      limit: 100,
    }).catch(() => []);

    const report = buildNflWeeklyResearchReport({
      slate,
      publishedRows,
      codeSha: context.env.CF_PAGES_COMMIT_SHA || null,
    });

    return json({
      ok: true,
      report,
      historicalCases: summarizeHistoricalScoreCases(),
      governance: {
        automaticPromotion: false,
        productionChampionChanged: false,
        wagerAuthorityChanged: false,
      },
    });
  } catch (err) {
    return json({
      ok: false,
      error: "nfl-weekly-research-report-failed",
      detail: String(err?.message || err),
    }, 502);
  }
}
