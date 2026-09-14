/**
 * Advanced game-detail presentation view-model (mockup Overview + tabs).
 * Presentation only — never invents probabilities, EV, confidence, or sharp labels.
 */

import { buildGameCardViewModel } from "./gameCardViewModel.js";

export const ADVANCED_TABS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "model", label: "Model" },
  { id: "action", label: "Action Intel" },
  { id: "market", label: "Market" },
  { id: "matchup", label: "Matchup" },
  { id: "weather", label: "Weather" },
  { id: "injuries", label: "Injuries" },
  { id: "lineHistory", label: "Line History" },
  { id: "projections", label: "Projections" },
  { id: "trends", label: "Trends" },
  { id: "bettingSplits", label: "Betting Splits" },
]);

export function buildAdvancedGameViewModel(game) {
  const card = buildGameCardViewModel(game);
  if (!card?.id && !game?.id) return null;

  const away = card.away;
  const home = card.home;
  const units = card.units || {};
  const cmp = card.comparison || {};
  const action = card.action || {};
  const ctx = card.context || {};

  return {
    card,
    sport: card.sport,
    away,
    home,
    units,
    status: card.status || {},
    matchupLabel: `${away?.abbr || "AWAY"} @ ${home?.abbr || "HOME"}`,
    timeLine: card.timing?.timeLine || "—",
    venueLine: ctx.venueLabel || ctx.venueName || null,
    weatherLine: ctx.weatherLine || null,
    windLabel: ctx.weather?.windLabel || null,
    tabs: ADVANCED_TABS,
    takeaways: buildTakeaways({ card, action, cmp, units, away, home }),
    projectedScores: {
      available: Boolean(card.projection?.available),
      away: card.projection?.available ? card.projection.away : null,
      home: card.projection?.available ? card.projection.home : null,
      total: card.projection?.available ? card.projection.total : null,
      label: units.projectedLabel || "FBIS PROJECTED",
    },
    probabilities: buildProbabilities(game, card),
    lineHistory: buildLineHistory(game, action, home),
    bettingSplits: {
      available: Boolean(action.tickets || action.money),
      tickets: action.tickets || null,
      money: action.money || null,
    },
    action,
    comparison: cmp,
    context: ctx,
    market: card.market || null,
    marketCopy: card.marketCopy || null,
    freshness: card.freshness || null,
    decision: card.decision || null,
    authority: card.authority || null,
    injuries: extractInjuries(game),
    footer: buildAdvancedFooter(card),
  };
}

function buildProbabilities(game, card) {
  const showFair = Boolean(
    game?.model?.showFairProbability ||
      game?.showFairProbability ||
      card.authority?.probabilityAuthority
  );

  const homeWin = num(
    game?.model?.pHome ??
      game?.model?.winProbabilityHome ??
      game?.projection?.pHome ??
      game?.winProbability?.home
  );
  const awayWin =
    num(game?.model?.pAway ?? game?.model?.winProbabilityAway ?? game?.winProbability?.away) ??
    (homeWin != null ? 1 - homeWin : null);

  const homeCover = num(
    game?.model?.pCoverHome ?? game?.coverProbability?.home ?? game?.projection?.pCoverHome
  );
  const awayCover =
    num(game?.model?.pCoverAway ?? game?.coverProbability?.away) ??
    (homeCover != null ? 1 - homeCover : null);

  const overProb = num(game?.model?.pOver ?? game?.totalProbability?.over);
  const underProb =
    num(game?.model?.pUnder ?? game?.totalProbability?.under) ??
    (overProb != null ? 1 - overProb : null);

  const ev =
    card.decision?.evAvailable && card.decision?.ev != null
      ? Number(card.decision.ev)
      : null;

  const confidence = num(
    game?.quality?.modelQuality ?? game?.quality?.score ?? game?.model?.confidence
  );

  return {
    win:
      showFair && homeWin != null && awayWin != null
        ? { available: true, awayPct: toPct(awayWin), homePct: toPct(homeWin) }
        : {
            available: false,
            reason: "Win probability not published for this projection",
          },
    cover:
      homeCover != null && awayCover != null
        ? { available: true, awayPct: toPct(awayCover), homePct: toPct(homeCover) }
        : { available: false, reason: "Cover probability not published" },
    ev: {
      available: ev != null,
      valuePct: ev,
      pick: card.decision?.pick || null,
      reason: ev == null ? "EV not available (research / no calibrated edge)" : null,
    },
    confidence:
      confidence != null
        ? {
            available: true,
            score: Math.round(confidence <= 1 ? confidence * 100 : confidence),
            label: confidenceLabel(confidence <= 1 ? confidence * 100 : confidence),
          }
        : { available: false, reason: "Model confidence not published" },
    total: {
      available: card.projection?.total != null,
      total: card.projection?.total ?? null,
      overPct: overProb != null ? toPct(overProb) : null,
      underPct: underProb != null ? toPct(underProb) : null,
      reason: overProb == null ? "Over/under probabilities not published" : null,
    },
  };
}

