/**
 * Board game view-model — thin presentation contract for Board rows/cards.
 *
 * UI renders this. UI does not invent authority, EV, probability, or qualification.
 * Projection interpretation stays in resolveBoardProjection / fbisProjection.
 * Market role selection stays in marketLines (execution → consensus → reference).
 */

import {
  boardDecision,
  boardShowsFairProbability,
  favoriteFairLabel,
  fbisProjection,
  formatBoardDate,
  formatSpreadLabel,
  marketDeltas,
  marketLines,
  resolveBoardProjection,
} from "./boardDecision.js";

function round1(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10;
}

function spreadTeamLabel(spread, awayAbbr, homeAbbr) {
  if (spread == null || Number.isNaN(Number(spread))) return null;
  const n = Number(spread);
  if (Math.abs(n) < 0.05) return "PICK'EM";
  if (n < 0) return `${homeAbbr || "HOME"} ${formatSpreadLabel(n)}`;
  return `${awayAbbr || "AWAY"} ${formatSpreadLabel(-n)}`;
}

function maturityFromGame(game, projection) {
  const raw = String(
    game?.projectionMaturity || game?.model?.maturity || game?.maturity || ""
  ).toUpperCase();
  if (raw) return raw;
  if (projection?.research || game?.publicationStatus === "RESEARCH_PUBLISHABLE") {
    return "RESEARCH";
  }
  return "UNKNOWN";
}

/**
 * Decision presentation — authority-honest.
 * Research models never surface EV / fair probability / qualification as actionable.
 */
export function buildDecisionPresentation(game) {
  const decision = boardDecision(game);
  const projection = fbisProjection(game);
  const maturity = maturityFromGame(game, projection);
  const research = Boolean(
    projection.research || maturity === "RESEARCH" || decision.tier === "RESEARCH"
  );
  const probabilityAuthority = boardShowsFairProbability(game);
  const market = marketLines(game);
  const marketAvailable = Boolean(market.marketAvailable);
  const marketFresh = !(game?.marketStale || game?.odds?.stale);
  const dqState = game?.quality?.state || game?.dqState || null;

  const evPct =
    decision.evPct ?? (decision.ev != null ? Number(decision.ev) * 100 : null);

  const evAvailable =
    !research &&
    probabilityAuthority &&
    marketAvailable &&
    evPct != null &&
    Number.isFinite(Number(evPct)) &&
    (decision.tier === "QUALIFIED" || decision.tier === "CONVICTION");

  let qualification = "NOT_EVALUATED";
  if (research) qualification = "RESEARCH_ONLY";
  else if (decision.tier === "BLOCKED" || decision.tier === "NO_MODEL") {
    qualification = "NO_QUALIFY";
  } else if (decision.tier === "LEAN") qualification = "WATCH";
  else if (decision.tier === "QUALIFIED" || decision.tier === "CONVICTION") {
    qualification = "QUALIFIED";
  } else if (decision.tier === "PASS") qualification = "NO_QUALIFY";

  const authorization =
    game?.authorized === true
      ? "AUTHORIZED"
      : game?.authorizationState ||
        (qualification === "QUALIFIED" ? "AWAITING_REVIEW" : "NONE");

  return {
    maturity,
    probabilityAuthority,
    marketAvailable,
    marketFresh,
    dqState,
    disagreementLabel: research || !evAvailable ? "MODEL DIFFERENCE" : "CALIBRATED EDGE",
    evAvailable,
    ev: evAvailable ? Number(evPct) : null,
    qualification,
    risk: null,
    authorization,
    humanConfirmationRequired: true,
    tier: decision.tier,
    label: decision.label,
    pick: decision.pick || null,
    reason: decision.reason || null,
    mispriceState: decision.mispriceState || null,
  };
}

