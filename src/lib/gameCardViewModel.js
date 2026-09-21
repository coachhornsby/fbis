/**
 * Premium game-card presentation view-model.
 * Presentation only — does not alter authority, qualification, or model math.
 */

import { buildBoardGameViewModel } from "./boardViewModel.js";
import { resolveTeamLogo } from "./resolveTeamLogo.js";

const SCORE_UNIT = Object.freeze({
  mlb: { unit: "RUNS", projectedLabel: "FBIS PROJECTED RUNS", shortUnit: "RUNS" },
  nfl: { unit: "PTS", projectedLabel: "FBIS PROJECTED SCORE", shortUnit: "PTS" },
  cfb: { unit: "PTS", projectedLabel: "FBIS PROJECTED SCORE", shortUnit: "PTS" },
  nba: { unit: "PTS", projectedLabel: "FBIS PROJECTED SCORE", shortUnit: "PTS" },
  cbb: { unit: "PTS", projectedLabel: "FBIS PROJECTED SCORE", shortUnit: "PTS" },
  nhl: { unit: "GOALS", projectedLabel: "FBIS PROJECTED GOALS", shortUnit: "GOALS" },
});

const PUBLIC_HEAVY_TICKET_PCT = 65;
const MONEY_GAP_PTS = 12;
const BIG_MONEY_GAP_PTS = 25;
const ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function ageMs(ts, now = Date.now()) {
  if (!ts) return null;
  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, now - parsed);
}

export function buildGameCardViewModel(game) {
  const board = buildBoardGameViewModel(game);
  const sport = String(board.sport || game?.sport || "").toLowerCase();
  const units = SCORE_UNIT[sport] || SCORE_UNIT.nfl;

  const away = enrichTeam(board.teams?.away, board.teams?.awayAbbr);
  const home = enrichTeam(board.teams?.home, board.teams?.homeAbbr);
  const comparison = buildComparison(board, away, home, units);
  const action = buildActionPanel(game, away, home, units);
  const context = buildContext(game, sport, away, home);
  const status = buildStatus(board);
  const marketCopy = buildMarketCopy(board);
  const freshness = buildFreshness(game);

  return {
    ...board,
    sport,
    units,
    away,
    home,
    comparison,
    action,
    context,
    status,
    marketCopy,
    freshness,
    bars: buildBars(comparison),
    footer: buildFooter(marketCopy, freshness),
  };
}

function enrichTeam(team, abbrFallback) {
  const logo = resolveTeamLogo(team || {});
  const abbr = logo.abbr !== "—" ? logo.abbr : abbrFallback || "—";
  return {
    ...(team || {}),
    abbr,
    name: team?.name || logo.name,
    fullName: team?.fullName || team?.displayName || logo.name,
    displayName: team?.fullName || team?.displayName || logo.name,
    record: team?.record || team?.recordString || null,
    logo: team?.logo || logo.url,
    logoUrl: logo.url,
    logoAvailable: logo.available,
    logoSource: logo.source,
  };
}

