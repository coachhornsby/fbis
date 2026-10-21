import { nflSportDbContext } from "../lib/nflSportDbContext.js";
import { authorizeOperatorWrite, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate, todayCT } from "../lib/slateEngine.js";
import {
  publishNflPregameSlate,
  listNflResearchPublications,
  buildNflPublicationCoverageReport,
} from "../lib/nflPregamePublication.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function slateEnv(context) {
  return {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    ...nflSportDbContext(context.env), DB: context.env.DB,
    ARCHIVE: context.env.ARCHIVE,
    caches: caches.default,
  };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const rawDate = url.searchParams.get("date") || todayCT();
    const resolved = resolveSlateDate(rawDate, { maxPast: 7, maxFuture: 2 });
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 400);

    const pubs = await listNflResearchPublications(context.env, {
      date: resolved.date,
      eventId: url.searchParams.get("eventId") || null,
      limit: url.searchParams.get("limit") || 200,
    });

    let coverage = null;
    if (url.searchParams.get("coverage") === "1" || url.searchParams.get("coverage") === "true") {
      const slate = await buildSlate("nfl", resolved.date, slateEnv(context));
      coverage = buildNflPublicationCoverageReport(slate.games || [], pubs);
    }

    return json({
      ok: true,
      date: resolved.date,
      count: pubs.length,
      rows: pubs,
      coverage,
      governance: {
        canQualify: false,
        canAuthorizeWager: false,
        automaticPromotion: false,
      },
    });
  } catch (err) {
    return json({
      ok: false,
      error: "nfl-pregame-publish-status-failed",
      detail: String(err?.message || err),
    }, 502);
  }
}

export async function onRequestPost(context) {
  const auth = authorizeOperatorWrite(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);

  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  try {
    const rawDate = String(body.date || todayCT());
    const resolved = resolveSlateDate(rawDate, { maxPast: 2, maxFuture: 2 });
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 400);

    const slate = await buildSlate("nfl", resolved.date, slateEnv(context));
    const report = await publishNflPregameSlate(context.env, slate, {
      gameDate: resolved.date,
      codeSha: context.env.CF_PAGES_COMMIT_SHA || body.codeSha || null,
      publishedBy: body.publishedBy || "nfl-pregame-publish",
      runId: body.runId || null,
    });

    return json({
      ok: true,
      wrote: report.summary.success > 0 || report.summary.already > 0,
      ...report,
    }, report.summary.success > 0 ? 201 : 200);
  } catch (err) {
    return json({
      ok: false,
      error: "nfl-pregame-publish-failed",
      detail: String(err?.message || err),
      wrote: false,
    }, 502);
  }
}
