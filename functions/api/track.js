import { buildTrackReport } from "../lib/projLedger.js";
import { queryAccuracyDailySummary, queryPipelineStages, queryStrategyTicketsStatus } from "../lib/store.js";
import { rollupAccuracySummaries } from "../lib/accuracySummary.js";
import { STRATEGY_HC_V1, scopedProspectiveTickets } from "../lib/strategy.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "all";
  const requestedDays = url.searchParams.get("days") || "season";
  // A season-wide cross-sport report can exceed the Pages worker CPU ceiling.
  // Keep the overview useful and let each sport tab retain full season/lifetime views.
  const overviewLimited = sport === "all" && (requestedDays === "season" || requestedDays === "lifetime");
  const days = overviewLimited ? "7" : requestedDays;
  const checkpoint = url.searchParams.get("checkpoint") || "LATEST";
  const version = url.searchParams.get("version") || "all";
  const model = url.searchParams.get("model") || "ensemble";
  const type = url.searchParams.get("type") || "perGame";
  const year = url.searchParams.get("year") || "";
  const team = url.searchParams.get("team") || "";
  try {
    if ((requestedDays === "season" || requestedDays === "lifetime") && !team) {
      const now = new Date();
      const y = Number(year || now.getUTCFullYear());
      const since = requestedDays === "lifetime" ? "2000-01-01" :
        (sport === "nba" || sport === "cbb" ? `${y - 1}-10-01` : `${y}-01-01`);
      const compact = await queryAccuracyDailySummary({ DB: context.env.DB }, {
        sport, since, checkpoint, version,
      });
      if (compact.ok && compact.rows.length) {
        const accuracy = rollupAccuracySummaries(compact.rows);
        const ticketQuery = await queryStrategyTicketsStatus({ DB: context.env.DB }, { strategyId: STRATEGY_HC_V1.id });
        const cohort = scopedProspectiveTickets(ticketQuery.rows, { sport, since, until: null });
        const strategyPerformance = {
          available: ticketQuery.ok,
          population: cohort.population,
          scope: { ...cohort.scope, checkpoint: "qualification freeze", strategyId: STRATEGY_HC_V1.id },
          reconciliation: cohort.reconciliation,
          tickets: cohort.stats.n,
          open: cohort.stats.open,
          settled: cohort.stats.settled,
          record: cohort.stats.gradedRecord,
          hitRate: cohort.stats.hitRate,
          units: cohort.stats.units,
          roi: cohort.stats.roi,
          avgEv: cohort.stats.avgEv,
          avgClv: cohort.stats.avgClv,
          message: !ticketQuery.ok
            ? "CONVICTION history is unavailable; this is not a zero-ticket result."
            : cohort.stats.settled ? null : "No settled FBIS-HC-v1 CONVICTION tickets in this exact scope.",
        };
        const stages = await queryPipelineStages({ DB: context.env.DB }, { limit: 50 });
        return new Response(JSON.stringify({
          sport, days: requestedDays, checkpoint, version, source: "d1-preaggregated",
          generatedAt: new Date().toISOString(), accuracy: { n: accuracy.graded, ...accuracy },
          accuracySummary: { sport, checkpoint, dateRange: { since, until: null }, distinctProjected: accuracy.projected, distinctGraded: accuracy.graded, ...accuracy },
          distinct: { projected: accuracy.projected, graded: accuracy.graded, checkpointRows: accuracy.projected },
          pack: { table: { headline: {}, rows: [] }, models: [], breakdowns: {} },
          games: [], finals: [], pipelineStages: stages, strategyPerformance,
          compact: true,
          compactNote: "Season metrics are served from durable daily aggregates. Select a shorter window for game-level detail.",
        }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
      }
    }
    const payload = await buildTrackReport(
      sport,
      days,
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
      },
      { checkpoint, version, model, type, year, team }
    );
    return new Response(JSON.stringify({
      ...payload,
      requestedDays,
      overviewLimited,
      overviewNote: overviewLimited ? "All-sports overview is limited to the last 7 days to stay within Cloudflare's worker limit. Select a sport for season or lifetime detail." : null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err), games: [], finals: [], accuracy: { n: 0 } }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }
}