function buildComparison(board, away, home, units) {
  const fbisHomeSpread = board.projection?.fairHomeSpread;
  const marketHomeSpread = board.market?.available ? board.market.spread : null;
  const fbisTotal = board.projection?.total;
  const marketTotal = board.market?.available ? board.market.total : null;

  const fbisSide = sideFromHomeSpread(fbisHomeSpread, away, home);
  const marketSide = sideFromHomeSpread(marketHomeSpread, away, home);

  let sideRelationship = "UNKNOWN";
  if (fbisSide && marketSide) {
    sideRelationship =
      fbisSide.teamKey === marketSide.teamKey ? "SAME_SIDE" : "OPPOSITE_SIDES";
  } else if (fbisSide || marketSide) {
    sideRelationship = "PARTIAL";
  }

  const spreadDelta =
    board.comparison?.spreadDelta != null
      ? Math.abs(Number(board.comparison.spreadDelta))
      : fbisHomeSpread != null && marketHomeSpread != null
        ? Math.abs(Number(fbisHomeSpread) - Number(marketHomeSpread))
        : null;

  const totalDelta =
    board.comparison?.totalDelta != null
      ? Number(board.comparison.totalDelta)
      : fbisTotal != null && marketTotal != null
        ? Number(fbisTotal) - Number(marketTotal)
        : null;

  let totalDirection = "IN_LINE";
  if (totalDelta != null) {
    if (Math.abs(totalDelta) < 0.25) totalDirection = "IN_LINE";
    else if (totalDelta > 0) totalDirection = "FBIS_HIGHER";
    else totalDirection = "FBIS_LOWER";
  }

  return {
    label: board.comparison?.label || "MODEL vs MARKET",
    sideDiff: spreadDelta,
    sideDiffLabel:
      spreadDelta == null ? null : `${round1(spreadDelta)} ${units.shortUnit}`,
    sideRelationship,
    sideRelationshipLabel:
      sideRelationship === "OPPOSITE_SIDES"
        ? "OPPOSITE SIDES"
        : sideRelationship === "SAME_SIDE"
          ? "SAME SIDE"
          : null,
    fbisSide,
    marketSide,
    fbisTotal,
    marketTotal,
    totalDiff: totalDelta,
    totalDiffLabel:
      totalDelta == null
        ? null
        : `${totalDelta > 0 ? "+" : ""}${round1(totalDelta)} ${units.shortUnit}`,
    totalDirection,
    totalDirectionLabel:
      totalDirection === "FBIS_HIGHER"
        ? "FBIS HIGHER"
        : totalDirection === "FBIS_LOWER"
          ? "FBIS LOWER"
          : totalDirection === "IN_LINE"
            ? "IN LINE"
            : null,
    hasDiff: Boolean(board.comparison?.hasDiff || spreadDelta != null || totalDelta != null),
  };
}

function buildBars(comparison) {
  const fbisTotal = comparison.fbisTotal;
  const marketTotal = comparison.marketTotal;
  const max = Math.max(Number(fbisTotal) || 0, Number(marketTotal) || 0, 1);
  return {
    fbisTotal: fbisTotal ?? null,
    marketTotal: marketTotal ?? null,
    fbisPct: fbisTotal == null ? 0 : Math.max(8, Math.round((Number(fbisTotal) / max) * 100)),
    marketPct: marketTotal == null ? 0 : Math.max(8, Math.round((Number(marketTotal) / max) * 100)),
  };
}

function sideFromHomeSpread(homeSpread, away, home) {
  if (homeSpread == null || Number.isNaN(Number(homeSpread))) return null;
  const n = Number(homeSpread);
  if (Math.abs(n) < 0.05) {
    return { teamKey: "PICK", team: null, abbr: "PICK", line: 0, label: "PICK'EM" };
  }
  if (n < 0) {
    return {
      teamKey: "home",
      team: home,
      abbr: home.abbr,
      line: n,
      label: `${home.abbr} ${fmtLine(n)}`,
    };
  }
  return {
    teamKey: "away",
    team: away,
    abbr: away.abbr,
    line: -n,
    label: `${away.abbr} ${fmtLine(-n)}`,
  };
}

