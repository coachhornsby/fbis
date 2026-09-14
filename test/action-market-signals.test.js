import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProviderSelection,
  extractProviderSignals,
  classifySampleQuality,
  detectReverseLineMove,
  deriveFbisMarketSignals,
  buildActionIntelligenceEnrichment,
  DEFAULT_SAMPLE_QUALITY_THRESHOLDS,
} from "../functions/lib/actionMarketSignals.js";

test("normalizeProviderSelection maps ACTION sharpSide tokens", () => {
  assert.equal(normalizeProviderSelection("spreadHome").selection, "HOME");
  assert.equal(normalizeProviderSelection("spreadAway").selection, "AWAY");
  assert.equal(normalizeProviderSelection("over").selection, "OVER");
  assert.equal(normalizeProviderSelection("under").market, "TOTAL");
});

test("extractProviderSignals never invents FBIS sharpLabel", () => {
  const s = extractProviderSignals({
    publicBetting: { sharpSide: "spreadHome", steamSide: "spreadHome" },
  });
  assert.equal(s.providerSharpSignal, "HOME");
  assert.equal(s.providerSteamSignal, "HOME");
  assert.equal(s.providerSignalSource, "ACTION");
  assert.equal(s.fbisSharpLabel, null);
});

test("classifySampleQuality uses documented configurable thresholds", () => {
  const low = classifySampleQuality({ trackedBetCount: 10, booksCount: 1 });
  assert.equal(low.sampleQuality, "LOW");
  const high = classifySampleQuality({
    trackedBetCount: DEFAULT_SAMPLE_QUALITY_THRESHOLDS.highBetCount,
    booksCount: DEFAULT_SAMPLE_QUALITY_THRESHOLDS.highBookCount,
  });
  assert.equal(high.sampleQuality, "HIGH");
  const unknown = classifySampleQuality({});
  assert.equal(unknown.sampleQuality, "UNKNOWN");
});

test("detectReverseLineMove requires tickets vs line opposition", () => {
  const hit = detectReverseLineMove({
    ticketPct: 70,
    moneyPct: 40,
    openLine: -3,
    currentLine: -1.5,
  });
  assert.equal(hit.signal, "REVERSE_LINE_MOVE");
  assert.equal(hit.ticket_side, "HOME");
  assert.ok(hit.evidence.length);

  const miss = detectReverseLineMove({
    ticketPct: 70,
    openLine: -3,
    currentLine: -4,
  });
  assert.equal(miss.signal, null);
});

test("POTENTIAL_SHARP_PATTERN requires multiple supporting conditions", () => {
  const weak = deriveFbisMarketSignals({
    ticketPct: 55,
    moneyPct: 70,
    moneyTicketGap: 15,
    sample: { sampleQuality: "UNKNOWN", evidence: [] },
  });
  assert.ok(!weak.signals.some((s) => s.code === "POTENTIAL_SHARP_PATTERN"));

  const strong = deriveFbisMarketSignals({
    ticketPct: 70,
    moneyPct: 40,
    moneyTicketGap: -30,
    openLine: -3,
    currentLine: -1,
    providerSignals: {
      providerSharpSignal: "AWAY",
      providerSharpRaw: "spreadAway",
      providerSignalSource: "ACTION",
    },
    sample: { sampleQuality: "HIGH", evidence: ["bets"] },
  });
  assert.ok(strong.signals.some((s) => s.code === "POTENTIAL_SHARP_PATTERN"));
  assert.ok(strong.signals.every((s) => Array.isArray(s.evidence)));
});

test("buildActionIntelligenceEnrichment keeps firewall gates false", () => {
  const e = buildActionIntelligenceEnrichment({
    publicBetting: { sharpSide: "over", betCount: 6000 },
    ticketPct: 40,
    moneyPct: 70,
    moneyTicketGap: 30,
    booksCount: 8,
  });
  assert.equal(e.sharpLabel, null);
  assert.equal(e.providerSharpSignal, "OVER");
  assert.equal(e.governance.canQualify, false);
  assert.equal(e.governance.canAuthorizeWager, false);
  assert.ok(e.marketSignal.contributions.length);
});