/** Canonical Board game view-model for desktop rows and mobile cards. */
export function buildBoardGameViewModel(game) {
  if (!game || typeof game !== "object") {
    return {
      sport: null,
      event: { live: false, final: false },
      timing: { timeLine: "—", dateLine: "—", isToday: false },
      teams: { awayAbbr: "AWAY", homeAbbr: "HOME", identityOk: false },
      projection: { available: false, loading: false },
      market: { available: false, label: "MARKET", emptyReason: "—" },
      comparison: { label: "MODEL DIFFERENCE", hasDiff: false },
      authority: { research: false, maturity: "UNKNOWN", evAvailable: false },
      decision: {
        tier: "NO_MODEL",
        label: "NO MODEL",
        qualification: "NOT_EVALUATED",
      },
      quality: { marketUnresolved: false },
    };
  }

  const resolved = resolveBoardProjection(game);
  const projection = fbisProjection(game);
  const market = marketLines(game);
  const deltas = marketDeltas(game);
  const decision = buildDecisionPresentation(game);
  const when = formatBoardDate(game.start || game.startTime || game.kickoff);
  const awayAbbr = game.away?.abbr || game.away?.abbreviation || "AWAY";
  const homeAbbr = game.home?.abbr || game.home?.abbreviation || "HOME";

  const live = Boolean(
    game.status?.live || game.status === "live" || game.status === "halftime"
  );
  const final = Boolean(
    game.status?.completed || game.status === "final" || game.status === "completed"
  );

  let marketLabel = "OBSERVED MARKET";
  if (market.marketAvailable && market.marketRole === "EXECUTION_MARKET") {
    marketLabel = "BEST AVAILABLE";
  } else if (market.marketAvailable && market.marketRole === "CONSENSUS_MARKET") {
    marketLabel = "CONSENSUS";
  } else if (market.referenceOnly) {
    marketLabel = "REFERENCE ONLY";
  } else if (!market.marketAvailable) {
    marketLabel = "NO EXECUTABLE MARKET";
  }

  const spreadLabel = projection.available
    ? favoriteFairLabel(projection, awayAbbr, homeAbbr) ||
      spreadTeamLabel(projection.fairHomeSpread, awayAbbr, homeAbbr)
    : null;

  return {
    id: game.id,
    sport: game.sport || null,
    event: {
      live,
      final,
      status: game.status || null,
      statusDetail: game.statusDetail || game.status?.detail || null,
      venue: game.venue || null,
    },
    timing: {
      start: game.start || game.startTime || null,
      timeLine: when.timeLine || game.startCt || "—",
      dateLine: when.dateLine || "—",
      isToday: Boolean(when.isToday),
    },
    teams: {
      away: game.away || null,
      home: game.home || null,
      awayAbbr,
      homeAbbr,
      identityOk: Boolean(
        (game.away?.abbr || game.away?.name) && (game.home?.abbr || game.home?.name)
      ),
    },
    projection: {
      available: Boolean(projection.available),
      loading: Boolean(game.projectionLoading),
      away: round1(projection.away),
      home: round1(projection.home),
      total: round1(projection.fairTotal ?? projection.total),
      margin: round1(projection.margin),
      fairHomeSpread: projection.fairHomeSpread,
      spreadLabel,
      headlineLabel:
        projection.headlineLabel || (projection.research ? "FBIS RESEARCH" : "FBIS"),
      research: Boolean(projection.research),
      modelVersion: game.modelVersion || game.model?.version || null,
      modelId: game.modelId || game.model?.id || null,
      kind: resolved.displayKind || resolved.kind || null,
      state: resolved.state || null,
    },
    market: {
      available: Boolean(market.marketAvailable),
      referenceOnly: Boolean(market.referenceOnly),
      role: market.marketRole || null,
      label: marketLabel,
      book: market.book || null,
      spread: market.spread,
      total: market.total,
      spreadLabel: spreadTeamLabel(market.spread, awayAbbr, homeAbbr),
      homeMl: market.homeMl,
      awayMl: market.awayMl,
      emptyReason: market.marketAvailable
        ? null
        : market.referenceOnly
          ? "Reference market only — not from your configured execution books."
          : "No current executable market from your configured books.",
    },
    comparison: {
      label: decision.disagreementLabel,
      spreadDelta: deltas.spreadDelta == null ? null : round1(deltas.spreadDelta),
      totalDelta: deltas.totalDelta == null ? null : round1(deltas.totalDelta),
      hasDiff: deltas.spreadDelta != null || deltas.totalDelta != null,
    },
    authority: {
      maturity: decision.maturity,
      probabilityAuthority: decision.probabilityAuthority,
      evAvailable: decision.evAvailable,
      research: Boolean(projection.research || decision.maturity === "RESEARCH"),
    },
    decision: {
      tier: decision.tier,
      label: decision.label,
      pick: decision.pick,
      reason: decision.reason,
      qualification: decision.qualification,
      authorization: decision.authorization,
      evAvailable: decision.evAvailable,
      ev: decision.ev,
      risk: decision.risk,
      humanConfirmationRequired: decision.humanConfirmationRequired,
      mispriceState: decision.mispriceState,
      dqState: decision.dqState,
    },
    quality: {
      score: game.quality?.score ?? null,
      flags: game.quality?.flags || [],
      marketUnresolved: Boolean(game.marketUnresolved),
    },
    evidenceSummary: {
      projectionId: game.projectionId || game.publication?.projectionId || null,
      freezeId: game.freezeId || game.publication?.freezeId || null,
      publicationStatus: game.publicationStatus || null,
      gradeStatus: game.gradeStatus || null,
    },
    raw: game,
  };
}

export function buildBoardGameViewModels(games = []) {
  return (games || []).map(buildBoardGameViewModel);
}