function buildActionPanel(game, away, home, units) {
  // Board attaches `actionIntel` (shadow ACTION). Accept legacy aliases too.
  const intel = game?.actionIntel || game?.actionIntel || game?.action || null;
  const splits =
    game?.publicSplits ||
    game?.publicSplits ||
    intel?.publicSplits ||
    intel?.publicSplits ||
    game?.sentiment ||
    null;
  const actionCollectedAt =
    intel?.collectedAt ||
    intel?.observedAt ||
    intel?.sourceObservedAt ||
    null;
  const actionAgeMs = ageMs(actionCollectedAt);
  const actionStale = actionAgeMs != null && actionAgeMs > ACTION_MAX_AGE_MS;
  if (actionStale) {
    return {
      available: false,
      stale: true,
      emptyLabel: "STALE ACTION SNAPSHOT",
      headline: null,
      tickets: null,
      money: null,
      divergence: null,
      movement: null,
      lineMove: null,
      sample: null,
      bookRange: null,
      markets: [],
      consensus: null,
      poweredBy: "ACTION",
      canQualify: false,
      canAuthorize: false,
      collectedAt: actionCollectedAt,
      ageMinutes: Math.round(actionAgeMs / 60000),
      advanced: null,
    };
  }
  if (!intel && !splits) {
    return {
      available: false,
      emptyLabel: "NO ACTION SNAPSHOT YET",
      headline: null,
      tickets: null,
      money: null,
      divergence: null,
      movement: null,
      lineMove: null,
      sample: null,
      bookRange: null,
      markets: [],
      consensus: null,
      poweredBy: null,
      canQualify: false,
      canAuthorize: false,
      advanced: null,
    };
  }

  const ticketHome = num(
    splits?.ticketPct ??
      splits?.ticketsPct ??
      splits?.ticketPct ??
      intel?.publicSplits?.ticketPct ??
      intel?.publicSplits?.ticketPct
  );
  const moneyHome = num(
    splits?.moneyPct ??
      splits?.money ??
      splits?.moneyPct ??
      intel?.publicSplits?.moneyPct ??
      intel?.publicSplits?.moneyPct
  );
  const gap =
    num(
      splits?.moneyTicketGap ??
        splits?.moneyTicketGap ??
        intel?.publicSplits?.moneyTicketGap ??
        intel?.publicSplits?.moneyTicketGap
    ) ?? (ticketHome != null && moneyHome != null ? moneyHome - ticketHome : null);

  const tickets =
    ticketHome == null
      ? null
      : {
          homePct: clampPct(ticketHome),
          awayPct: clampPct(100 - ticketHome),
          home,
          away,
        };

  const money =
    moneyHome == null
      ? null
      : {
          homePct: clampPct(moneyHome),
          awayPct: clampPct(100 - moneyHome),
          home,
          away,
        };

  const open = num(
    intel?.movement?.openingLine ??
      intel?.movement?.openingLine ??
      intel?.movement?.openLine ??
      intel?.movement?.openingLine ??
      intel?.sentiment?.openingLine
  );
  const curr = num(
    intel?.movement?.currentLine ??
      intel?.movement?.currentLine ??
      intel?.consensus?.spreadHome ??
      intel?.sentiment?.currentLine
  );
  const moveMag =
    num(
      intel?.movement?.movementMagnitude ??
        intel?.movement?.movementMagnitude ??
        intel?.movement?.magnitude
    ) ?? (open != null && curr != null ? curr - open : null);

  const moveSide = sideFromHomeSpread(curr ?? open, away, home);
  const openSide = sideFromHomeSpread(open, away, home);

  const movement =
    open != null || curr != null
      ? {
          open,
          current: curr,
          delta: moveMag,
          label:
            open != null && curr != null
              ? `${fmtLine(open)} → ${fmtLine(curr)}`
              : curr != null
                ? fmtLine(curr)
                : null,
          team: moveSide?.team || null,
        }
      : null;

  const lineMove =
    open != null && curr != null
      ? {
          teamAbbr: moveSide?.abbr || openSide?.abbr || null,
          fromLabel: openSide?.label || fmtLine(open),
          toLabel: moveSide?.label || fmtLine(curr),
          delta: moveMag,
          label: [
            moveSide?.abbr || openSide?.abbr,
            openSide ? fmtLine(openSide.line) : fmtLine(open),
            "→",
            moveSide ? fmtLine(moveSide.line) : fmtLine(curr),
          ]
            .filter(Boolean)
            .join(" "),
          deltaLabel:
            moveMag == null
              ? null
              : `${moveMag > 0 ? "+" : ""}${round1(moveMag)} ${units.shortUnit}`,
        }
      : null;

  const books =
    num(intel?.booksCount ?? intel?.booksCount ?? intel?.booksCount) ??
    (Array.isArray(intel?.bestOdds) ? Object.keys(intel.bestOdds).length : null) ??
    (Array.isArray(intel?.books) ? intel.books.length : null);

  const rangeLow = num(
    intel?.lineRange?.low ?? intel?.bookRange?.low ?? intel?.lineRange?.min
  );
  const rangeHigh = num(
    intel?.lineRange?.high ?? intel?.bookRange?.high ?? intel?.lineRange?.max
  );

  const sampleRaw =
    num(intel?.sampleSize) ??
    num(intel?.trackedBets) ??
    num(intel?.trackedBets) ??
    num(splits?.sampleSize) ??
    num(splits?.betCount) ??
    null;

  const marketRows = normalizeActionMarkets(
    splits?.markets || intel?.publicSplits?.markets || intel?.publicSplits?.markets,
    away,
    home
  );

  const bookRange =
    books != null || (rangeLow != null && rangeHigh != null)
      ? {
          books,
          fromLabel: rangeLow != null ? fmtLine(rangeLow) : null,
          toLabel: rangeHigh != null ? fmtLine(rangeHigh) : null,
          label:
            rangeLow != null && rangeHigh != null
              ? `${fmtLine(rangeLow)} to ${fmtLine(rangeHigh)}${
                  books != null ? ` · ${books} BOOKS` : ""
                }`
              : books != null
                ? `${books} BOOK${books === 1 ? "" : "S"}`
                : null,
        }
      : null;

  const providerSharp =
    intel?.publicSplits?.sharpLabel ||
    intel?.publicSplits?.sharpLabel ||
    intel?.sharpLabel ||
    intel?.providerSharpSignal ||
    null;
  const providerSteam =
    intel?.providerSteamSignal || intel?.steamLabel || intel?.publicSplits?.steamLabel || null;

  const headline = pickActionHeadline({
    ticketHome,
    moneyHome,
    gap,
    movement,
    providerSharp,
    providerSteam,
    away,
    home,
    marketHomeSpread: num(
      game?.market?.execution?.spread ??
        game?.market?.consensus?.spread ??
        intel?.consensus?.spreadHome ??
        game?.odds?.spread
    ),
  });

  const consensus = intel?.consensus
    ? {
        spreadHome: num(intel.consensus.spreadHome),
        total: num(intel.consensus.total),
        mlHome: num(intel.consensus.mlHome),
        mlAway: num(intel.consensus.mlAway),
      }
    : null;

  return {
    available: true,
    emptyLabel: null,
    headline,
    tickets,
    money,
    divergence:
      gap == null
        ? null
        : {
            points: gap,
            abs: Math.abs(gap),
            leanHome: gap > 0,
            label:
              Math.abs(gap) >= BIG_MONEY_GAP_PTS
                ? "BIG MONEY GAP"
                : Math.abs(gap) >= MONEY_GAP_PTS
                  ? "MONEY GAP"
                  : null,
            team: gap > 0 ? home : away,
          },
    movement,
    lineMove,
    sample:
      sampleRaw == null
        ? null
        : {
            count: sampleRaw,
            label: formatSample(sampleRaw),
            low: sampleRaw < 500,
          },
    bookRange,
    markets: marketRows,
    consensus,
    bestBook: intel?.movement?.bestBook || null,
    collectedAt: intel?.collectedAt || null,
    poweredBy: "ACTION",
    displayOnly: true,
    canQualify: false,
    canAuthorize: false,
    // Full ACTION payload for the advanced expand — presentation only.
    advanced: {
      provider: intel?.provider || "ACTION",
      role: intel?.role || "market_intelligence",
      displayOnly: true,
      headline,
      tickets,
      money,
      markets: marketRows,
      consensus,
      lineMove,
      sample:
        sampleRaw == null
          ? null
          : { count: sampleRaw, label: formatSample(sampleRaw), low: sampleRaw < 500 },
      bookRange,
      bestBook: intel?.movement?.bestBook || null,
      providerSharp: providerSharp ? String(providerSharp) : null,
      providerSteam: providerSteam ? String(providerSteam) : null,
      collectedAt: intel?.collectedAt || null,
      matchConfidence: intel?.matchConfidence || null,
    },
  };
}

