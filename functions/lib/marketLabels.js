/**
 * Exact market-side labels from canonical team IDs + paired sides.
 * Never last-word truncation. Unresolved → TEAM MATCH UNRESOLVED, no price, no edge.
 */

import { pairSpreadSides, pairTotalSides, validAmerican } from "./books.js";
import { namesMatch } from "./match.js";

export const TEAM_MATCH_UNRESOLVED = "TEAM MATCH UNRESOLVED";

function fmtSpread(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

function fmtAmerican(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

function teamLabel(team) {
  if (!team) return null;
  const college = String(team.canonicalId || "").startsWith("cfb-") || String(team.canonicalId || "").startsWith("cbb-");
  if (college) return team.school || team.fullName || team.name || null;
  return team.fullName || team.name || team.school || null;
}

function lastWord(s) {
  const parts = String(s || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

export function isAmbiguousLastWord(label) {
  return /^(state|tech|forest)$/i.test(String(label || "").trim());
}

function bothCanonical(game) {
  return Boolean(game?.home?.canonicalId && game?.away?.canonicalId && game.home.canonicalId !== game.away.canonicalId);
}

function participantMatches(team, bookName) {
  if (!bookName) return true;
  return (
    namesMatch(team?.fullName, bookName) ||
    namesMatch(team?.name, bookName) ||
    namesMatch(team?.school, bookName) ||
    namesMatch(team?.abbr, bookName)
  );
}

export function attachMarketLabels(game) {
  const odds = game?.odds || {};
  const homeName = teamLabel(game.home);
  const awayName = teamLabel(game.away);
  const unresolved = {
    ok: false,
    reason: TEAM_MATCH_UNRESOLVED,
    spreadHome: { label: TEAM_MATCH_UNRESOLVED, price: null, point: null, bookParticipant: null },
    spreadAway: { label: TEAM_MATCH_UNRESOLVED, price: null, point: null, bookParticipant: null },
    mlHome: { label: TEAM_MATCH_UNRESOLVED, price: null, bookParticipant: null },
    mlAway: { label: TEAM_MATCH_UNRESOLVED, price: null, bookParticipant: null },
    totalOver: { label: null, price: null, point: null },
    totalUnder: { label: null, price: null, point: null },
  };
  if (!bothCanonical(game)) {
    return { ...game, marketLabels: unresolved, marketUnresolved: true };
  }

  const pinSpread = odds.pinSpread ?? odds.spread;
  const pinTotal = odds.pinTotal ?? odds.total;
  const spreadHomePt = pinSpread;
  const spreadAwayPt = pinSpread == null ? null : -Number(pinSpread);
  const spreadOppositeOk = spreadHomePt == null || spreadAwayPt == null || Number(spreadHomePt) === -Number(spreadAwayPt);
  if (!spreadOppositeOk) {
    return { ...game, marketLabels: unresolved, marketUnresolved: true };
  }

  const homeBook = odds.homeBookName || game.parlayHomeName || null;
  const awayBook = odds.awayBookName || game.parlayAwayName || null;
  if (homeBook && awayBook && (!participantMatches(game.home, homeBook) || !participantMatches(game.away, awayBook))) {
    return { ...game, marketLabels: unresolved, marketUnresolved: true };
  }

  const mlHomePrice = odds.pinHomeMl ?? odds.fairHomeMl ?? odds.homeMl;
  const mlAwayPrice = odds.pinAwayMl ?? odds.fairAwayMl ?? odds.awayMl;
  const spreadHomePrice = odds.pinSpreadHomePrice ?? odds.spreadPrice ?? null;
  const spreadAwayPrice = odds.pinSpreadAwayPrice ?? null;
  const overPrice = odds.pinOverPrice ?? odds.totalPrice ?? null;
  const underPrice = odds.pinUnderPrice ?? null;

  const labels = {
    ok: true,
    reason: null,
    spreadHome: spreadHomePt == null
      ? { label: null, price: null, point: null, bookParticipant: homeBook }
      : {
          label: `${homeName} ${fmtSpread(spreadHomePt)}`,
          price: spreadHomePrice,
          point: Number(spreadHomePt),
          bookParticipant: homeBook,
          teamId: game.home.canonicalId,
        },
    spreadAway: spreadAwayPt == null
      ? { label: null, price: null, point: null, bookParticipant: awayBook }
      : {
          label: `${awayName} ${fmtSpread(spreadAwayPt)}`,
          price: spreadAwayPrice,
          point: Number(spreadAwayPt),
          teamId: game.away.canonicalId,
          bookParticipant: awayBook,
        },
    mlHome: {
      label: mlHomePrice == null ? homeName : `${homeName} ${fmtAmerican(mlHomePrice)}`,
      price: mlHomePrice ?? null,
      teamId: game.home.canonicalId,
      bookParticipant: homeBook,
    },
    mlAway: {
      label: mlAwayPrice == null ? awayName : `${awayName} ${fmtAmerican(mlAwayPrice)}`,
      price: mlAwayPrice ?? null,
      teamId: game.away.canonicalId,
      bookParticipant: awayBook,
    },
    totalOver: pinTotal == null
      ? { label: null, price: null, point: null }
      : { label: `Over ${pinTotal}`, price: overPrice, point: Number(pinTotal) },
    totalUnder: pinTotal == null
      ? { label: null, price: null, point: null }
      : { label: `Under ${pinTotal}`, price: underPrice, point: Number(pinTotal) },
  };

  for (const side of ["spreadHome", "spreadAway"]) {
    const word = lastWord(String(labels[side].label || "").replace(/[+\-−]?\d+(\.\d+)?$/, "").trim());
    if (isAmbiguousLastWord(word) && homeName && awayName) {
      labels[side].label = side === "spreadHome"
        ? `${homeName} ${fmtSpread(spreadHomePt)}`
        : `${awayName} ${fmtSpread(spreadAwayPt)}`;
    }
  }

  const details = labels.spreadHome.label || labels.mlHome.label || "";
  return {
    ...game,
    marketLabels: labels,
    marketUnresolved: false,
    odds: {
      ...odds,
      details,
      bookHomeName: homeName,
      bookAwayName: awayName,
    },
  };
}

export function pairOrUnresolved(homeRows, awayRows) {
  const paired = pairSpreadSides(homeRows, awayRows);
  if (!paired) return { ok: false, reason: TEAM_MATCH_UNRESOLVED, pair: null };
  if (Number(paired.home.point) !== -Number(paired.away.point)) {
    return { ok: false, reason: TEAM_MATCH_UNRESOLVED, pair: null };
  }
  return { ok: true, pair: paired };
}

export function pairTotalsOrUnresolved(overRows, underRows) {
  const paired = pairTotalSides(overRows, underRows);
  if (!paired) return { ok: false, reason: TEAM_MATCH_UNRESOLVED, pair: null };
  if (Number(paired.over.point) !== Number(paired.under.point)) {
    return { ok: false, reason: TEAM_MATCH_UNRESOLVED, pair: null };
  }
  if (!validAmerican(paired.over.price) || !validAmerican(paired.under.price)) {
    return { ok: false, reason: TEAM_MATCH_UNRESOLVED, pair: null };
  }
  return { ok: true, pair: paired };
}

export function canPriceMarket(game) {
  return Boolean(game?.marketLabels?.ok) && !game?.marketUnresolved;
}
