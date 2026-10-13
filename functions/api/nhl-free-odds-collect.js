import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { fetchParlayOdds } from "../lib/parlay.js";
import { classifyNhlQuoteEvidence } from "../lib/nhlBookQuoteEvidence.js";
import {
  verifyCtScheduleGameCount,
  classifyFreeOddsSlate,
  emptySlateReadbackValidated,
} from "../lib/freeOddsSlateGuard.js";

/**
 * Scheduled NHL sportsbook observation only. Explicitly excludes paid
 * Parlay/TheOdds requests, model projection and wager decisions.
 */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function onRequestPost(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date") || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "invalid-date" }, 400);
  if (!context.env.DB) return json({ ok: false, error: "durable-evidence-db-unavailable" }, 503);
  if (!context.env.SHARPAPI_API_KEY && !context.env.THERUNDOWN_API_KEY)
    return json({ ok: false, error: "no-configured-free-nhl-provider" }, 503);

  const schedule = await verifyCtScheduleGameCount("nhl", date);
  if (!schedule.ok) {
    return json(
      {
        ok: false,
        error: "schedule-unverified",
        detail: schedule.error,
        sport: "nhl",
        requestedDateCt: date,
        signalClass: "SCHEDULE_UNVERIFIED",
        canQualify: false,
        canAuthorizeWager: false,
      },
      503
    );
  }
  if (schedule.scheduledGames === 0) {
    const decision = classifyFreeOddsSlate({
      scheduleOk: true,
      scheduledGames: 0,
      pairedMoneylines: 0,
      persistedMoneylineRows: 0,
    });
    return json(
      {
        ok: decision.ok,
        skipped: decision.skipped,
        skipReason: decision.skipReason,
        signalClass: decision.signalClass,
        sport: "nhl",
        requestedDateCt: date,
        scheduleSource: schedule.scheduleSource,
        scheduledGames: 0,
        source: null,
        provider: null,
        games: 0,
        pairedMoneylines: 0,
        persistedMoneylineRows: 0,
        readbackValidated: emptySlateReadbackValidated(),
        evidenceStore: "nhl_bookmaker_quote_evidence",
        observations: [],
        failClosed: true,
        canQualify: false,
        canAuthorizeWager: false,
      },
      decision.httpStatus
    );
  }

  try {
    const result = await fetchParlayOdds("nhl", null, caches.default, {
      cacheOnly: true,
      strictCacheOnly: false,
      backupApiKey: null,
      sharpApiKey: context.env.SHARPAPI_API_KEY,
      theRundownApiKey: context.env.THERUNDOWN_API_KEY,
      date,
    });
    const events = result.events || [];
    const capturedAt = new Date().toISOString();
    let persistedMoneylineRows = 0;
    let pairedPersisted = 0;
    for (const e of events) {
      const book = String(e.moneylineBook || "");
      const { captureClass, sourceObservedAt } = classifyNhlQuoteEvidence({
        gameStart: e.commence,
        sourceObservedAt: e.observedAt,
        capturedAt,
      });
      if (!book || !Number.isInteger(e.homeMl) || !Number.isInteger(e.awayMl)) continue;
      for (const [selection, price] of [
        ["HOME", e.homeMl],
        ["AWAY", e.awayMl],
      ]) {
        const id = crypto.randomUUID();
        await context.env.DB.prepare(`INSERT INTO nhl_bookmaker_quote_evidence
          (id,source_event_id,game_start,home_team,away_team,market_family,
          selection,bookmaker,provider,american_price,source_observed_at,
          captured_at,capture_class,can_qualify,can_authorize_wager)
          VALUES (?1,?2,?3,?4,?5,'moneyline',?6,?7,?8,?9,?10,?11,?12,0,0)`)
          .bind(
            id,
            String(e.parlayId),
            e.commence || null,
            String(e.homeTeam),
            String(e.awayTeam),
            selection,
            book,
            String(result.meta?.provider || "unknown"),
            price,
            sourceObservedAt,
            capturedAt,
            captureClass
          )
          .run();
        persistedMoneylineRows++;
      }
      pairedPersisted++;
    }
    const readback = await context.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM nhl_bookmaker_quote_evidence WHERE captured_at=?1"
    )
      .bind(capturedAt)
      .first();
    const readbackValidated = Number(readback?.n || 0) === persistedMoneylineRows;
    if (!readbackValidated) throw new Error("durable-quote-evidence-readback-mismatch");

    // pairedMoneylines = pairs actually persisted (not raw provider event count).
    const pairedMoneylines = pairedPersisted;
    const decision = classifyFreeOddsSlate({
      scheduleOk: true,
      scheduledGames: schedule.scheduledGames,
      pairedMoneylines,
      persistedMoneylineRows,
    });
    const observed = events.filter((e) => e.observedAt).length;
    const payload = {
      ok: decision.ok,
      skipped: decision.skipped,
      skipReason: decision.skipReason,
      signalClass: decision.signalClass,
      sport: "nhl",
      requestedDateCt: date,
      scheduleSource: schedule.scheduleSource,
      scheduledGames: schedule.scheduledGames,
      source: result.meta?.source || null,
      provider: result.meta?.provider || null,
      games: events.length,
      pairedMoneylines,
      persistedMoneylineRows,
      readbackValidated,
      evidenceStore: "nhl_bookmaker_quote_evidence",
      pricedWithOriginalTimestamp: observed,
      capturedAt: new Date().toISOString(),
      cacheOnly: Boolean(result.meta?.cached),
      observations: events.map((e) => ({
        eventId: e.parlayId,
        home: e.homeTeam,
        away: e.awayTeam,
        commence: e.commence || null,
        moneylineBook: e.moneylineBook || null,
        spreadBook: e.spreadBook || null,
        totalBook: e.totalBook || null,
        homeMl: e.homeMl ?? null,
        awayMl: e.awayMl ?? null,
        spread: e.spread ?? null,
        total: e.total ?? null,
        observedAt: e.observedAt || null,
        attribution: e.observedAt ? "SOURCE_TIMESTAMPED" : "SOURCE_TIMESTAMP_MISSING",
      })),
      failClosed: true,
      canQualify: false,
      canAuthorizeWager: false,
    };
    return json(payload, decision.httpStatus);
  } catch (error) {
    return json(
      { ok: false, error: "nhl-free-collector-failed", detail: String(error?.message || error) },
      502
    );
  }
}
export async function onRequestGet() {
  return json({ ok: false, error: "method-not-allowed" }, 405);
}
