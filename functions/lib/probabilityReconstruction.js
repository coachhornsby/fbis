/**
 * Historical probability reconstruction.
 * Never mutates original strategy_tickets rows.
 * Only pregame frozen inputs. Current weights and results are forbidden.
 */

import { expectedRoi, validAmericanOdds } from "./pricing.js";
import { validateCanonicalProbability } from "./probability.js";

export const RECONSTRUCTION_STATUS = {
  RECOVERED_VERIFIED: "RECOVERED_VERIFIED",
  UNRECOVERABLE: "UNRECOVERABLE",
  RECONSTRUCTION_BLOCKED: "RECONSTRUCTION_BLOCKED",
  STILL_INVALID: "STILL_INVALID",
};

export const RECONSTRUCTION_VERSION = "prob-recon-v1";

function parseTs(value) {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : null;
}

function freezeBeforeStart(snapshot) {
  const frozenAt = parseTs(snapshot?.frozenAt);
  const start = parseTs(snapshot?.start);
  if (frozenAt == null) return { ok: false, reason: "missing-freeze-timestamp" };
  if (start == null) return { ok: false, reason: "missing-game-start" };
  if (frozenAt >= start) return { ok: false, reason: "freeze-not-before-start" };
  return { ok: true, reason: null };
}

function sideModelProbability(snapshot, ticket) {
  const market = String(ticket.market || "");
  const side = String(ticket.side || "");
  if (market === "ML") {
    const home = validateCanonicalProbability(snapshot.pHomeFinal);
    if (!home.ok) return { ok: false, reason: home.reason || "missing-p-home-final", source: null };
    if (side === "HOME") return { ok: true, modelProbability: home.modelProbability, source: "frozen-p_home_final" };
    if (side === "AWAY") {
      return {
        ok: true,
        modelProbability: 1 - home.modelProbability,
        source: "frozen-1-p_home_final",
      };
    }
    return { ok: false, reason: "side-mismatch", source: null };
  }
  if (market === "F5 ML") {
    const home = validateCanonicalProbability(snapshot.palPHome ?? snapshot.f5HomeWin);
    if (!home.ok) return { ok: false, reason: "missing-frozen-f5-win-probability", source: null };
    if (side === "HOME") return { ok: true, modelProbability: home.modelProbability, source: "frozen-pal_p_home" };
    if (side === "AWAY") {
      return { ok: true, modelProbability: 1 - home.modelProbability, source: "frozen-1-pal_p_home" };
    }
    return { ok: false, reason: "side-mismatch", source: null };
  }
  if (market === "SPREAD") {
    const home = validateCanonicalProbability(snapshot.pSpreadHome);
    if (!home.ok) {
      return { ok: false, reason: "spread-probability-not-frozen", source: null, blocked: true };
    }
    if (side === "HOME") return { ok: true, modelProbability: home.modelProbability, source: "frozen-pSpreadHome" };
    if (side === "AWAY") {
      return { ok: true, modelProbability: 1 - home.modelProbability, source: "frozen-1-pSpreadHome" };
    }
    return { ok: false, reason: "side-mismatch", source: null };
  }
  if (market === "TOTAL") {
    const over = validateCanonicalProbability(snapshot.pOver);
    if (!over.ok) {
      return { ok: false, reason: "total-probability-not-frozen", source: null, blocked: true };
    }
    if (side === "OVER") return { ok: true, modelProbability: over.modelProbability, source: "frozen-pOver" };
    if (side === "UNDER") {
      return { ok: true, modelProbability: 1 - over.modelProbability, source: "frozen-1-pOver" };
    }
    return { ok: false, reason: "side-mismatch", source: null };
  }
  return { ok: false, reason: "unsupported-market", source: null, blocked: true };
}

