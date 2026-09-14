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

export function buildGameCardViewModel(game) {
  const board = buildBoardGameViewModel(game);
  const sport = String(board.sport || game?.sport || "").toLowerCase();
  const units = SCORE_UNIT[sport] || SCORE_UNIT.nfl;

  const away = enrichTeam(board.teams?.away, board.teams?.awayAbbr);
  const home = enrichTeam(board.teams?.home, board.teams?.homeAbbr);

  return {
    ...board,
    sport,
    units,
    away,
    home,
    comparison: buildComparison(board, away, home, units),
    action: buildActionPanel(game, away, home),
    context: buildContext(game, sport, away, home),
    status: buildStatus(board),
    marketCopy: buildMarketCopy(board),
    freshness: buildFreshness(game),
  };
}

function enrichTeam(team, abbrFallback) {
  const logo = resolveTeamLogo(team || {});
  const abbr = logo.abbr !== "—" ? logo.abbr : abbrFallback || "—";
  return {
    ...(team || {}),
    abbr,
    name: logo.name,
    displayName: team?.fullName || team?.displayName || logo.name,
    record: team?.record || team?.recordString || null,
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

function buildActionPanel(game, away, home) {
  const intel = game?.actionIntel || game?.actionIntel || null;
  const splits =
    game?.publicSplits ||
    game?.publicSplits ||
    intel?.publicSplits ||
    intel?.publicSplits ||
    null;
  if (!intel && !splits) {
    return {
      available: false,
      emptyLabel: "NO CURRENT DATA",
      headline: null,
      tickets: null,
      money: null,
      divergence: null,
      movement: null,
      sample: null,
      bookRange: null,
      poweredBy: null,
      canQualify: false,
      canAuthorize: false,
    };
  }

  const ticketHome = num(
    splits?.ticketPct ?? splits?.ticketsPct ?? intel?.publicSplits?.ticketPct
  );
  const moneyHome = num(splits?.moneyPct ?? splits?.money ?? intel?.publicSplits?.moneyPct);
  const gap =
    num(splits?.moneyTicketGap ?? intel?.publicSplits?.moneyTicketGap) ??
    (ticketHome != null && moneyHome != null ? moneyHome - ticketHome : null);

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

  const open = num(intel?.movement?.openingLine ?? intel?.movement?.openLine);
  const curr = num(intel?.movement?.currentLine ?? intel?.consensus?.spreadHome);
  const moveMag =
    num(intel?.movement?.movementMagnitude) ??
    (open != null && curr != null ? curr - open : null);

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
          team: sideFromHomeSpread(curr ?? open, away, home),
        }
      : null;

  const books =
    num(intel?.booksCount) ??
    (Array.isArray(intel?.bestOdds) ? intel.bestOdds.length : null);

  const sampleRaw =
    num(intel?.sampleSize) ??
    num(intel?.trackedBets) ??
    num(splits?.sampleSize) ??
    null;

  return {
    available: true,
    emptyLabel: null,
    headline: pickActionHeadline({
      ticketHome,
      moneyHome,
      gap,
      movement,
      providerSharp: intel?.publicSplits?.sharpLabel || intel?.sharpLabel || null,
    }),
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
    sample:
      sampleRaw == null
        ? null
        : {
            count: sampleRaw,
            label: formatSample(sampleRaw),
            low: sampleRaw < 500,
          },
    bookRange:
      books == null
        ? null
        : {
            books,
            label: `${books} BOOK${books === 1 ? "" : "S"}`,
          },
    poweredBy: "ACTION",
    displayOnly: true,
    canQualify: false,
    canAuthorize: false,
  };
}

function pickActionHeadline({ ticketHome, gap, movement, providerSharp }) {
  if (providerSharp && String(providerSharp).trim()) {
    return {
      kind: "PROVIDER_SHARP",
      icon: "💵",
      label: "ACTION SHARP",
      detail: String(providerSharp),
    };
  }
  if (gap != null && Math.abs(gap) >= BIG_MONEY_GAP_PTS) {
    return {
      kind: "MONEY_GAP",
      icon: "⚡",
      label: "BIG MONEY GAP",
      detail: `${gap > 0 ? "HOME" : "AWAY"} ${gap > 0 ? "+" : ""}${Math.round(gap)} pts`,
    };
  }
  if (gap != null && Math.abs(gap) >= MONEY_GAP_PTS) {
    return {
      kind: "MONEY_GAP",
      icon: "💰",
      label: "MONEY GAP",
      detail: `${gap > 0 ? "HOME" : "AWAY"} ${gap > 0 ? "+" : ""}${Math.round(gap)} pts`,
    };
  }
  if (ticketHome != null && ticketHome >= PUBLIC_HEAVY_TICKET_PCT) {
    return {
      kind: "PUBLIC_HEAVY",
      icon: "🎟️",
      label: "PUBLIC HEAVY",
      detail: `HOME ${Math.round(ticketHome)}% TICKETS`,
    };
  }
  if (ticketHome != null && ticketHome <= 100 - PUBLIC_HEAVY_TICKET_PCT) {
    return {
      kind: "PUBLIC_HEAVY",
      icon: "🎟️",
      label: "PUBLIC HEAVY",
      detail: `AWAY ${Math.round(100 - ticketHome)}% TICKETS`,
    };
  }
  if (movement?.delta != null && Math.abs(movement.delta) >= 0.5) {
    return {
      kind: "LINE_MOVE",
      icon: "📈",
      label: "LINE MOVE",
      detail: movement.label,
    };
  }
  if (ticketHome != null) {
    return { kind: "SPLITS", icon: "🔥", label: "ACTION INTEL", detail: "PUBLIC SPLITS" };
  }
  return { kind: "AVAILABLE", icon: "🔥", label: "ACTION INTEL", detail: null };
}

function buildContext(game, sport, away, home) {
  const weather = game?.weather || game?.cfb?.weather || null;
  const venue =
    game?.venue ||
    game?.venueName ||
    (typeof game?.event?.venue === "string" ? game.event.venue : null) ||
    null;

  return {
    venue,
    weather: weather
      ? {
          temp: weather.temperature ?? weather.temp ?? null,
          wind: weather.windSpeed ?? weather.wind ?? null,
          windDir: weather.windDirection || weather.windDir || null,
          description: weather.description || weather.condition || null,
          indoor: Boolean(weather.indoor || weather.dome),
        }
      : null,
    starters:
      sport === "mlb"
        ? {
            away: pitcherInfo(game?.awaySp || game?.bpp?.awaySp, game?.savant?.awaySpEra, away),
            home: pitcherInfo(game?.homeSp || game?.bpp?.homeSp, game?.savant?.homeSpEra, home),
          }
        : null,
  };
}

function pitcherInfo(sp, era, team) {
  if (!sp?.name && !sp?.last && era == null) return null;
  return {
    team,
    name: sp?.name || [sp?.first, sp?.last].filter(Boolean).join(" ") || sp?.last || "TBD",
    hand: sp?.hand || sp?.throws || null,
    era: era != null && Number.isFinite(Number(era)) ? Number(era) : null,
    record: sp?.record || sp?.wL || null,
  };
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
  const ts =
    game?.actionIntel?.collectedAt ||
    game?.market?.asOf ||
    game?.oddsUpdatedAt ||
    game?.updatedAt ||
    null;
  if (!ts) return { label: null, stale: false };
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return { label: null, stale: false };
  const ageMin = Math.round((Date.now() - ms) / 60000);
  return {
    label: ageMin < 1 ? "just now" : `${ageMin}m`,
    stale: ageMin > 90,
    asOf: ts,
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