function buildLineHistory(game, action, home) {
  const ticks =
    game?.actionIntel?.movement?.history ||
    game?.actionIntel?.lineHistory ||
    game?.lineHistory ||
    game?.actionIntel?.movement?.ticks ||
    null;

  const points = [];
  if (Array.isArray(ticks) && ticks.length) {
    for (const t of ticks) {
      const line = num(t.line ?? t.spreadHome ?? t.spread ?? t.value);
      if (line == null) continue;
      points.push({
        at: t.at || t.ts || t.observedAt || t.t || null,
        label: t.label || formatTickLabel(t.at || t.ts),
        line,
      });
    }
  }

  if (points.length < 2 && action?.movement) {
    const open = num(action.movement.open);
    const curr = num(action.movement.current);
    if (open != null) points.push({ at: null, label: "Open", line: open });
    if (curr != null) points.push({ at: null, label: "Now", line: curr });
  }

  const focusAbbr = home?.abbr || "HOME";
  return {
    available: points.length >= 2,
    market: "spread",
    focusAbbr,
    title: `Spread (${focusAbbr})`,
    points,
    emptyReason:
      points.length < 2 ? "Line history not available from ACTION yet" : null,
  };
}

function buildTakeaways({ card, action, cmp, units, away, home }) {
  const out = [];
  const unit = String(units.shortUnit || "PTS").toLowerCase();

  if (action?.headline?.kind === "PROVIDER_SHARP") {
    out.push({
      tone: "sharp",
      icon: "🎯",
      text: `${action.headline.lineLabel || action.headline.team?.abbr || "Side"} — ACTION sharp money detected`,
    });
  } else if (action?.headline?.kind === "MONEY_GAP" && action.headline?.lineLabel) {
    out.push({
      tone: "money",
      icon: "🎯",
      text: `${action.headline.lineLabel} — ${action.headline.detail || "LARGER BETS DETECTED"}`,
    });
  }

  if (cmp.sideRelationship === "OPPOSITE_SIDES" && cmp.sideDiff != null) {
    out.push({
      tone: "diff",
      icon: "📊",
      text: `${round1(cmp.sideDiff)} ${unit} disagreement — FBIS and market on opposite sides`,
    });
  }

  if (cmp.totalDirection === "FBIS_HIGHER" && cmp.fbisTotal != null && cmp.marketTotal != null) {
    out.push({
      tone: "up",
      icon: "↑",
      text: `FBIS higher total — ${cmp.fbisTotal} vs ${cmp.marketTotal}${
        cmp.totalDiffLabel ? ` (${cmp.totalDiffLabel})` : ""
      }`,
    });
  } else if (
    cmp.totalDirection === "FBIS_LOWER" &&
    cmp.fbisTotal != null &&
    cmp.marketTotal != null
  ) {
    out.push({
      tone: "down",
      icon: "↓",
      text: `FBIS lower total — ${cmp.fbisTotal} vs ${cmp.marketTotal}${
        cmp.totalDiffLabel ? ` (${cmp.totalDiffLabel})` : ""
      }`,
    });
  }

  if (action?.money?.homePct != null) {
    const leanHome = action.money.homePct >= 50;
    const pctLean = leanHome ? action.money.homePct : action.money.awayPct;
    const abbr = leanHome ? home?.abbr : away?.abbr;
    const other = leanHome ? away?.abbr : home?.abbr;
    const otherPct = leanHome ? action.money.awayPct : action.money.homePct;
    if (pctLean >= 60) {
      out.push({
        tone: "splits",
        icon: "👥",
        text: `Significant money imbalance — ${pctLean}% on ${abbr} (${otherPct}% ${other})`,
      });
    }
  }

  if (
    action?.lineMove?.label &&
    action.lineMove.delta != null &&
    Math.abs(action.lineMove.delta) >= 0.5
  ) {
    out.push({
      tone: "move",
      icon: "📈",
      text: `Line moved — ${action.lineMove.label}${
        action.lineMove.deltaLabel ? ` (${action.lineMove.deltaLabel})` : ""
      }`,
    });
  }

  if (!out.length) {
    if (card.projection?.research) {
      out.push({
        tone: "research",
        icon: "🧪",
        text: "Research projection — display only, not wager-authorized",
      });
    } else if (!action?.available) {
      out.push({
        tone: "empty",
        icon: "ℹ️",
        text: "No ACTION intel on this slate yet",
      });
    } else {
      out.push({
        tone: "neutral",
        icon: "ℹ️",
        text: "No standout model–market or ACTION signals right now",
      });
    }
  }

  return out;
}

function buildAdvancedFooter(card) {
  return {
    asOfLabel: card.footer?.asOfLabel || "Data timestamp unavailable",
    sources: [
      "FBIS",
      card.marketCopy?.primary || card.footer?.marketSourceLabel || "Market",
      card.action?.available ? "ACTION" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function extractInjuries(game) {
  const rows = game?.injuries || game?.injuryReport || game?.context?.injuries || null;
  if (!Array.isArray(rows) || !rows.length) {
    return { available: false, rows: [], emptyReason: "Injury report not available" };
  }
  return {
    available: true,
    rows: rows.slice(0, 20).map((r) => ({
      team: r.team || r.teamAbbr || null,
      player: r.player || r.name || "—",
      status: r.status || r.designation || "—",
      detail: r.detail || r.injury || null,
    })),
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPct(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  const v = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function confidenceLabel(score) {
  const s = Number(score);
  if (s >= 80) return "High";
  if (s >= 55) return "Moderate";
  if (s >= 35) return "Low";
  return "Very low";
}

function formatTickLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