export function reconstructTicketProbability(ticket, snapshot, { oddsSnapshot = null } = {}) {
  const original = ticket?.modelProbability ?? ticket?.fair ?? ticket?.traits?.modelProbability ?? ticket?.traits?.fair;
  const originalClass = original == null || original === "" ? "missing" : typeof original;
  if (!ticket) {
    return {
      status: RECONSTRUCTION_STATUS.UNRECOVERABLE,
      reconstructedModelProbability: null,
      reconstructionSource: null,
      expectedRoiRecomputed: null,
      reason: "missing-ticket",
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  if (!snapshot) {
    return {
      status: RECONSTRUCTION_STATUS.UNRECOVERABLE,
      reconstructedModelProbability: null,
      reconstructionSource: null,
      expectedRoiRecomputed: null,
      reason: "no-frozen-pregame-projection",
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  if (String(snapshot.gameId || snapshot.id || "") !== String(ticket.gameId || "")) {
    return {
      status: RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED,
      reconstructedModelProbability: null,
      reconstructionSource: null,
      expectedRoiRecomputed: null,
      reason: "snapshot-game-mismatch",
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  if (ticket.modelVersion && snapshot.modelVersion && String(ticket.modelVersion) !== String(snapshot.modelVersion)) {
    return {
      status: RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED,
      reconstructedModelProbability: null,
      reconstructionSource: null,
      expectedRoiRecomputed: null,
      reason: "model-version-mismatch",
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  const timing = freezeBeforeStart(snapshot);
  if (!timing.ok) {
    return {
      status: RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED,
      reconstructedModelProbability: null,
      reconstructionSource: null,
      expectedRoiRecomputed: null,
      reason: timing.reason,
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  const recovered = sideModelProbability(snapshot, ticket);
  if (!recovered.ok) {
    return {
      status: recovered.blocked ? RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED : RECONSTRUCTION_STATUS.UNRECOVERABLE,
      reconstructedModelProbability: null,
      reconstructionSource: recovered.source,
      expectedRoiRecomputed: null,
      reason: recovered.reason,
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
      oddsSnapshotUsed: Boolean(oddsSnapshot),
    };
  }
  const canonical = validateCanonicalProbability(recovered.modelProbability);
  if (!canonical.ok) {
    return {
      status: RECONSTRUCTION_STATUS.STILL_INVALID,
      reconstructedModelProbability: null,
      reconstructionSource: recovered.source,
      expectedRoiRecomputed: null,
      reason: canonical.reason,
      originalProbability: original ?? null,
      originalProbabilityType: originalClass,
    };
  }
  const price = ticket.pinPrice ?? ticket.benchmarkPrice ?? ticket.executionPrice;
  const roi = validAmericanOdds(price) ? expectedRoi(canonical.modelProbability, price) : null;
  return {
    status: RECONSTRUCTION_STATUS.RECOVERED_VERIFIED,
    reconstructedModelProbability: canonical.modelProbability,
    reconstructionSource: recovered.source,
    expectedRoiRecomputed: roi,
    reason: null,
    originalProbability: original ?? null,
    originalProbabilityType: originalClass,
    freezeId: snapshot.frozenAt || snapshot.id || null,
    sourceProjectionId: snapshot.gameId || snapshot.id || null,
  };
}

export function summarizeReconstructions(rows = []) {
  const xs = rows || [];
  const count = (status) => xs.filter((r) => r.status === status).length;
  const recovered = xs.filter((r) => r.status === RECONSTRUCTION_STATUS.RECOVERED_VERIFIED);
  const tally = (fn) => {
    const m = {};
    for (const r of recovered) {
      const k = fn(r) || "(none)";
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  };
  return {
    recoverableN: recovered.length,
    recoveredVerifiedN: count(RECONSTRUCTION_STATUS.RECOVERED_VERIFIED),
    unrecoverableN: count(RECONSTRUCTION_STATUS.UNRECOVERABLE),
    blockedN: count(RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED),
    stillInvalidN: count(RECONSTRUCTION_STATUS.STILL_INVALID),
    recoveredBySport: tally((r) => r.sport),
    recoveredByMarket: tally((r) => r.market),
    recoveredByDate: tally((r) => r.date),
    recoveredSettled: recovered.filter((r) => r.result === "WON" || r.result === "LOST").length,
    recoveredWon: recovered.filter((r) => r.result === "WON").length,
    recoveredLost: recovered.filter((r) => r.result === "LOST").length,
    recoveredOpenN: recovered.filter((r) => !r.result || r.result === "OPEN").length,
    recoveredClvN: recovered.filter((r) => r.clv != null && Number.isFinite(Number(r.clv))).length,
  };
}

export const UNRECOVERED_SEED_RECORD = "7-0";

export function sept1CohortLabel({
  recoveredN,
  wins,
  losses,
  probabilityVerifiedN,
  settledN,
  expectedN = 7,
} = {}) {
  const allVerified =
    recoveredN === expectedN &&
    probabilityVerifiedN === expectedN &&
    wins === 5 &&
    losses === 2 &&
    settledN === expectedN;
  if (allVerified) return `Prospective CONVICTION cohort: 5–2, N=${expectedN}`;
  if (wins === 5 && losses === 2 && probabilityVerifiedN < expectedN) {
    return "Operator reported 5–2; results recovered 5–2; probability integrity unresolved; excluded from calculated FBIS-HC-v1 performance";
  }
  return `Operator reported 5–2; recovered N=${recoveredN}; unreconciled`;
}
