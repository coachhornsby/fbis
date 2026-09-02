/**
 * Canonical model-probability contract.
 *
 * Stored probability is a decimal in (0, 1) exclusive.
 * Percentage formatting happens only at the UI boundary.
 * Missing values never become zero. Strings are accepted only after explicit
 * finite-number parsing. No automatic /100 unless the source field is
 * versioned as percentage units.
 */

export const PROBABILITY_SCHEMA_VERSION = "prob-decimal-v1";
export const EXPECTED_ROI_FORMULA_VERSION = "roi-american-v1";
export const EXPECTED_ROI_TOLERANCE = 1e-6;

export const PROBABILITY_UNITS = {
  DECIMAL: "decimal-probability",
  PERCENT: "percent-0-100",
};

export function parseFiniteNumber(value) {
  if (value == null) return { ok: false, value: null, reason: "missing" };
  if (typeof value === "boolean") return { ok: false, value: null, reason: "non-numeric" };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { ok: false, value: null, reason: "empty-string" };
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false, value: null, reason: "non-numeric" };
    return { ok: true, value: n, reason: null };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, value: null, reason: Number.isNaN(value) ? "nan" : "infinite" };
    }
    return { ok: true, value, reason: null };
  }
  return { ok: false, value: null, reason: "non-numeric" };
}

/**
 * Canonical stored probability: exclusive (0, 1).
 * Rejects 0, 1, negatives, percentages such as 57.2, NaN, Inf, and missing.
 */
export function validateCanonicalProbability(value) {
  const parsed = parseFiniteNumber(value);
  if (!parsed.ok) {
    return {
      ok: false,
      modelProbability: null,
      reason: parsed.reason || "invalid",
      schemaVersion: PROBABILITY_SCHEMA_VERSION,
    };
  }
  const p = parsed.value;
  if (p <= 0) {
    return {
      ok: false,
      modelProbability: null,
      reason: p < 0 ? "negative" : "zero",
      schemaVersion: PROBABILITY_SCHEMA_VERSION,
    };
  }
  if (p >= 1) {
    return {
      ok: false,
      modelProbability: null,
      reason: p === 1 ? "exactly-1" : p <= 100 ? "percent-or-gt-1" : "greater-than-100",
      schemaVersion: PROBABILITY_SCHEMA_VERSION,
    };
  }
  return {
    ok: true,
    modelProbability: p,
    reason: null,
    schemaVersion: PROBABILITY_SCHEMA_VERSION,
  };
}

/**
 * Normalize a source value into canonical decimal probability.
 * Automatic /100 is forbidden unless sourceUnits is explicitly PERCENT.
 */
export function normalizeModelProbability(value, { sourceUnits = PROBABILITY_UNITS.DECIMAL } = {}) {
  const parsed = parseFiniteNumber(value);
  if (!parsed.ok) {
    return { ok: false, modelProbability: null, reason: parsed.reason, converted: false };
  }
  if (sourceUnits === PROBABILITY_UNITS.PERCENT) {
    const decimal = parsed.value / 100;
    const validated = validateCanonicalProbability(decimal);
    return { ...validated, converted: true, sourceUnits };
  }
  return { ...validateCanonicalProbability(parsed.value), converted: false, sourceUnits };
}

export function formatModelProbabilityPct(modelProbability) {
  const validated = validateCanonicalProbability(modelProbability);
  if (!validated.ok) return null;
  return validated.modelProbability * 100;
}

export function formatExpectedRoiPct(expectedRoi) {
  const n = Number(expectedRoi);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

export function canonicalProbabilityFields(modelProbability) {
  const validated = validateCanonicalProbability(modelProbability);
  if (!validated.ok) {
    return {
      modelProbability: null,
      modelProbabilityPct: null,
      probabilitySchemaVersion: PROBABILITY_SCHEMA_VERSION,
      valid: false,
      reason: validated.reason,
    };
  }
  return {
    modelProbability: validated.modelProbability,
    modelProbabilityPct: formatModelProbabilityPct(validated.modelProbability),
    probabilitySchemaVersion: PROBABILITY_SCHEMA_VERSION,
    valid: true,
    reason: null,
  };
}

/**
 * Single read path used by qualification, API, EV audit, and recompute.
 * Canonical column first, then explicit aliases that already mean decimal p.
 * Does not invent a value from EV, implied odds, or favorite flags.
 */
export function readCanonicalProbability(ticket = {}) {
  const traits = ticket.traits && typeof ticket.traits === "object" ? ticket.traits : {};
  const candidates = [
    ticket.modelProbability,
    ticket.model_probability,
    traits.modelProbability,
    ticket.fair,
    traits.fair,
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const validated = validateCanonicalProbability(candidate);
    if (validated.ok) return { ...validated, source: "canonical" };
    return { ...validated, source: "invalid-stored" };
  }
  return {
    ok: false,
    modelProbability: null,
    reason: "missing",
    schemaVersion: PROBABILITY_SCHEMA_VERSION,
    source: "missing",
  };
}

export function expectedRoiMatches(stored, recomputed, tolerance = EXPECTED_ROI_TOLERANCE) {
  if (stored == null || recomputed == null) return false;
  const a = Number(stored);
  const b = Number(recomputed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

export function classifyRawProbability(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.trim() === "") return "empty-string";
    const n = Number(value);
    if (!Number.isFinite(n)) return "non-numeric";
    return classifyNumericProbability(n);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return "infinite";
    return classifyNumericProbability(value);
  }
  return "non-numeric";
}

function classifyNumericProbability(n) {
  if (n < 0) return "negative";
  if (n === 0) return "zero";
  if (n > 0 && n < 1) return "between-0-and-1";
  if (n === 1) return "exactly-1";
  if (n > 1 && n <= 100) return "greater-than-1-at-most-100";
  if (n > 100) return "greater-than-100";
  return "non-numeric";
}
