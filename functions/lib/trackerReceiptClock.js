/**
 * Tracker sheet receipt-clock resolution for executed bets (#959).
 * Authentic Placed At → ledger executedAt. Synthetic date-noon is transport-only
 * and must never claim prospective proof / CLV entry eligibility.
 *
 * Timezone rules:
 * - ISO with Z or ±offset → absolute instant
 * - Timezone-less stamps → America/Chicago wall time (never JS UTC default)
 * - Invalid calendar dates, DST gaps, and ambiguous fall-back walls → reject
 */

import { parseHeritageTimestamp } from "./heritageSlip.js";

export const TRACKER_EXECUTED_AT_PROVENANCE = Object.freeze({
  TRACKER_PLACED_AT: "tracker-placed-at",
  SYNTHETIC_DATE_NOON: "synthetic-date-noon",
});

const CHICAGO = "America/Chicago";

export function isAuthenticTrackerReceiptClock(provenance) {
  return provenance === TRACKER_EXECUTED_AT_PROVENANCE.TRACKER_PLACED_AT;
}

export function isSyntheticTrackerNoon(executedAt, date) {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return String(executedAt || "") === `${day}T12:00:00.000Z`;
}

/** True only when the stamp carries Z or a numeric UTC offset. */
export function hasExplicitTimezone(text) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(text || "").trim());
}

function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function chicagoParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function sameWall(parts, year, month, day, hour, minute, second) {
  return (
    parts.year === year &&
    parts.month === month &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute &&
    parts.second === second
  );
}

/**
 * Convert a validated Chicago wall clock to UTC ISO, preserving seconds.
 * Rejects invalid calendar dates, DST spring-forward gaps, and ambiguous fall-back walls.
 */
export function chicagoWallToUtcIso(year, month, day, hour, minute, second = 0) {
  if (!isValidCalendarDate(year, month, day)) return null;
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const local = chicagoParts(utc);
    const localMs = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += wanted - localMs;
  }

  // Round-trip: nonexistent spring-forward walls fail here.
  if (!sameWall(chicagoParts(utc), year, month, day, hour, minute, second)) return null;

  // Ambiguous fall-back: another UTC ~1h away maps to the same local wall.
  // Without an explicit offset we refuse to pick which occurrence.
  if (
    sameWall(chicagoParts(utc - 3600_000), year, month, day, hour, minute, second) ||
    sameWall(chicagoParts(utc + 3600_000), year, month, day, hour, minute, second)
  ) {
    return null;
  }

  return new Date(utc).toISOString();
}

function parseMeridiemClock(raw) {
  const s = String(raw || "").trim();
  // 2026-10-10 14:30[:ss] [AM|PM] | 2026-10-10T14:30[:ss] (timezone-less)
  let m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (m) {
    const [, y, mo, d, h, mi, sec, ap] = m;
    return {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h),
      minute: Number(mi),
      second: sec == null ? 0 : Number(sec),
      ampm: ap || null,
    };
  }
  m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (!m) return null;
  const [, mo, d, y, h, mi, sec, ap] = m;
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: sec == null ? 0 : Number(sec),
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

function heritageWallComponents(raw, yearHint) {
  const s = String(raw || "");
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const parsed = parseHeritageTimestamp(raw, yearHint);
  if (!parsed?.date || !parsed?.iso) return null;
  // Re-parse components; heritage helper drops seconds — recover when present.
  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const month = months[m[1].toLowerCase()];
  if (!month) return null;
  return {
    year: Number(m[3] || yearHint || parsed.date.slice(0, 4)),
    month,
    day: Number(m[2]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] == null ? 0 : Number(m[6]),
  };
}

/**
 * Parse a tracker "Placed At" cell into a verified ISO instant.
 * Returns null when the stamp cannot be authenticated without ambiguity.
 */
export function parseTrackerPlacedAt(raw, { date = null, yearHint = null } = {}) {
  const text = String(raw || "").trim();
  if (!text) return null;

  // Absolute ISO only when Z / numeric offset is present — never treat bare T as UTC.
  if (hasExplicitTimezone(text)) {
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return null;
    return { iso: new Date(ms).toISOString(), source: "iso-offset" };
  }

  const clock = parseMeridiemClock(text);
  if (clock) {
    const hour = applyAmpm(clock.hour, clock.ampm);
    if (hour == null) return null;
    const iso = chicagoWallToUtcIso(
      clock.year,
      clock.month,
      clock.day,
      hour,
      clock.minute,
      clock.second
    );
    if (!iso) return null;
    return { iso, source: "chicago-wall-clock" };
  }

  const heritage = heritageWallComponents(
    text,
    yearHint || String(date || "").slice(0, 4) || null
  );
  if (heritage) {
    const iso = chicagoWallToUtcIso(
      heritage.year,
      heritage.month,
      heritage.day,
      heritage.hour,
      heritage.minute,
      heritage.second
    );
    if (!iso) return null;
    return { iso, source: "heritage-style" };
  }

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
      // Valid sheet clock for timing cutoffs only — not independent sportsbook receipt proof.
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
  // Authenticated sheet Placed At still leaves tracker sync outside sportsbook receipt proof.
  return isAuthenticTrackerReceiptClock(provenance)
    ? "INELIGIBLE - TRACKER SYNC UNVERIFIED"
    : "INELIGIBLE - SYNTHETIC_RECEIPT_CLOCK";
}

/**
 * Derive receipt-clock fields from validated Placed At only.
 * Caller-supplied provenance / eligibility flags never upgrade the result.
 */
export function applyValidatedTrackerReceiptClock(ticket, { nowIso = null } = {}) {
  const meta = ticket?.trackerMetadata || {};
  const placedAtRaw = meta.placedAt != null ? String(meta.placedAt) : "";
  const clock = resolveTrackerExecutedAt({
    date: ticket?.date,
    placedAtRaw,
    nowIso,
  });
  return {
    executedAt: clock.executedAt,
    trackerMetadata: {
      ...meta,
      placedAt: placedAtRaw,
      placedAtIso: clock.placedAtIso,
      executedAtProvenance: clock.provenance,
      prospectiveProofEligible: clock.prospectiveProofEligible,
      calibrationEligibility: trackerCalibrationEligibility(clock.provenance),
    },
    clock,
  };
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
