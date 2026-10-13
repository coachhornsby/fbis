/**
 * Tracker sheet receipt-clock resolution for executed bets (#959).
 * Authentic Placed At → ledger executedAt. Synthetic date-noon is transport-only
 * and must never claim prospective proof / CLV entry eligibility.
 */

import { parseHeritageTimestamp, wallTimeToUtcIso } from "./heritageSlip.js";

export const TRACKER_EXECUTED_AT_PROVENANCE = Object.freeze({
  TRACKER_PLACED_AT: "tracker-placed-at",
  SYNTHETIC_DATE_NOON: "synthetic-date-noon",
});

export function isAuthenticTrackerReceiptClock(provenance) {
  return provenance === TRACKER_EXECUTED_AT_PROVENANCE.TRACKER_PLACED_AT;
}

export function isSyntheticTrackerNoon(executedAt, date) {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return String(executedAt || "") === `${day}T12:00:00.000Z`;
}

function parseMeridiemClock(raw) {
  const s = String(raw || "").trim();
  // 2026-10-10 14:30 | 2026-10-10 2:30 PM | 10/10/2026 2:30pm
  let m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (!m) {
    m = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
    );
    if (m) {
      const [, mo, d, y, h, mi, sec, ap] = m;
      return {
        year: Number(y),
        month: Number(mo),
        day: Number(d),
        hour: Number(h),
        minute: Number(mi),
        second: Number(sec || 0),
        ampm: ap || null,
      };
    }
    return null;
  }
  const [, y, mo, d, h, mi, sec, ap] = m;
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(sec || 0),
    ampm: ap || null,
  };
}

function applyAmpm(hour, ampm) {
  if (!ampm) return hour;
  const ap = String(ampm).toUpperCase();
  const h = Number(hour);
  if (!Number.isFinite(h)) return null;
  if (ap === "AM") return h % 12;
  if (ap === "PM") return (h % 12) + 12;
  return h;
}

/**
 * Parse a tracker "Placed At" cell into a verified America/Chicago wall-time ISO.
 * Returns null when the stamp cannot be authenticated.
 */
export function parseTrackerPlacedAt(raw, { date = null, yearHint = null } = {}) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const isoMs = Date.parse(text);
  if (Number.isFinite(isoMs) && /[TZtz]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return { iso: new Date(isoMs).toISOString(), source: "iso" };
  }

  const clock = parseMeridiemClock(text);
  if (clock) {
    const hour = applyAmpm(clock.hour, clock.ampm);
    if (
      hour == null ||
      !clock.year ||
      !clock.month ||
      !clock.day ||
      clock.month < 1 ||
      clock.month > 12 ||
      clock.day < 1 ||
      clock.day > 31
    ) {
      return null;
    }
    return {
      iso: wallTimeToUtcIso(clock.year, clock.month, clock.day, hour, clock.minute),
      source: "sheet-wall-clock",
    };
  }

  const heritage = parseHeritageTimestamp(text, yearHint || String(date || "").slice(0, 4) || null);
  if (heritage?.iso) return { iso: heritage.iso, source: "heritage-style" };

  // Date-only cells are not receipt clocks.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return null;
}

/**
 * Resolve ledger executedAt from tracker Date + Placed At.
 * Synthetic noon remains the identity-stable fallback when Placed At is absent/unparseable,
 * but is explicitly non-prospective.
 */
export function resolveTrackerExecutedAt({ date, placedAtRaw, yearHint = null, nowIso = null } = {}) {
  const day = String(date || "").slice(0, 10);
  const noon = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00.000Z` : null;
  const parsed = parseTrackerPlacedAt(placedAtRaw, { date: day, yearHint });
  if (parsed?.iso) {
    return {
      executedAt: parsed.iso,
      placedAtIso: parsed.iso,
      provenance: TRACKER_EXECUTED_AT_PROVENANCE.TRACKER_PLACED_AT,
      syntheticNoon: false,
      prospectiveProofEligible: true,
      parseSource: parsed.source,
    };
  }
  return {
    executedAt: noon || String(nowIso || new Date().toISOString()),
    placedAtIso: null,
    provenance: TRACKER_EXECUTED_AT_PROVENANCE.SYNTHETIC_DATE_NOON,
    syntheticNoon: true,
    prospectiveProofEligible: false,
    parseSource: null,
  };
}

export function trackerCalibrationEligibility(provenance) {
  return isAuthenticTrackerReceiptClock(provenance)
    ? "INELIGIBLE - TRACKER SYNC UNVERIFIED"
    : "INELIGIBLE - SYNTHETIC_RECEIPT_CLOCK";
}

/**
 * One-way repair: synthetic noon may be replaced by an authenticated Placed At.
 * Never overwrite an already-authentic ledger clock from tracker replay.
 */
export function shouldRepairSyntheticTrackerClock(prior, nextResolved) {
  if (!prior || !nextResolved?.prospectiveProofEligible) return false;
  if (!isAuthenticTrackerReceiptClock(nextResolved.provenance)) return false;
  const priorProv =
    prior?.trackerMetadata?.executedAtProvenance ||
    prior?.trackerMetadata?.executed_at_provenance ||
    null;
  if (isAuthenticTrackerReceiptClock(priorProv)) return false;
  if (!isSyntheticTrackerNoon(prior.executedAt, prior.date || nextResolved.date)) return false;
  return String(prior.executedAt) !== String(nextResolved.executedAt);
}
