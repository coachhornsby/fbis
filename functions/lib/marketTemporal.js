/** Market clocks are evidence, not wagering authority. Collection never refreshes source time. */
export const MARKET_TIME_POLICY = Object.freeze({
  "Polymarket US": Object.freeze({ maxAgeMs: 15 * 60 * 1000, skewMs: 0 }),
  "Polymarket US WebSocket": Object.freeze({ maxAgeMs: 15 * 60 * 1000, skewMs: 0 }),
  PinnOdds: Object.freeze({ maxAgeMs: 45 * 60 * 1000, skewMs: 0 }),
});
const clock = value => value == null || value === "" ? null : Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;

export function providerObservationTime(offer = {}) {
  // An explicit null is meaningful. These adapters only know when FBIS received a quote.
  for (const key of ["providerObservedAt", "sourceObservedAt"]) {
    if (Object.hasOwn(offer, key)) return offer[key] || null;
    if (offer.raw && Object.hasOwn(offer.raw, key)) return offer.raw[key] || null;
  }
  if (/^Polymarket US/.test(offer.source || "")) return null;
  return offer.fetchedAt || null; // Existing sportsbook adapter source-clock contract.
}

export function marketTemporalStatus({ source, providerObservedAt, collectedAt, eventId,
  eventStartAt = null, projectionAsOf = null }, { now = new Date(), maxAgeMs, skewMs } = {}) {
  const policy = MARKET_TIME_POLICY[source] || { maxAgeMs: 15 * 60 * 1000, skewMs: 0 };
  const ageLimit = maxAgeMs ?? policy.maxAgeMs, skew = skewMs ?? policy.skewMs;
  const checked = clock(now instanceof Date ? (Number.isFinite(now.getTime()) ? now.toISOString() : "invalid") : now);
  const observed = clock(providerObservedAt), collected = clock(collectedAt);
  const start = clock(eventStartAt), asOf = clock(projectionAsOf);
  let status;
  if (![checked, collected].every(Number.isFinite) || [observed, start, asOf].some(Number.isNaN) ||
      !Number.isFinite(ageLimit) || ageLimit <= 0 || !Number.isFinite(skew) || skew < 0) status = "INVALID";
  else if (collected > checked + skew || (observed != null && (observed > checked + skew || observed > collected + skew))) status = "FUTURE_CLOCK";
  else if (!eventId) status = "UNMATCHED";
  else if (observed == null) status = "SOURCE_TIME_UNKNOWN";
  else if (checked - observed > ageLimit || checked - collected > ageLimit) status = "STALE";
  else status = "CURRENT";
  const valid = !["INVALID", "FUTURE_CLOCK", "UNMATCHED"].includes(status);
  const preEvent = start != null && collected < start && (observed == null || observed < start);
  const prospective = status === "CURRENT" && preEvent && asOf != null && collected <= asOf && observed <= asOf && asOf < start;
  return { status, providerObservedAt: providerObservedAt || null, collectedAt: collectedAt || null,
    displayCheckedAt: new Date(checked || 0).toISOString(), providerTimeConfidence: observed == null ? "UNKNOWN" : "PROVIDER_REPORTED",
    sourceObservationLagMs: Number.isFinite(observed) && Number.isFinite(collected) ? collected - observed : null,
    collectionLagMs: Number.isFinite(checked) && Number.isFinite(collected) ? checked - collected : null,
    researchEligible: valid, currentDisplayEligible: valid && checked - collected <= ageLimit && ["CURRENT", "SOURCE_TIME_UNKNOWN"].includes(status),
    prospectiveEvidenceEligible: prospective, modelInputEligible: prospective, wagerQualificationEligible: false };
}
