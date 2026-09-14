/**
 * FBIS-derived ACTION market signals + sample quality.
 *
 * Provider sharp/steam are preserved as ACTION-sourced labels only.
 * FBIS-derived patterns are separate, evidence-backed, and never
 * relabeled as provider facts. Never enters PURE. Never qualifies.
 */

import { ACTION_FIREWALL } from "./actionObservationSeries.js";
import { deriveBookDisagreement, deriveLineMovement } from "./actionMarketDerivatives.js";

/** Documented defaults — tune via config after validation; do not hard-bake into qualify. */
export const DEFAULT_SAMPLE_QUALITY_THRESHOLDS = Object.freeze({
  highBetCount: 5000,
  mediumBetCount: 500,
  highBookCount: 8,
  mediumBookCount: 3,
  highVolume: 250000,
  mediumVolume: 25000,
});

/** Documented defaults for divergence / RLM research signals. */
export const DEFAULT_SIGNAL_THRESHOLDS = Object.freeze({
  moneyTicketDivergencePct: 12,
  publicHeavyTicketPct: 65,
  moneyHeavyMoneyPct: 65,
  reverseLineMovePts: 0.5,
  wideLineRangePts: 1.5,
  lateMoveHours: 6,
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Map ACTION sharpSide / steamSide tokens onto board selection labels.
 * Examples: spreadHome → HOME, spreadAway → AWAY, over → OVER, under → UNDER.
 */
export function normalizeProviderSelection(raw) {
  const s = str(raw);
  if (!s) return null;
  const k = s.replace(/[\s_-]+/g, "").toLowerCase();
  if (k === "home" || k === "spreadhome" || k === "mlhome" || k === "moneylinehome") {
    return { selection: "HOME", market: k.includes("ml") || k.includes("money") ? "ML" : "RL" };
  }
  if (k === "away" || k === "spreadaway" || k === "mlaway" || k === "moneylineaway") {
    return { selection: "AWAY", market: k.includes("ml") || k.includes("money") ? "ML" : "RL" };
  }
  if (k === "over" || k === "totalover") return { selection: "OVER", market: "TOTAL" };
  if (k === "under" || k === "totalunder") return { selection: "UNDER", market: "TOTAL" };
  if (k.includes("spread") && k.includes("home")) return { selection: "HOME", market: "RL" };
  if (k.includes("spread") && k.includes("away")) return { selection: "AWAY", market: "RL" };
  if (k.includes("money") && k.includes("home")) return { selection: "HOME", market: "ML" };
  if (k.includes("money") && k.includes("away")) return { selection: "AWAY", market: "ML" };
  if (k.includes("over")) return { selection: "OVER", market: "TOTAL" };
  if (k.includes("under")) return { selection: "UNDER", market: "TOTAL" };
  return { selection: s.toUpperCase(), market: null };
}

/**
 * Extract provider-supplied sharp/steam without promoting them to FBIS truth.
 */
export function extractProviderSignals({
  publicBetting = null,
  research = null,
  lineMovement = null,
} = {}) {
  const pb = publicBetting && typeof publicBetting === "object" ? publicBetting : {};
  const researchObj = research && typeof research === "object" ? research : {};
  const lm = lineMovement && typeof lineMovement === "object" ? lineMovement : {};

  const sharpRaw =
    str(pb.sharpSide) ||
    str(pb.sharp_side) ||
    str(pb.providerSharpSignal) ||
    str(researchObj.sharpSide) ||
    str(researchObj.providerSharpSignal);
  const steamRaw =
    str(pb.steamSide) ||
    str(pb.steam_side) ||
    str(pb.providerSteamSignal) ||
    str(pb.steam) ||
    str(researchObj.steamSide) ||
    str(researchObj.providerSteamSignal) ||
    str(lm.steamSide) ||
    (pb.isSteam || researchObj.isSteam ? sharpRaw : null);

  const sharpNorm = sharpRaw ? normalizeProviderSelection(sharpRaw) : null;
  const steamNorm = steamRaw ? normalizeProviderSelection(steamRaw) : null;

  return {
    providerSharpSignal: sharpNorm?.selection || (sharpRaw ? String(sharpRaw).toUpperCase() : null),
    providerSharpMarket: sharpNorm?.market || null,
    providerSharpRaw: sharpRaw,
    providerSteamSignal: steamNorm?.selection || (steamRaw ? String(steamRaw).toUpperCase() : null),
    providerSteamMarket: steamNorm?.market || null,
    providerSteamRaw: steamRaw,
    providerSignalSource: sharpRaw || steamRaw ? "ACTION" : null,
    // FBIS never invents a sharp label from money/ticket alone.
    fbisSharpLabel: null,
  };
}

/**
 * Sample quality from legitimate provider coverage fields.
 * Thresholds are configurable; defaults are documented research defaults only.
 */
export function classifySampleQuality({
  trackedBetCount = null,
  trackedVolume = null,
  booksCount = null,
  thresholds = DEFAULT_SAMPLE_QUALITY_THRESHOLDS,
} = {}) {
  const bets = num(trackedBetCount);
  const volume = num(trackedVolume);
  const books = num(booksCount);
  const t = { ...DEFAULT_SAMPLE_QUALITY_THRESHOLDS, ...(thresholds || {}) };

  if (bets == null && volume == null && books == null) {
    return {
      sampleQuality: "UNKNOWN",
      trackedBetCount: null,
      trackedVolume: null,
      booksCount: books,
      evidence: ["No tracked bet count, volume, or book count supplied"],
      thresholdsUsed: t,
    };
  }

  let score = 0;
  const evidence = [];
  if (bets != null) {
    if (bets >= t.highBetCount) {
      score += 2;
      evidence.push(`trackedBetCount ${bets} ≥ ${t.highBetCount}`);
    } else if (bets >= t.mediumBetCount) {
      score += 1;
      evidence.push(`trackedBetCount ${bets} ≥ ${t.mediumBetCount}`);
    } else {
      evidence.push(`trackedBetCount ${bets} < ${t.mediumBetCount}`);
    }
  }
  if (volume != null) {
    if (volume >= t.highVolume) {
      score += 2;
      evidence.push(`trackedVolume ${volume} ≥ ${t.highVolume}`);
    } else if (volume >= t.mediumVolume) {
      score += 1;
      evidence.push(`trackedVolume ${volume} ≥ ${t.mediumVolume}`);
    } else {
      evidence.push(`trackedVolume ${volume} < ${t.mediumVolume}`);
    }
  }
  if (books != null) {
    if (books >= t.highBookCount) {
      score += 1;
      evidence.push(`booksCount ${books} ≥ ${t.highBookCount}`);
    } else if (books >= t.mediumBookCount) {
      evidence.push(`booksCount ${books} ≥ ${t.mediumBookCount}`);
    } else {
      evidence.push(`booksCount ${books} < ${t.mediumBookCount}`);
    }
  }

  let sampleQuality = "LOW";
  if (score >= 3) sampleQuality = "HIGH";
  else if (score >= 1) sampleQuality = "MEDIUM";

  return {
    sampleQuality,
    trackedBetCount: bets,
    trackedVolume: volume,
    booksCount: books,
    evidence,
    thresholdsUsed: t,
  };
}

/**
 * Explicit reverse-line-move research signal.
 * Majority tickets on Side A + line materially moves toward Side B.
 */
export function detectReverseLineMove({
  ticketPct = null,
  moneyPct = null,
  openLine = null,
  currentLine = null,
  homeIsPosSide = true,
  thresholds = DEFAULT_SIGNAL_THRESHOLDS,
} = {}) {
  const t = num(ticketPct);
  const m = num(moneyPct);
  const o = num(openLine);
  const c = num(currentLine);
  const thr = { ...DEFAULT_SIGNAL_THRESHOLDS, ...(thresholds || {}) };
  if (t == null || o == null || c == null) {
    return { signal: null, evidence: ["Insufficient ticketPct/open/current for RLM"] };
  }
  const lineDelta = Math.round((c - o) * 10) / 10;
  if (Math.abs(lineDelta) < thr.reverseLineMovePts) {
    return { signal: null, evidence: [`|lineDelta|=${Math.abs(lineDelta)} < ${thr.reverseLineMovePts}`] };
  }

  // Home-anchored spread: tickets on home when ticketPct > 50.
  const ticketSide = t >= 50 ? (homeIsPosSide ? "HOME" : "AWAY") : homeIsPosSide ? "AWAY" : "HOME";
  // Line move toward away (home spread rises, e.g. -3 → -2.5 or +3 → +3.5) favors away.
  const moveToward = lineDelta > 0 ? (homeIsPosSide ? "AWAY" : "HOME") : homeIsPosSide ? "HOME" : "AWAY";

  if (ticketSide === moveToward) {
    return {
      signal: null,
      evidence: [`Tickets ${ticketSide} aligned with move toward ${moveToward}`],
      ticket_side: ticketSide,
      ticket_pct: t,
      money_side: m == null ? null : m >= 50 ? (homeIsPosSide ? "HOME" : "AWAY") : homeIsPosSide ? "AWAY" : "HOME",
      money_pct: m,
      open_line: o,
      current_line: c,
      line_delta: lineDelta,
    };
  }

  return {
    signal: "REVERSE_LINE_MOVE",
    confidence: Math.abs(lineDelta) >= thr.reverseLineMovePts * 2 && Math.abs(t - 50) >= 10 ? "HIGH" : "MEDIUM",
    evidence: [
      `Majority tickets on ${ticketSide} (${t}%)`,
      `Line moved toward ${moveToward}: ${o} → ${c} (Δ ${lineDelta})`,
    ],
    ticket_side: ticketSide,
    ticket_pct: t,
    money_side: m == null ? null : m >= 50 ? (homeIsPosSide ? "HOME" : "AWAY") : homeIsPosSide ? "AWAY" : "HOME",
    money_pct: m,
    open_line: o,
    current_line: c,
    line_delta: lineDelta,
    sample_size: null,
  };
}

export function classifyBookDispersion(bookDisagreement, { thresholds = DEFAULT_SIGNAL_THRESHOLDS } = {}) {
  const thr = { ...DEFAULT_SIGNAL_THRESHOLDS, ...(thresholds || {}) };
  if (!bookDisagreement?.ok) {
    return { dispersion: null, evidence: ["Book disagreement unavailable"] };
  }
  const range = num(bookDisagreement.lineRange);
  if (range == null) return { dispersion: "UNKNOWN", evidence: ["No line range"] };
  if (range >= thr.wideLineRangePts) {
    return {
      dispersion: "WIDE",
      evidence: [`lineRange ${range} ≥ ${thr.wideLineRangePts}`, `${bookDisagreement.books} books`],
    };
  }
  if (range <= thr.wideLineRangePts / 3) {
    return {
      dispersion: "TIGHT",
      evidence: [`lineRange ${range} ≤ ${(thr.wideLineRangePts / 3).toFixed(2)}`, `${bookDisagreement.books} books`],
    };
  }
  return {
    dispersion: "NORMAL",
    evidence: [`lineRange ${range}`, `${bookDisagreement.books} books`],
  };
}

/**
 * Build explainable FBIS market-behavior signals. Every signal carries evidence[].
 */
export function deriveFbisMarketSignals({
  markets = [],
  ticketPct = null,
  moneyPct = null,
  moneyTicketGap = null,
  openLine = null,
  currentLine = null,
  // RLM must pair spread (or ML) public splits with the matching line series — never TOTAL % vs spread Δ.
  rlmContext = null,
  providerSignals = null,
  sample = null,
  bookDisagreement = null,
  thresholds = DEFAULT_SIGNAL_THRESHOLDS,
} = {}) {
  const thr = { ...DEFAULT_SIGNAL_THRESHOLDS, ...(thresholds || {}) };
  const signals = [];
  const t = num(ticketPct);
  const m = num(moneyPct);
  const gap = num(moneyTicketGap) ?? (t != null && m != null ? m - t : null);

  if (t != null && t >= thr.publicHeavyTicketPct) {
    signals.push({
      code: "PUBLIC_HEAVY",
      side: t >= 50 ? "HOME" : "AWAY",
      strength: t >= 75 ? "STRONG" : "MODERATE",
      confidence: sample?.sampleQuality === "HIGH" ? "HIGH" : "MEDIUM",
      evidence: [`ticketPct ${t}% ≥ ${thr.publicHeavyTicketPct}%`],
      source: "FBIS_DERIVED",
    });
  }
  if (m != null && m >= thr.moneyHeavyMoneyPct) {
    signals.push({
      code: "MONEY_HEAVY",
      side: m >= 50 ? "HOME" : "AWAY",
      strength: m >= 75 ? "STRONG" : "MODERATE",
      confidence: sample?.sampleQuality === "HIGH" ? "HIGH" : "MEDIUM",
      evidence: [`moneyPct ${m}% ≥ ${thr.moneyHeavyMoneyPct}%`],
      source: "FBIS_DERIVED",
    });
  }
  if (gap != null && Math.abs(gap) >= thr.moneyTicketDivergencePct) {
    signals.push({
      code: "LARGE_MONEY_TICKET_DIVERGENCE",
      side: gap > 0 ? "HOME" : "AWAY",
      strength: Math.abs(gap) >= thr.moneyTicketDivergencePct * 1.5 ? "STRONG" : "MODERATE",
      confidence: sample?.sampleQuality === "LOW" || sample?.sampleQuality === "UNKNOWN" ? "LOW" : "MEDIUM",
      evidence: [
        `money−ticket gap ${gap > 0 ? "+" : ""}${gap} pts`,
        `threshold ${thr.moneyTicketDivergencePct}`,
        `sampleQuality ${sample?.sampleQuality || "UNKNOWN"}`,
      ],
      source: "FBIS_DERIVED",
      uiLabel: "FBIS SHARP-MONEY PATTERN",
    });
  }

  const rlmTicket = num(rlmContext?.ticketPct) ?? t;
  const rlmMoney = num(rlmContext?.moneyPct) ?? m;
  const rlmOpen = num(rlmContext?.openLine) ?? openLine;
  const rlmCurrent = num(rlmContext?.currentLine) ?? currentLine;
  const rlm = detectReverseLineMove({
    ticketPct: rlmTicket,
    moneyPct: rlmMoney,
    openLine: rlmOpen,
    currentLine: rlmCurrent,
    thresholds: thr,
  });
  if (rlm.signal) {
    signals.push({
      code: rlm.signal,
      side: rlm.money_side || (rlm.line_delta > 0 ? "AWAY" : "HOME"),
      strength: Math.abs(rlm.line_delta) >= thr.reverseLineMovePts * 2 ? "STRONG" : "MODERATE",
      confidence: rlm.confidence,
      evidence: rlm.evidence,
      source: "FBIS_DERIVED",
      detail: {
        ticket_side: rlm.ticket_side,
        ticket_pct: rlm.ticket_pct,
        money_side: rlm.money_side,
        money_pct: rlm.money_pct,
        open_line: rlm.open_line,
        current_line: rlm.current_line,
        line_delta: rlm.line_delta,
      },
    });
  }

  if (gap != null && Math.abs(gap) >= thr.moneyTicketDivergencePct) {
    const move = deriveLineMovement({ openLine, currentLine });
    const moneySide = gap > 0 ? "HOME" : "AWAY";
    const moveSide =
      move.lineDelta == null || move.lineDelta === 0
        ? null
        : move.lineDelta > 0
          ? "AWAY"
          : "HOME";
    if (moveSide && moveSide === moneySide) {
      signals.push({
        code: "MONEY_MOVE_ALIGNMENT",
        side: moneySide,
        strength: "MODERATE",
        confidence: "MEDIUM",
        evidence: [
          `Money lean ${moneySide} (gap ${gap})`,
          `Line moved toward ${moveSide}: Δ ${move.lineDelta}`,
        ],
        source: "FBIS_DERIVED",
      });
    }
  }

  if (providerSignals?.providerSharpSignal) {
    signals.push({
      code: "PROVIDER_SHARP",
      side: providerSignals.providerSharpSignal,
      market: providerSignals.providerSharpMarket,
      strength: "STRONG",
      confidence: "HIGH",
      evidence: [
        `ACTION supplied sharpSide=${providerSignals.providerSharpRaw}`,
        "UI label: ACTION SHARP SIGNAL",
      ],
      source: "ACTION",
      uiLabel: "ACTION SHARP SIGNAL",
      providerSignalSource: "ACTION",
    });
  }
  if (providerSignals?.providerSteamSignal) {
    signals.push({
      code: "PROVIDER_STEAM",
      side: providerSignals.providerSteamSignal,
      market: providerSignals.providerSteamMarket,
      strength: "STRONG",
      confidence: "HIGH",
      evidence: [
        `ACTION supplied steam=${providerSignals.providerSteamRaw}`,
        "UI label: ACTION STEAM",
      ],
      source: "ACTION",
      uiLabel: "ACTION STEAM",
      providerSignalSource: "ACTION",
    });
  }

  const dispersion = classifyBookDispersion(bookDisagreement, { thresholds: thr });
  if (dispersion.dispersion === "WIDE") {
    signals.push({
      code: "BOOK_DISAGREEMENT",
      side: null,
      strength: "MODERATE",
      confidence: "MEDIUM",
      evidence: dispersion.evidence,
      source: "FBIS_DERIVED",
    });
  }

  if (sample?.sampleQuality === "LOW") {
    signals.push({
      code: "LOW_SAMPLE",
      side: null,
      strength: "WEAK",
      confidence: "LOW",
      evidence: sample.evidence || ["Low sample quality"],
      source: "FBIS_DERIVED",
    });
  }

  if (!signals.length && t == null && m == null) {
    signals.push({
      code: "MARKET_UNAVAILABLE",
      side: null,
      strength: "NONE",
      confidence: "LOW",
      evidence: ["No public split or provider signal available"],
      source: "FBIS_DERIVED",
    });
  } else if (
    !signals.some((s) =>
      ["PROVIDER_SHARP", "PROVIDER_STEAM", "REVERSE_LINE_MOVE", "LARGE_MONEY_TICKET_DIVERGENCE"].includes(
        s.code
      )
    ) &&
    (t != null || m != null)
  ) {
    const o = num(openLine);
    const c = num(currentLine);
    if (o != null && c != null && Math.abs(c - o) < thr.reverseLineMovePts / 2) {
      signals.push({
        code: "MARKET_STABLE",
        side: null,
        strength: "WEAK",
        confidence: "MEDIUM",
        evidence: [`Open ${o} ≈ current ${c}`],
        source: "FBIS_DERIVED",
      });
    } else if (signals.length === 0) {
      signals.push({
        code: "MIXED_MARKET",
        side: null,
        strength: "WEAK",
        confidence: "LOW",
        evidence: ["Splits present without strong derived pattern"],
        source: "FBIS_DERIVED",
      });
    }
  }

  // Potential sharp pattern only when multiple conditions support it.
  const codes = new Set(signals.map((s) => s.code));
  const support = [
    codes.has("LARGE_MONEY_TICKET_DIVERGENCE"),
    codes.has("REVERSE_LINE_MOVE"),
    codes.has("MONEY_MOVE_ALIGNMENT"),
    codes.has("PROVIDER_SHARP"),
    codes.has("PROVIDER_STEAM"),
    sample?.sampleQuality === "HIGH" || sample?.sampleQuality === "MEDIUM",
  ].filter(Boolean).length;
  if (support >= 2 && (codes.has("LARGE_MONEY_TICKET_DIVERGENCE") || codes.has("PROVIDER_SHARP"))) {
    const primary =
      signals.find((s) => s.code === "PROVIDER_SHARP") ||
      signals.find((s) => s.code === "LARGE_MONEY_TICKET_DIVERGENCE");
    signals.push({
      code: "POTENTIAL_SHARP_PATTERN",
      side: primary?.side || null,
      strength: support >= 3 ? "STRONG" : "MODERATE",
      confidence: codes.has("PROVIDER_SHARP") ? "HIGH" : "MEDIUM",
      evidence: [
        `${support} supporting conditions`,
        ...signals
          .filter((s) =>
            [
              "LARGE_MONEY_TICKET_DIVERGENCE",
              "REVERSE_LINE_MOVE",
              "MONEY_MOVE_ALIGNMENT",
              "PROVIDER_SHARP",
              "PROVIDER_STEAM",
            ].includes(s.code)
          )
          .map((s) => s.code),
        `sampleQuality ${sample?.sampleQuality || "UNKNOWN"}`,
      ],
      source: "FBIS_DERIVED",
      uiLabel: "FBIS SHARP-MONEY PATTERN",
      note: "Research classification only — not an automatic bet signal",
    });
  }

  // Prefer strongest market among ML/RL/TOTAL for display focus.
  const marketFocus = Array.isArray(markets)
    ? markets
        .filter((x) => x && x.magnitude != null)
        .slice()
        .sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))[0]
    : null;

  return {
    signals,
    marketFocus: marketFocus
      ? {
          market: marketFocus.market,
          leanSide: marketFocus.leanSide,
          ticketPct: marketFocus.ticketPct,
          moneyPct: marketFocus.moneyPct,
          magnitude: marketFocus.magnitude,
        }
      : null,
    dispersion: dispersion.dispersion,
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Explainable market-regime summary (not a black box).
 */
export function classifyMarketRegime({ signals = [], sample = null, dispersion = null } = {}) {
  const codes = new Set((signals || []).map((s) => s.code));
  const evidence = [];
  let regime = "MIXED_MARKET";

  if (codes.has("PROVIDER_STEAM") || codes.has("STEAM_CONFIRMED")) {
    regime = "STEAM";
    evidence.push("Provider or confirmed steam present");
  } else if (codes.has("PROVIDER_SHARP") && codes.has("POTENTIAL_SHARP_PATTERN")) {
    regime = "SHARP_CONFIRMED";
    evidence.push("ACTION sharp + multi-condition pattern");
  } else if (codes.has("REVERSE_LINE_MOVE")) {
    regime = "REVERSE_MOVE";
    evidence.push("Tickets opposed to line move");
  } else if (codes.has("PUBLIC_HEAVY") && !codes.has("MONEY_HEAVY")) {
    regime = "PUBLIC_DRIVEN";
    evidence.push("Heavy ticket share without matching money");
  } else if (dispersion === "WIDE" || codes.has("BOOK_DISAGREEMENT")) {
    regime = "DISPERSED";
    evidence.push("Wide book line range");
  } else if (codes.has("LOW_SAMPLE") || sample?.sampleQuality === "LOW") {
    regime = "LOW_LIQUIDITY";
    evidence.push("Low sample quality");
  } else if (codes.has("MARKET_STABLE")) {
    regime = "STABLE";
    evidence.push("Open ≈ current");
  } else if (codes.has("MARKET_UNAVAILABLE")) {
    regime = "UNAVAILABLE";
    evidence.push("ACTION splits unavailable");
  }

  return {
    regime,
    evidence,
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Optional transparent Market Intelligence Score — every contribution listed.
 * Research display only; does not qualify or authorize.
 */
export function buildMarketIntelligenceScore({
  signals = [],
  sample = null,
  providerSignals = null,
} = {}) {
  const contributions = [];
  let points = 0;

  const add = (key, delta, evidence) => {
    contributions.push({ key, delta, evidence });
    points += delta;
  };

  if (providerSignals?.providerSharpSignal) {
    add("provider_sharp", 3, `ACTION SHARP ${providerSignals.providerSharpSignal}`);
  }
  if (providerSignals?.providerSteamSignal) {
    add("provider_steam", 3, `ACTION STEAM ${providerSignals.providerSteamSignal}`);
  }
  for (const s of signals || []) {
    if (s.code === "LARGE_MONEY_TICKET_DIVERGENCE") add("money_ticket_divergence", 2, s.evidence.join("; "));
    if (s.code === "REVERSE_LINE_MOVE") add("reverse_line_move", 2, s.evidence.join("; "));
    if (s.code === "MONEY_MOVE_ALIGNMENT") add("movement_alignment", 1, s.evidence.join("; "));
    if (s.code === "BOOK_DISAGREEMENT") add("book_disagreement", -1, s.evidence.join("; "));
    if (s.code === "LOW_SAMPLE") add("sample_quality", -2, s.evidence.join("; "));
  }
  if (sample?.sampleQuality === "HIGH") add("sample_quality", 1, "HIGH sample");
  else if (sample?.sampleQuality === "MEDIUM") add("sample_quality", 0.5, "MEDIUM sample");

  const primary =
    (signals || []).find((s) => s.code === "PROVIDER_SHARP") ||
    (signals || []).find((s) => s.code === "POTENTIAL_SHARP_PATTERN") ||
    (signals || []).find((s) => s.code === "REVERSE_LINE_MOVE") ||
    (signals || []).find((s) => s.code === "LARGE_MONEY_TICKET_DIVERGENCE") ||
    null;

  let strength = "NONE";
  if (points >= 5) strength = "STRONG";
  else if (points >= 3) strength = "MODERATE";
  else if (points > 0) strength = "WEAK";

  return {
    side: primary?.side || null,
    strength,
    confidence:
      sample?.sampleQuality === "HIGH" && providerSignals?.providerSharpSignal
        ? "HIGH"
        : points >= 3
          ? "MEDIUM"
          : "LOW",
    points: Math.round(points * 10) / 10,
    contributions,
    evidence: contributions.map((c) => `${c.key}: ${c.delta > 0 ? "+" : ""}${c.delta} (${c.evidence})`),
    note: "Transparent research score — not wager authority",
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Compose board-facing ACTION intelligence enrichment from raw payloads.
 */
export function buildActionIntelligenceEnrichment({
  publicBetting = null,
  research = null,
  lineMovement = null,
  markets = [],
  ticketPct = null,
  moneyPct = null,
  moneyTicketGap = null,
  openLine = null,
  currentLine = null,
  rlmContext = null,
  trackedBetCount = null,
  trackedVolume = null,
  booksCount = null,
  bookRows = [],
  sampleThresholds = null,
  signalThresholds = null,
} = {}) {
  const providerSignals = extractProviderSignals({ publicBetting, research, lineMovement });
  const sample = classifySampleQuality({
    trackedBetCount:
      trackedBetCount ??
      num(publicBetting?.betCount) ??
      num(publicBetting?.numBets) ??
      num(research?.betCount),
    trackedVolume:
      trackedVolume ?? num(publicBetting?.trackedVolume) ?? num(publicBetting?.volume),
    booksCount,
    thresholds: sampleThresholds,
  });
  const bookDisagreement = bookRows.length
    ? deriveBookDisagreement(bookRows)
    : { ok: false, reason: "books-not-loaded", books: booksCount || 0, governance: { ...ACTION_FIREWALL } };

  const derived = deriveFbisMarketSignals({
    markets,
    ticketPct,
    moneyPct,
    moneyTicketGap,
    openLine,
    currentLine,
    rlmContext: rlmContext || { ticketPct, moneyPct, openLine, currentLine },
    providerSignals,
    sample,
    bookDisagreement,
    thresholds: signalThresholds,
  });
  const regime = classifyMarketRegime({
    signals: derived.signals,
    sample,
    dispersion: derived.dispersion,
  });
  const marketSignal = buildMarketIntelligenceScore({
    signals: derived.signals,
    sample,
    providerSignals,
  });

  return {
    providerSharpSignal: providerSignals.providerSharpSignal,
    providerSteamSignal: providerSignals.providerSteamSignal,
    providerSharpMarket: providerSignals.providerSharpMarket,
    providerSteamMarket: providerSignals.providerSteamMarket,
    providerSharpRaw: providerSignals.providerSharpRaw,
    providerSteamRaw: providerSignals.providerSteamRaw,
    providerSignalSource: providerSignals.providerSignalSource,
    // Keep FBIS sharpLabel null forever here.
    sharpLabel: null,
    sampleQuality: sample.sampleQuality,
    trackedBetCount: sample.trackedBetCount,
    trackedVolume: sample.trackedVolume,
    sampleEvidence: sample.evidence,
    bookDisagreement: bookDisagreement.ok
      ? {
          min_line: bookDisagreement.lineMin,
          max_line: bookDisagreement.lineMax,
          line_range: bookDisagreement.lineRange,
          min_price: bookDisagreement.priceMin,
          max_price: bookDisagreement.priceMax,
          price_range: bookDisagreement.priceRange,
          books_reporting: bookDisagreement.books,
          dispersion: derived.dispersion,
        }
      : null,
    signals: derived.signals,
    marketFocus: derived.marketFocus,
    marketRegime: regime.regime,
    marketRegimeEvidence: regime.evidence,
    marketSignal,
    governance: { ...ACTION_FIREWALL },
  };
}