function normalizeActionMarkets(rows, away, home) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const market = String(m.market || m.key || "").toUpperCase() || "RL";
      const ticketPct = num(m.ticketPct ?? m.ticketsPct ?? m.ticketPct);
      const moneyPct = num(m.moneyPct ?? m.moneyPct);
      const gap = num(m.moneyTicketGap ?? m.moneyTicketGap);
      const lean =
        m.leanSide ||
        (gap == null || gap === 0 ? null : gap > 0 ? "HOME" : "AWAY");
      const leanTeam =
        lean === "HOME" || lean === "OVER" ? home : lean === "AWAY" || lean === "UNDER" ? away : null;
      return {
        market,
        ticketPct: ticketPct == null ? null : clampPct(ticketPct),
        moneyPct: moneyPct == null ? null : clampPct(moneyPct),
        moneyTicketGap: gap,
        leanSide: lean,
        leanTeam,
        // Never invent sharp — only pass through if provider set it (usually null).
        providerSharp: m.sharpLabel || m.providerSharpSignal || null,
      };
    })
    .filter(Boolean);
}

function pickActionHeadline({
  ticketHome,
  moneyHome,
  gap,
  movement,
  providerSharp,
  providerSteam,
  away,
  home,
  marketHomeSpread,
}) {
  const leanTeam = gap != null ? (gap > 0 ? home : away) : null;
  const lineForTeam = (team) =>
    marketHomeSpread == null || team == null
      ? null
      : team === home
        ? `${home.abbr} ${fmtLine(marketHomeSpread)}`
        : `${away.abbr} ${fmtLine(-Number(marketHomeSpread))}`;
  const leanLine = lineForTeam(leanTeam);

  // Provider-supplied only — never invent FBIS "sharp".
  if (providerSharp && String(providerSharp).trim()) {
    return {
      kind: "PROVIDER_SHARP",
      icon: "🎯",
      label: "ACTION SHARP SIGNAL",
      detail: "LARGER BETS DETECTED",
      team: leanTeam,
      lineLabel: leanLine || String(providerSharp),
    };
  }
  if (providerSteam && String(providerSteam).trim()) {
    return {
      kind: "PROVIDER_STEAM",
      icon: "♨️",
      label: "ACTION STEAM",
      detail: String(providerSteam),
      team: leanTeam,
      lineLabel: leanLine,
    };
  }
  if (gap != null && Math.abs(gap) >= BIG_MONEY_GAP_PTS) {
    return {
      kind: "MONEY_GAP",
      icon: "🎯",
      label: "MONEY SIGNAL",
      detail: "LARGER BETS DETECTED",
      team: leanTeam,
      lineLabel: leanLine,
    };
  }
  if (gap != null && Math.abs(gap) >= MONEY_GAP_PTS) {
    return {
      kind: "MONEY_GAP",
      icon: "💰",
      label: "MONEY GAP",
      detail: `${leanTeam?.abbr || (gap > 0 ? "HOME" : "AWAY")} ${gap > 0 ? "+" : ""}${Math.round(gap)} pts money vs tickets`,
      team: leanTeam,
      lineLabel: leanLine,
    };
  }
  if (ticketHome != null && ticketHome >= PUBLIC_HEAVY_TICKET_PCT) {
    return {
      kind: "PUBLIC_HEAVY",
      icon: "🎟️",
      label: "PUBLIC HEAVY",
      detail: `${home.abbr} ${Math.round(ticketHome)}% TICKETS`,
      team: home,
      lineLabel: lineForTeam(home),
    };
  }
  if (ticketHome != null && ticketHome <= 100 - PUBLIC_HEAVY_TICKET_PCT) {
    return {
      kind: "PUBLIC_HEAVY",
      icon: "🎟️",
      label: "PUBLIC HEAVY",
      detail: `${away.abbr} ${Math.round(100 - ticketHome)}% TICKETS`,
      team: away,
      lineLabel: lineForTeam(away),
    };
  }
  if (movement?.delta != null && Math.abs(movement.delta) >= 0.5) {
    return {
      kind: "LINE_MOVE",
      icon: "📈",
      label: "LINE MOVE",
      detail: movement.label,
      team: movement.team || null,
      lineLabel: movement.label,
    };
  }
  if (moneyHome != null || ticketHome != null) {
    return {
      kind: "SPLITS",
      icon: "🔥",
      label: "ACTION INTEL",
      detail: "PUBLIC SPLITS",
      team: null,
      lineLabel: null,
    };
  }
  return {
    kind: "AVAILABLE",
    icon: "🔥",
    label: "ACTION INTEL",
    detail: null,
    team: null,
    lineLabel: null,
  };
}

