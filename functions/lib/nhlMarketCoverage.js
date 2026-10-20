/**
 * NHL market-capture coverage.
 *
 * A pregame two-way full-game price is positive evidence. An event that was
 * captured and published no such price is negative evidence. A game that was
 * never in a capture is missing evidence. Those three are not interchangeable,
 * and none of them spends provider quota: archived snapshots are reused, and a
 * new point in time is retained beside the old one instead of replacing it.
 */

import { devigTwoWay, FULL_GAME_PERIOD } from "./nhlMarketEvaluation.js";

export function classifyMarketEvidence(quote) {
  if (!quote || quote.looked !== true) {
    return { evidenceClass: "MISSING", reason: "NO_CAPTURE", usable: false, fairHome: null, fairAway: null };
  }
  if (quote.eventPresent !== true) {
    return { evidenceClass: "MISSING", reason: "EVENT_NOT_IN_CAPTURE", usable: false, fairHome: null, fairAway: null };
  }
  if (quote.period && quote.period !== FULL_GAME_PERIOD) {
    return { evidenceClass: "MISSING", reason: "PERIOD_NOT_COMPARABLE", usable: false, fairHome: null, fairAway: null };
  }
  const devig = devigTwoWay(quote.homeDecimal, quote.awayDecimal);
  if (!devig) {
    return {
      evidenceClass: "NEGATIVE",
      reason: "CAPTURED_EVENT_WITHOUT_FULL_GAME_TWO_WAY",
      usable: false,
      fairHome: null,
      fairAway: null,
    };
  }
  const collected = Date.parse(quote.collectedAt || "");
  const start = Date.parse(quote.eventStart || "");
  if (!Number.isFinite(collected) || !Number.isFinite(start) || collected >= start) {
    return { evidenceClass: "MISSING", reason: "NOT_A_PREGAME_SNAPSHOT", usable: false, fairHome: null, fairAway: null };
  }
  return {
    evidenceClass: "POSITIVE",
    reason: "BOTH_LEGS_BEFORE_START",
    usable: true,
    fairHome: devig.fairA,
    fairAway: devig.fairB,
    overround: devig.overround,
  };
}

/** Same snapshot id is immutable. A different id is a new point in time. */
export function acceptPointInTimeSnapshot(stored, incoming) {
  if (!incoming?.snapshotId || !incoming?.rawHash) {
    return { ok: false, action: "REJECT", reason: "SNAPSHOT_IDENTITY_REQUIRED", additionalRequests: 0 };
  }
  if (stored && stored.snapshotId === incoming.snapshotId) {
    if (stored.rawHash !== incoming.rawHash) {
      return { ok: false, action: "REJECT", reason: "PIT_SNAPSHOT_IMMUTABLE", additionalRequests: 0 };
    }
    return { ok: true, action: "REUSE_ARCHIVED", reason: "EXACT_SNAPSHOT_ALREADY_HELD", additionalRequests: 0 };
  }
  return { ok: true, action: "RETAIN_NEW_SNAPSHOT", reason: "DISTINCT_POINT_IN_TIME", additionalRequests: 0 };
}

export function retainArchivedQuote(ledger = [], quote) {
  const stored = ledger.find((row) => row.snapshotId === quote?.snapshotId) || null;
  const decision = acceptPointInTimeSnapshot(stored, quote);
  if (!decision.ok || decision.action === "REUSE_ARCHIVED") return { ledger, decision };
  return {
    ledger: [...ledger, {
      ...quote,
      gameId: quote.gameId || null,
      collectedAt: quote.collectedAt,
      rawHash: quote.rawHash,
    }],
    decision,
  };
}

/** Attach a canonical game id without rewriting the captured price or clock. */
export function linkArchivedQuotes(ledger = [], links = []) {
  const byProvider = new Map(links.map((link) => [String(link.providerEventId), String(link.gameId)]));
  return ledger.map((row) => {
    const gameId = byProvider.get(String(row.providerEventId || ""));
    if (!gameId) return row;
    return { ...row, gameId, collectedAt: row.collectedAt, rawHash: row.rawHash, homeDecimal: row.homeDecimal, awayDecimal: row.awayDecimal };
  });
}

/**
 * One row per scheduled game. Multiple pregame snapshots collapse to the last
 * one before the start, and that game counts once.
 */
export function summarizeMarketCoverage(games = [], quotes = []) {
  const byGame = new Map();
  for (const quote of quotes) {
    if (!quote?.gameId) continue;
    const key = String(quote.gameId);
    const list = byGame.get(key) || [];
    list.push({ ...quote, ...classifyMarketEvidence(quote) });
    byGame.set(key, list);
  }
  const rows = games.map((game) => {
    const observations = byGame.get(String(game.id)) || [];
    const usable = observations.filter((row) => row.usable)
      .sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt));
    const last = usable.at(-1) || null;
    if (last) {
      return {
        gameId: String(game.id),
        evidenceClass: "POSITIVE",
        reason: last.reason,
        usable: true,
        independentSamples: 1,
        snapshotCount: observations.length,
        fairHome: last.fairHome,
        fairAway: last.fairAway,
        collectedAt: last.collectedAt,
        snapshotId: last.snapshotId,
        rawHash: last.rawHash,
        clv: null,
      };
    }
    const negative = observations.find((row) => row.evidenceClass === "NEGATIVE");
    if (negative) {
      return {
        gameId: String(game.id),
        evidenceClass: "NEGATIVE",
        reason: negative.reason,
        usable: false,
        independentSamples: 0,
        snapshotCount: observations.length,
        fairHome: null,
        clv: null,
      };
    }
    return {
      gameId: String(game.id),
      evidenceClass: "MISSING",
      reason: observations[0]?.reason || "NO_CAPTURE",
      usable: false,
      independentSamples: 0,
      snapshotCount: observations.length,
      fairHome: null,
      clv: null,
    };
  });
  return {
    scheduled: rows.length,
    covered: rows.filter((row) => row.evidenceClass === "POSITIVE").length,
    negative: rows.filter((row) => row.evidenceClass === "NEGATIVE").length,
    missing: rows.filter((row) => row.evidenceClass === "MISSING").length,
    additionalRequests: 0,
    rows,
  };
}