function buildContext(game, sport, away, home) {
  const weatherRaw = game?.weather || game?.cfb?.weather || null;
  const venueRaw =
    game?.venue ||
    game?.venueName ||
    (typeof game?.event?.venue === "string" ? game.event.venue : null) ||
    null;

  let venueName = null;
  let venueCity = null;
  if (venueRaw && typeof venueRaw === "object") {
    venueName = venueRaw.name || venueRaw.venue || null;
    venueCity = [venueRaw.city, venueRaw.state].filter(Boolean).join(", ") || null;
  } else if (typeof venueRaw === "string") {
    const parts = venueRaw.split(",").map((s) => s.trim()).filter(Boolean);
    venueName = parts[0] || venueRaw;
    venueCity = parts.length > 1 ? parts.slice(1).join(", ") : null;
  }

  const weather = weatherRaw
    ? {
        temp: weatherRaw.temperature ?? weatherRaw.temp ?? null,
        wind: weatherRaw.windSpeed ?? weatherRaw.wind ?? null,
        windDir: weatherRaw.windDirection || weatherRaw.windDir || null,
        description: weatherRaw.description || weatherRaw.condition || null,
        indoor: Boolean(weatherRaw.indoor || weatherRaw.dome),
        windLabel: formatWind(weatherRaw),
      }
    : null;

  const weatherLine = weather
    ? [
        weather.temp != null ? `${weather.temp}°` : null,
        weather.description,
        weather.windLabel,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const starters =
    sport === "mlb"
      ? {
          away: pitcherInfo(game?.awaySp || game?.bpp?.awaySp, game?.savant?.awaySpEra, away),
          home: pitcherInfo(game?.homeSp || game?.bpp?.homeSp, game?.savant?.homeSpEra, home),
        }
      : null;

  return {
    venue: venueRaw,
    venueName,
    venueCity,
    venueLabel: [venueName, venueCity].filter(Boolean).join(", ") || null,
    weather,
    weatherLine,
    starters,
    startersLabel: sport === "mlb" ? "STARTING PITCHERS" : null,
  };
}

function formatWind(weather) {
  const speed = weather.windSpeed ?? weather.wind ?? null;
  const dir = weather.windDirection || weather.windDir || null;
  if (speed == null && !dir) return null;
  if (speed != null && dir) return `Wind ${speed} mph ${dir}`;
  if (speed != null) return `Wind ${speed} mph`;
  return `Wind ${dir}`;
}

function pitcherInfo(sp, era, team) {
  if (!sp?.name && !sp?.last && era == null) return null;
  return {
    team,
    name: sp?.name || [sp?.first, sp?.last].filter(Boolean).join(" ") || sp?.last || "TBD",
    hand: sp?.hand || sp?.throws || null,
    era: era != null && Number.isFinite(Number(era)) ? Number(era) : null,
    record: sp?.record || sp?.wL || null,
    number: sp?.number || sp?.jersey || null,
    photo: safeImageUrl(sp?.photo || sp?.headshot || sp?.headshotUrl || sp?.image || sp?.playerImage),
    whip: finite(sp?.whip),
    strikeoutPct: finite(sp?.strikeoutPct ?? sp?.kPct ?? sp?.strikeoutRate),
    walkPct: finite(sp?.walkPct ?? sp?.bbPct ?? sp?.walkRate),
    innings: finite(sp?.innings ?? sp?.ip),
  };
}

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeImageUrl(value) {
  return typeof value === "string" && (/^https:\/\//i.test(value) || /^\/(?!\/)/.test(value)) ? value : null;
}

function buildStatus(board) {
  const d = board.decision || {};
  const a = board.authority || {};
  const e = board.event || {};

  if (e.final) return { key: "FINAL", icon: "🏁", label: "FINAL", tone: "final" };
  if (e.live) return { key: "LIVE", icon: "🔴", label: "LIVE", tone: "live" };
  if (a.research || d.qualification === "RESEARCH_ONLY") {
    return { key: "RESEARCH", icon: "🧪", label: "RESEARCH", tone: "research" };
  }
  if (d.qualification === "QUALIFIED") {
    return { key: "QUALIFIED", icon: "✅", label: "QUALIFIED", tone: "qualified" };
  }
  if (d.qualification === "WATCH") {
    return { key: "WATCH", icon: "👁️", label: "WATCH", tone: "watch" };
  }
  if (d.dqState || board.quality?.marketUnresolved) {
    return { key: "BLOCKED", icon: "⛔", label: "BLOCKED", tone: "blocked" };
  }
  return { key: d.tier || "NONE", icon: "•", label: d.label || "—", tone: "neutral" };
}

function buildMarketCopy(board) {
  const label = board.market?.label || "MARKET";
  const rawBook = String(board.market?.book || "");
  const sanitizedBook = /sharp\s*api/i.test(rawBook) ? "Consensus feed" : rawBook || null;
  let primary = label;
  if (label === "CONSENSUS" || /consensus/i.test(label)) primary = "CONSENSUS MARKET";
  if (/sharpapi/i.test(label)) primary = "CONSENSUS MARKET";
  return {
    primary,
    source: sanitizedBook,
    role: board.market?.role || null,
    available: Boolean(board.market?.available),
    referenceOnly: Boolean(board.market?.referenceOnly),
  };
}

function buildFreshness(game) {
  // Market freshness must come from a market timestamp. ACTION collection time is
  // separate research telemetry and must never be labeled as "Lines as of".
  const ts =
    game?.market?.asOf ||
    game?.market?.observedAt ||
    game?.market?.execution?.sourceObservedAt ||
    game?.market?.consensus?.sourceObservedAt ||
    game?.oddsUpdatedAt ||
    game?.updatedAt ||
    null;
  if (!ts) return { label: null, stale: false, asOf: null };
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return { label: null, stale: false, asOf: ts };
  const ageMin = Math.round((Date.now() - ms) / 60000);
  return {
    label: ageMin < 1 ? "just now" : `${ageMin}m ago`,
    stale: ageMin > 90,
    asOf: ts,
  };
}

function buildFooter(marketCopy, freshness) {
  const sourceBits = ["Market Source:", marketCopy.primary];
  if (marketCopy.source && !/consensus/i.test(marketCopy.primary)) {
    sourceBits.push(`(${marketCopy.source})`);
  }
  let asOfLabel = null;
  if (freshness.asOf) {
    const d = new Date(freshness.asOf);
    if (Number.isFinite(d.getTime())) {
      const time = d.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      asOfLabel = `Lines as of ${time} CT${freshness.label ? ` (${freshness.label})` : ""}`;
    }
  } else if (freshness.label) {
    asOfLabel = `Updated ${freshness.label}`;
  }
  return {
    marketSourceLabel: sourceBits.filter(Boolean).join(" "),
    asOfLabel,
    stale: Boolean(freshness.stale),
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n))));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function fmtLine(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "PK";
  return v > 0 ? `+${round1(v)}` : `${round1(v)}`;
}

function formatSample(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(Math.round(n));
}
