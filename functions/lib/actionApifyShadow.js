/**
 * Action Network via Apify — SHADOW MARKET INTELLIGENCE only.
 *
 * NEVER enters the authoritative odds router
 * (Parlay → TheOdds → SharpAPI → TheRundown → fail closed).
 * NEVER grants canQualify / canAuthorizeWager.
 * NEVER feeds independent CFB-FBIS-v2 projection features.
 *
 * Secrets: APIFY_TOKEN only via env/secret storage. Never log or persist the token.
 */

import { sha256Hex } from "./sha256Hex.js";
import { abbrMatch, namesMatchStrict } from "./match.js";
import { ODDS_PROVIDER_ORDER } from "./oddsProviderRouter.js";

export const ACTION_APIFY_PROVIDER = "ACTION_APIFY";
export const ACTION_APIFY_SOURCE_CLASS = "SHADOW_MARKET_INTELLIGENCE";
export const ACTION_APIFY_ACTOR_ID = "parseforge/action-network-scraper";
export const ACTION_APIFY_SCHEMA_VERSION = "action-apify-shadow-v1";

/** Free-plan hard caps for live research. */
export const ACTION_APIFY_FREE_MAX_ITEMS = 10;
export const ACTION_APIFY_RESEARCH_BUDGET_USD = 1.0;

/** Pay-per-event schedule from Actor docs (Free plan list prices). */
export const ACTION_APIFY_PRICING_USD = Object.freeze({
  runStart: 0.054,
  scoreboardPerLeaguePeriod: 0.01,
  gameRow: 0.007,
  lineMovementPerGame: 0.006,
  playerPropsPerGame: 0.008,
  gamePropsPerGame: 0.004,
  gameDetailPerGame: 0.005,
  weatherPerLeague: 0.01,
  injuriesPerLeague: 0.01,
  standingsPerLeague: 0.01,
  futuresPerRow: 0.01,
});

const BOOK_ALIASES = Object.freeze({
  draftkings: "draftkings",
  dk: "draftkings",
  fanduel: "fanduel",
  fd: "fanduel",
  betmgm: "betmgm",
  mgm: "betmgm",
  caesars: "caesars",
  czr: "caesars",
  bet365: "bet365",
  "bet365.com": "bet365",
  pinnacle: "pinnacle",
  pinny: "pinnacle",
  consensus: "consensus",
  opening: "opening",
  open: "opening",
});

export function apifyTokenConfigured(env = {}) {
  return Boolean(String(env.APIFY_TOKEN || env.APIFY_API_TOKEN || "").trim());
}

export function assertActionApifyNotInProductionRouter(order = ODDS_PROVIDER_ORDER) {
  const blocked = [...order].some((p) => /action|apify/i.test(String(p)));
  if (blocked) {
    throw new Error("ACTION_APIFY must not appear in ODDS_PROVIDER_ORDER");
  }
  return true;
}

export function clampMaxItems(maxItems, { freePlan = true } = {}) {
  const n = Number(maxItems);
  const requested = Number.isFinite(n) && n > 0 ? Math.floor(n) : ACTION_APIFY_FREE_MAX_ITEMS;
  if (!freePlan) return requested;
  return Math.min(requested, ACTION_APIFY_FREE_MAX_ITEMS);
}

/** Actor input enums (parseforge/action-network-scraper). */
const ACTOR_GAME_STATUS = new Set(["any", "scheduled", "live", "complete", "notStarted"]);
const ACTOR_PERIODS = new Set(["event", "firsthalf", "secondhalf", "firstquarter", "firstfiveinnings"]);

/** Map shorthand / legacy labels onto valid Actor enums. */
export function normalizeActorGameStatus(status) {
  if (status == null || status === "") return null;
  const s = String(status).trim();
  const key = s.toLowerCase();
  if (ACTOR_GAME_STATUS.has(s)) return s;
  if (key === "final" || key === "completed" || key === "finished") return "complete";
  if (key === "notstarted" || key === "not_started" || key === "pre") return "notStarted";
  if (ACTOR_GAME_STATUS.has(key)) return key === "notstarted" ? "notStarted" : key;
  return s;
}

export function normalizeActorPeriod(period) {
  if (period == null || period === "") return "event";
  const p = String(period).trim();
  const key = p.toLowerCase().replace(/[_\s-]+/g, "");
  if (ACTOR_PERIODS.has(p)) return p;
  if (key === "firstfive" || key === "f5" || key === "first5" || key === "firstfiveinnings") {
    return "firstfiveinnings";
  }
  if (key === "1h" || key === "firsthalf") return "firsthalf";
  if (key === "2h" || key === "secondhalf") return "secondhalf";
  if (key === "1q" || key === "firstquarter") return "firstquarter";
  if (key === "fg" || key === "fullgame" || key === "full" || key === "event") return "event";
  return p;
}

/** Canonical period label for shadow rows (internal, not Actor enum). */
export function canonicalizeShadowPeriod(period) {
  const p = String(period || "event").toLowerCase().replace(/[_\s-]+/g, "");
  if (p === "firstfive" || p === "f5" || p === "first5" || p === "firstfiveinnings") return "firstfive";
  if (p === "firsthalf" || p === "1h") return "firsthalf";
  if (p === "secondhalf" || p === "2h") return "secondhalf";
  if (p === "firstquarter" || p === "1q") return "firstquarter";
  return String(period || "event");
}

export function buildActorInput(opts = {}) {
  const freePlan = opts.freePlan !== false;
  const maxItems = clampMaxItems(opts.maxItems ?? opts.maxGames ?? ACTION_APIFY_FREE_MAX_ITEMS, { freePlan });
  const leagues = Array.isArray(opts.leagues) && opts.leagues.length ? opts.leagues.map(String) : ["ncaaf"];
  const periods = Array.isArray(opts.periods) && opts.periods.length
    ? opts.periods.map(normalizeActorPeriod)
    : ["event"];
  const books = Array.isArray(opts.books) && opts.books.length
    ? opts.books.map(normalizeBookKey).filter(Boolean)
    : ["draftkings", "fanduel", "betmgm", "caesars", "bet365"];

  const input = {
    leagues,
    periods,
    books,
    maxItems,
    includeLineMovement: Boolean(opts.includeLineMovement),
    includePlayerProps: Boolean(opts.includePlayerProps),
    includeGameProps: Boolean(opts.includeGameProps),
    includeGameDetail: Boolean(opts.includeGameDetail),
    includeWeather: Boolean(opts.includeWeather),
    includeInjuries: Boolean(opts.includeInjuries),
    includeStandings: Boolean(opts.includeStandings),
    includeFutures: Boolean(opts.includeFutures),
  };
  if (opts.date) input.date = String(opts.date);
  if (opts.week != null) input.week = Number(opts.week);
  if (opts.season != null) input.season = Number(opts.season);
  if (opts.seasonType) input.seasonType = String(opts.seasonType);
  if (opts.gameStatus) input.gameStatus = normalizeActorGameStatus(opts.gameStatus);
  if (opts.onlyWithOdds) input.onlyWithOdds = true;
  return input;
}

export function estimateActorCostUsd(input = {}, { gamesReturned = null, futuresRows = 0 } = {}) {
  const leagues = Array.isArray(input.leagues) ? input.leagues.length : 1;
  const periods = Array.isArray(input.periods) ? input.periods.length : 1;
  const maxItems = clampMaxItems(input.maxItems ?? ACTION_APIFY_FREE_MAX_ITEMS);
  const games = gamesReturned == null ? maxItems : Math.max(0, Number(gamesReturned) || 0);

  let usd = ACTION_APIFY_PRICING_USD.runStart;
  usd += leagues * periods * ACTION_APIFY_PRICING_USD.scoreboardPerLeaguePeriod;
  usd += games * ACTION_APIFY_PRICING_USD.gameRow;
  if (input.includeLineMovement) usd += games * ACTION_APIFY_PRICING_USD.lineMovementPerGame;
  if (input.includePlayerProps) usd += games * ACTION_APIFY_PRICING_USD.playerPropsPerGame;
  if (input.includeGameProps) usd += games * ACTION_APIFY_PRICING_USD.gamePropsPerGame;
  if (input.includeGameDetail) usd += games * ACTION_APIFY_PRICING_USD.gameDetailPerGame;
  if (input.includeWeather) usd += leagues * ACTION_APIFY_PRICING_USD.weatherPerLeague;
  if (input.includeInjuries) usd += leagues * ACTION_APIFY_PRICING_USD.injuriesPerLeague;
  if (input.includeStandings) usd += leagues * ACTION_APIFY_PRICING_USD.standingsPerLeague;
  if (input.includeFutures) usd += Math.max(0, Number(futuresRows) || 0) * ACTION_APIFY_PRICING_USD.futuresPerRow;

  return roundUsd(usd);
}

export function createResearchBudget({ limitUsd = ACTION_APIFY_RESEARCH_BUDGET_USD } = {}) {
  let spentUsd = 0;
  const runs = [];
  return {
    limitUsd: Number(limitUsd),
    get spentUsd() {
      return roundUsd(spentUsd);
    },
    get remainingUsd() {
      return roundUsd(Math.max(0, Number(limitUsd) - spentUsd));
    },
    get runs() {
      return runs.slice();
    },
    canAfford(estimateUsd) {
      return spentUsd + Number(estimateUsd || 0) <= Number(limitUsd) + 1e-9;
    },
    record(run) {
      const cost = roundUsd(Number(run?.estimatedCostUsd ?? run?.actualCostUsd ?? 0));
      if (spentUsd + cost > Number(limitUsd) + 1e-9) {
        return {
          ok: false,
          blocked: true,
          reason: "research-budget-exhausted",
          spentUsd: roundUsd(spentUsd),
          limitUsd: Number(limitUsd),
          attemptedUsd: cost,
        };
      }
      spentUsd = roundUsd(spentUsd + cost);
      runs.push({ ...run, estimatedCostUsd: cost, cumulativeSpendUsd: spentUsd });
      return { ok: true, spentUsd, remainingUsd: roundUsd(Number(limitUsd) - spentUsd) };
    },
  };
}

export function hashPayload(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return sha256Hex(raw);
}

export function normalizeBookKey(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!s) return null;
  return BOOK_ALIASES[s] || s;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function teamName(team) {
  if (team == null) return null;
  if (typeof team === "string") return strOrNull(team);
  return strOrNull(team.name || team.fullName || team.abbreviation);
}

function teamAbbr(team) {
  if (team == null || typeof team === "string") return null;
  return strOrNull(team.abbreviation || team.abbr);
}

/**
 * Scheduled / not-started games must keep null results — never invent 0-0.
 */
export function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || raw.gameStatus || "").toLowerCase();
  const isFinal = Boolean(raw.isFinal || raw.final || status === "final" || status === "complete" || status === "completed");
  if (!isFinal) return null;

  const homeScore = numOrNull(raw.homeScore ?? raw.result?.homeScore ?? raw.boxscore?.homeScore);
  const awayScore = numOrNull(raw.awayScore ?? raw.result?.awayScore ?? raw.boxscore?.awayScore);
  if (homeScore == null && awayScore == null && !raw.result && !raw.boxscore) return null;

  return {
    homeScore,
    awayScore,
    closingSpreadHome: numOrNull(raw.result?.closingSpreadHome ?? raw.closingSpreadHome),
    closingTotal: numOrNull(raw.result?.closingTotal ?? raw.closingTotal),
    atsResult: strOrNull(raw.result?.atsResult ?? raw.atsResult),
    ouResult: strOrNull(raw.result?.ouResult ?? raw.ouResult ?? raw.totalResult),
    firstHalf: raw.result?.firstHalf || raw.firstHalf || null,
    firstFive: raw.result?.firstFive || raw.firstFive || null,
    isFinal: true,
  };
}

export function americanToImpliedProb(odds) {
  const o = numOrNull(odds);
  if (o == null || o === 0) return null;
  if (o > 0) return round4(100 / (o + 100));
  return round4((-o) / (-o + 100));
}

export function noVigTwoWay(oddsA, oddsB) {
  const pA = americanToImpliedProb(oddsA);
  const pB = americanToImpliedProb(oddsB);
  if (pA == null || pB == null) return { home: null, away: null, hold: null };
  const sum = pA + pB;
  if (!(sum > 0)) return { home: null, away: null, hold: null };
  return {
    home: round4(pA / sum),
    away: round4(pB / sum),
    hold: round4(sum - 1),
  };
}

function normalizePublicBetting(pb) {
  if (!pb || typeof pb !== "object") return null;
  const side = (node) => {
    if (!node || typeof node !== "object") return null;
    return {
      ticketsPercent: numOrNull(node.ticketsPercent ?? node.ticketPercent ?? node.tickets),
      moneyPercent: numOrNull(node.moneyPercent ?? node.money),
      moneyMinusTickets: numOrNull(node.moneyMinusTickets ?? node.moneyMinusTicket ?? node.moneyTicketGap),
    };
  };
  return {
    moneylineHome: side(pb.moneylineHome),
    moneylineAway: side(pb.moneylineAway),
    spreadHome: side(pb.spreadHome),
    spreadAway: side(pb.spreadAway),
    over: side(pb.over),
    under: side(pb.under),
    maxMoneyTicketGap: numOrNull(pb.maxMoneyTicketGap ?? pb.maxMoneyMinusTickets),
    sharpSide: strOrNull(pb.sharpSide),
    betCount: numOrNull(pb.betCount ?? pb.numBets),
  };
}

function normalizeBooks(books) {
  if (!Array.isArray(books)) return [];
  return books
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const book = normalizeBookKey(b.book || b.bookName || b.name);
      if (!book) return null;
      return {
        book,
        bookId: b.bookId ?? b.id ?? null,
        period: strOrNull(b.period),
        marketId: strOrNull(b.marketId),
        isLive: Boolean(b.isLive),
        spreadHome: numOrNull(b.spreadHome ?? b.spread),
        spreadHomeOdds: numOrNull(b.spreadHomeOdds),
        spreadAway: numOrNull(b.spreadAway),
        spreadAwayOdds: numOrNull(b.spreadAwayOdds),
        moneylineHome: numOrNull(b.moneylineHome ?? b.mlHome),
        moneylineAway: numOrNull(b.moneylineAway ?? b.mlAway),
        total: numOrNull(b.total),
        overOdds: numOrNull(b.overOdds),
        underOdds: numOrNull(b.underOdds),
        moneylineHoldPercent: numOrNull(b.moneylineHoldPercent),
        spreadHoldPercent: numOrNull(b.spreadHoldPercent),
        totalHoldPercent: numOrNull(b.totalHoldPercent),
      };
    })
    .filter(Boolean);
}

function normalizeLineMovement(lm, historySource = null) {
  const summary = lm && typeof lm === "object" && !Array.isArray(lm) ? lm : null;
  const rawHistory = Array.isArray(historySource)
    ? historySource
    : Array.isArray(summary?.history)
      ? summary.history
      : Array.isArray(lm)
        ? lm
        : [];

  const history = [];
  for (const h of rawHistory) {
    if (!h || typeof h !== "object") continue;
    // Actor PPE shape: lineMovementHistory[] with nested history[] ticks.
    if (Array.isArray(h.history) && h.history.length) {
      for (const tick of h.history) {
        if (!tick || typeof tick !== "object") continue;
        history.push({
          book: normalizeBookKey(h.book || h.bookName || tick.book),
          market: strOrNull(h.betType || h.market || h.marketType || tick.market),
          line: numOrNull(tick.value ?? tick.line ?? tick.spread ?? tick.total ?? h.currentValue),
          odds: numOrNull(tick.odds ?? tick.price ?? h.currentOdds),
          observedAt: strOrNull(tick.updatedAt || tick.timestamp || tick.observedAt || tick.ts || h.lastMovedAt),
          side: strOrNull(h.side || tick.side),
          period: strOrNull(h.period || tick.period),
          openedAt: strOrNull(h.openedAt),
        });
      }
      continue;
    }
    history.push({
      book: normalizeBookKey(h.book || h.bookName),
      market: strOrNull(h.market || h.marketType || h.betType),
      line: numOrNull(h.line ?? h.value ?? h.spread ?? h.total ?? h.currentValue),
      odds: numOrNull(h.odds ?? h.price ?? h.currentOdds),
      // scrapedAt is collection time elsewhere; keep Actor-supplied move times only.
      observedAt: strOrNull(h.timestamp || h.observedAt || h.updatedAt || h.ts || h.lastMovedAt),
      side: strOrNull(h.side),
      period: strOrNull(h.period),
      openedAt: strOrNull(h.openedAt),
    });
  }
  const filtered = history.filter((h) => h.observedAt || h.line != null || h.odds != null);
  if (!summary && !filtered.length) return null;
  return {
    openSpreadHome: numOrNull(summary?.openSpreadHome ?? summary?.openingSpreadHome),
    openTotal: numOrNull(summary?.openTotal ?? summary?.openingTotal),
    openMoneylineHome: numOrNull(summary?.openMoneylineHome ?? summary?.openingMoneylineHome),
    openMoneylineAway: numOrNull(summary?.openMoneylineAway),
    currentSpreadHome: numOrNull(summary?.currentSpreadHome ?? summary?.spreadHome),
    currentTotal: numOrNull(summary?.currentTotal ?? summary?.total),
    currentMoneylineHome: numOrNull(summary?.currentMoneylineHome),
    currentMoneylineAway: numOrNull(summary?.currentMoneylineAway),
    spreadMove: numOrNull(summary?.spreadMove),
    totalMove: numOrNull(summary?.totalMove),
    moneylineHomeMove: numOrNull(summary?.moneylineHomeMove),
    spreadDirection: strOrNull(summary?.spreadDirection),
    totalDirection: strOrNull(summary?.totalDirection),
    history: filtered,
  };
}

function normalizePlayerProps(props) {
  if (!Array.isArray(props)) return [];
  return props
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      return {
        playerId: strOrNull(p.playerId ?? p.id),
        playerName: strOrNull(p.playerName ?? p.name),
        team: strOrNull(p.team || p.teamName || p.teamAbbr),
        market: strOrNull(p.market || p.marketType || p.propType),
        line: numOrNull(p.line ?? p.points),
        overOdds: numOrNull(p.overOdds ?? p.over),
        underOdds: numOrNull(p.underOdds ?? p.under),
        book: normalizeBookKey(p.book || p.bookName),
        // Do not invent observation time for props.
        observedAt: strOrNull(p.timestamp || p.observedAt || p.updatedAt),
      };
    })
    .filter(Boolean);
}

/**
 * Normalize one Actor game row into FBIS shadow market-research schema.
 * Fail-soft on malformed rows (returns null).
 */
export function normalizeActionGameRow(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  try {
    const actionGameId = raw.gameId ?? raw.id ?? raw.actionGameId;
    if (actionGameId == null) return null;
    const scrapedAt = strOrNull(raw.scrapedAt || ctx.scrapedAt || ctx.finishedAt);
    const receivedAt = strOrNull(ctx.receivedAt) || new Date().toISOString();
    const homeTeam = teamName(raw.homeTeam) || strOrNull(raw.home);
    const awayTeam = teamName(raw.awayTeam) || strOrNull(raw.away);
    if (!homeTeam || !awayTeam) return null;

    const consensusSpreadHome = numOrNull(raw.consensusSpreadHome);
    const consensusSpreadHomeOdds = numOrNull(raw.consensusSpreadHomeOdds);
    const consensusSpreadAwayOdds = numOrNull(raw.consensusSpreadAwayOdds);
    const consensusMoneylineHome = numOrNull(raw.consensusMoneylineHome);
    const consensusMoneylineAway = numOrNull(raw.consensusMoneylineAway);
    const consensusTotal = numOrNull(raw.consensusTotal);
    const consensusOverOdds = numOrNull(raw.consensusOverOdds);
    const consensusUnderOdds = numOrNull(raw.consensusUnderOdds);

    const nvMl = noVigTwoWay(consensusMoneylineHome, consensusMoneylineAway);
    const nvSpread = noVigTwoWay(consensusSpreadHomeOdds, consensusSpreadAwayOdds);
    const nvTotal = noVigTwoWay(consensusOverOdds, consensusUnderOdds);

    const publicBetting = normalizePublicBetting(raw.publicBetting);
    const books = normalizeBooks(raw.books);
    const lineMovement = normalizeLineMovement(raw.lineMovement, raw.lineMovementHistory);
    const result = normalizeResult(raw);
    const playerProps = normalizePlayerProps(raw.playerProps || raw.props);

    const bestOdds = raw.bestOdds && typeof raw.bestOdds === "object"
      ? {
          moneylineHome: raw.bestOdds.moneylineHome || null,
          moneylineAway: raw.bestOdds.moneylineAway || null,
          spreadHome: raw.bestOdds.spreadHome || null,
          spreadAway: raw.bestOdds.spreadAway || null,
          over: raw.bestOdds.over || null,
          under: raw.bestOdds.under || null,
          bookCount: numOrNull(raw.bestOdds.bookCount ?? raw.bookCount),
        }
      : null;

    const row = {
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
      actor: ACTION_APIFY_ACTOR_ID,
      schemaVersion: ACTION_APIFY_SCHEMA_VERSION,
      actionGameId: String(actionGameId),
      league: strOrNull(raw.league),
      season: numOrNull(raw.season),
      seasonType: strOrNull(raw.seasonType || raw.seasonType),
      week: numOrNull(raw.week),
      homeTeam,
      awayTeam,
      homeAbbr: teamAbbr(raw.homeTeam),
      awayAbbr: teamAbbr(raw.awayTeam),
      startTime: strOrNull(raw.startTime),
      status: strOrNull(raw.status || raw.gameStatus),
      isLive: Boolean(raw.isLive),
      period: canonicalizeShadowPeriod(raw.period || "event"),
      periodLabel: strOrNull(raw.periodLabel),
      scrapedAt,
      receivedAt,
      // Never invent observedAt from scrapedAt — collection ≠ source observation.
      observedAt: null,
      collectionId: strOrNull(ctx.runId || ctx.collectionId),
      sourceUrl: strOrNull(raw.url || raw.sourceUrl),
      rawPayloadHash: hashPayload(raw),
      consensus: {
        spreadHome: consensusSpreadHome,
        spreadHomeOdds: consensusSpreadHomeOdds,
        spreadAway: numOrNull(raw.consensusSpreadAway),
        spreadAwayOdds: consensusSpreadAwayOdds,
        moneylineHome: consensusMoneylineHome,
        moneylineAway: consensusMoneylineAway,
        total: consensusTotal,
        overOdds: consensusOverOdds,
        underOdds: consensusUnderOdds,
      },
      publicBetting,
      marketQuality: {
        bookCount: numOrNull(raw.bookCount) ?? books.length,
        moneylineHoldPercent: numOrNull(raw.moneylineHoldPercent),
        spreadHoldPercent: numOrNull(raw.spreadHoldPercent),
        totalHoldPercent: numOrNull(raw.totalHoldPercent),
        implied: {
          moneylineHome: numOrNull(raw.homeWinProbability) ?? americanToImpliedProb(consensusMoneylineHome),
          moneylineAway: numOrNull(raw.awayWinProbability) ?? americanToImpliedProb(consensusMoneylineAway),
        },
        noVig: {
          moneylineHome: numOrNull(raw.homeWinProbabilityNoVig) ?? nvMl.home,
          moneylineAway: numOrNull(raw.awayWinProbabilityNoVig) ?? nvMl.away,
          spreadHome: nvSpread.home,
          spreadAway: nvSpread.away,
          over: nvTotal.home,
          under: nvTotal.away,
        },
      },
      bestOdds,
      lineMovement,
      books,
      result,
      playerProps,
      researchFields: buildResearchFields({
        publicBetting,
        lineMovement,
        result,
        scrapedAt,
        consensusSpreadHome,
        consensusTotal,
      }),
      decisionEligible: false,
      canQualify: false,
      canAuthorizeWager: false,
    };
    return row;
  } catch {
    return null;
  }
}

/**
 * Derived research fields for future qualification work — never production gates.
 */
export function buildResearchFields({
  publicBetting = null,
  lineMovement = null,
  result = null,
  scrapedAt = null,
  consensusSpreadHome = null,
  consensusTotal = null,
  fbisSpreadProjection = null,
  fbisTotalProjection = null,
} = {}) {
  const ticketsPct = publicBetting?.spreadHome?.ticketsPercent ?? null;
  const moneyPct = publicBetting?.spreadHome?.moneyPercent ?? null;
  const moneyMinusTickets =
    publicBetting?.spreadHome?.moneyMinusTickets ??
    (ticketsPct != null && moneyPct != null ? moneyPct - ticketsPct : null);
  const openingLine = lineMovement?.openSpreadHome ?? null;
  const observedLine = consensusSpreadHome;
  const closingLine = result?.closingSpreadHome ?? null;
  const spreadEdge =
    fbisSpreadProjection != null && observedLine != null ? round4(fbisSpreadProjection - observedLine) : null;
  const totalEdge =
    fbisTotalProjection != null && consensusTotal != null ? round4(fbisTotalProjection - consensusTotal) : null;

  return {
    fbisSpreadProjection: fbisSpreadProjection ?? null,
    observedMarketSpread: observedLine,
    fbisSpreadEdge: spreadEdge,
    fbisTotalProjection: fbisTotalProjection ?? null,
    observedMarketTotal: consensusTotal,
    fbisTotalEdge: totalEdge,
    ticketsPct,
    moneyPct,
    moneyMinusTickets,
    sharpSide: publicBetting?.sharpSide ?? null,
    openingLine,
    observedLine,
    closingLine,
    lineMoveTowardFbis: null,
    lineMoveAgainstFbis: null,
    beatClosingLine: null,
    clvSpread: closingLine != null && observedLine != null ? round4(observedLine - closingLine) : null,
    clvPrice: null,
    scrapedAt,
    // Closing line is evaluation-only; never a projection feature.
    evaluationOnlyClosingLine: closingLine,
    result: result
      ? { homeScore: result.homeScore, awayScore: result.awayScore, atsResult: result.atsResult, ouResult: result.ouResult }
      : null,
    unitsResult: null,
  };
}

export function normalizeActionDataset(items, ctx = {}) {
  const rows = [];
  let malformed = 0;
  for (const item of items || []) {
    const n = normalizeActionGameRow(item, ctx);
    if (n) rows.push(n);
    else malformed += 1;
  }
  return { rows, malformed, schemaVersion: ACTION_APIFY_SCHEMA_VERSION };
}

/** Prefer full-name strict equality; abbr only against abbr (never abbr↔full fuzzy). */
function sidesMatch(actionName, actionAbbr, candName, candAbbr) {
  if (actionName && candName && namesMatchStrict(actionName, candName)) return true;
  if (actionAbbr && candAbbr && abbrMatch(actionAbbr, candAbbr)) return true;
  return false;
}

/**
 * Deterministic event matcher — league + both teams + kickoff tolerance.
 * Never force low-confidence matches.
 */
export function matchShadowEvent(
  actionRow,
  candidates = [],
  { kickoffToleranceMs = 3 * 60 * 60 * 1000, nearestKickoffMarginMs = 30 * 60 * 1000 } = {}
) {
  if (!actionRow?.homeTeam || !actionRow?.awayTeam) {
    return { matched: false, reason: "missing-action-teams", candidate: null };
  }
  const actionStart = actionRow.startTime ? Date.parse(actionRow.startTime) : NaN;
  const league = String(actionRow.league || "").toLowerCase();
  const matches = [];

  for (const c of candidates) {
    const cLeague = String(c.league || c.sport || "").toLowerCase();
    if (league && cLeague && !leaguesCompatible(league, cLeague)) continue;
    const cHome = c.homeTeam || c.home || c.home_team;
    const cAway = c.awayTeam || c.away || c.away_team;
    const cHomeAbbr = c.homeAbbr || c.home_abbr || null;
    const cAwayAbbr = c.awayAbbr || c.away_abbr || null;
    const homeOk = sidesMatch(actionRow.homeTeam, actionRow.homeAbbr, cHome, cHomeAbbr);
    const awayOk = sidesMatch(actionRow.awayTeam, actionRow.awayAbbr, cAway, cAwayAbbr);
    if (!homeOk || !awayOk) continue;

    const cStart = Date.parse(c.startTime || c.commence_time || c.kickoff || c.start || "");
    let kickoffDeltaMs = null;
    if (Number.isFinite(actionStart) && Number.isFinite(cStart)) {
      kickoffDeltaMs = Math.abs(actionStart - cStart);
      if (kickoffDeltaMs > kickoffToleranceMs) continue;
    } else {
      // Require kickoff on both sides — missing times against a large slate cause false AMBIGUOUS.
      continue;
    }
    matches.push({ candidate: c, kickoffDeltaMs });
  }

  if (matches.length === 1) {
    return { matched: true, reason: "unique-team-kickoff", candidate: matches[0].candidate, kickoffDeltaMs: matches[0].kickoffDeltaMs };
  }
  if (matches.length > 1) {
    const timed = [...matches].sort((a, b) => a.kickoffDeltaMs - b.kickoffDeltaMs);
    const best = timed[0];
    const second = timed[1];
    if (!second || second.kickoffDeltaMs - best.kickoffDeltaMs >= nearestKickoffMarginMs) {
      return {
        matched: true,
        reason: "unique-nearest-kickoff",
        candidate: best.candidate,
        kickoffDeltaMs: best.kickoffDeltaMs,
        candidates: matches.length,
      };
    }
    return { matched: false, reason: "ambiguous-match", candidate: null, candidates: matches.length };
  }
  return { matched: false, reason: "no-match", candidate: null };
}

function leaguesCompatible(a, b) {
  const norm = (x) => {
    const s = String(x || "").toLowerCase();
    if (s === "ncaaf" || s === "cfb" || s === "college-football") return "ncaaf";
    if (s === "ncaab" || s === "cbb") return "ncaab";
    if (s === "baseball_mlb") return "mlb";
    if (s === "americanfootball_nfl") return "nfl";
    return s;
  };
  return norm(a) === norm(b);
}

/**
 * Compare Action shadow books to authoritative FBIS provider books.
 * Disagreement is not auto-labeled as error (timestamp skew expected).
 */
export function compareShadowToProvider({ actionRows = [], providerEvents = [], providerName = "authoritative" } = {}) {
  const unmatchedAction = [];
  const unmatchedProvider = [];
  const pairs = [];
  const usedProvider = new Set();

  for (const a of actionRows) {
    const m = matchShadowEvent(a, providerEvents);
    if (!m.matched) {
      unmatchedAction.push({ actionGameId: a.actionGameId, reason: m.reason, homeTeam: a.homeTeam, awayTeam: a.awayTeam });
      continue;
    }
    const key = m.candidate.id || m.candidate.eventId || `${m.candidate.homeTeam}|${m.candidate.awayTeam}|${m.candidate.startTime}`;
    usedProvider.add(String(key));
    pairs.push({ action: a, provider: m.candidate, kickoffDeltaMs: m.kickoffDeltaMs });
  }

  for (const p of providerEvents) {
    const key = p.id || p.eventId || `${p.homeTeam}|${p.awayTeam}|${p.startTime}`;
    if (!usedProvider.has(String(key))) {
      unmatchedProvider.push({
        id: p.id || p.eventId || null,
        homeTeam: p.homeTeam || p.home,
        awayTeam: p.awayTeam || p.away,
      });
    }
  }

  const marketComparisons = [];
  let exactSpread = 0;
  let spreadCompared = 0;
  let exactTotal = 0;
  let totalCompared = 0;
  let mlAbsDiffSum = 0;
  let mlCompared = 0;
  let missingOnAction = 0;
  let missingOnProvider = 0;

  for (const pair of pairs) {
    const aBooks = new Map((pair.action.books || []).map((b) => [b.book, b]));
    const pBooksRaw = pair.provider.books || pair.provider.bookOdds || pair.provider.odds || [];
    const pBooks = new Map(
      (Array.isArray(pBooksRaw) ? pBooksRaw : []).map((b) => [normalizeBookKey(b.book || b.bookName || b.name), b])
    );
    const bookKeys = new Set([...aBooks.keys(), ...pBooks.keys()].filter(Boolean));
    for (const book of bookKeys) {
      const ab = aBooks.get(book);
      const pb = pBooks.get(book);
      if (!ab && pb) {
        missingOnAction += 1;
        marketComparisons.push({ book, market: "any", classification: "missing_on_action" });
        continue;
      }
      if (ab && !pb) {
        missingOnProvider += 1;
        marketComparisons.push({ book, market: "any", classification: "missing_on_provider" });
        continue;
      }
      const aSpread = numOrNull(ab.spreadHome);
      const pSpread = numOrNull(pb.spreadHome ?? pb.spread ?? pb.point);
      if (aSpread != null && pSpread != null) {
        spreadCompared += 1;
        const lineDiff = round4(aSpread - pSpread);
        const exact = aSpread === pSpread;
        if (exact) exactSpread += 1;
        marketComparisons.push({
          book,
          market: "spread",
          actionLine: aSpread,
          providerLine: pSpread,
          lineDiff,
          exact,
          actionOdds: ab.spreadHomeOdds ?? null,
          providerOdds: pb.spreadHomeOdds ?? pb.price ?? null,
          classification: exact ? "exact_line" : "line_diff",
        });
      }
      const aTotal = numOrNull(ab.total);
      const pTotal = numOrNull(pb.total ?? pb.totals);
      if (aTotal != null && pTotal != null) {
        totalCompared += 1;
        const exact = aTotal === pTotal;
        if (exact) exactTotal += 1;
        marketComparisons.push({
          book,
          market: "total",
          actionLine: aTotal,
          providerLine: pTotal,
          lineDiff: round4(aTotal - pTotal),
          exact,
          classification: exact ? "exact_line" : "line_diff",
        });
      }
      const aMl = numOrNull(ab.moneylineHome);
      const pMl = numOrNull(pb.moneylineHome ?? pb.mlHome ?? pb.homeMl);
      if (aMl != null && pMl != null) {
        mlCompared += 1;
        mlAbsDiffSum += Math.abs(aMl - pMl);
        marketComparisons.push({
          book,
          market: "moneyline",
          actionOdds: aMl,
          providerOdds: pMl,
          priceDiff: aMl - pMl,
          classification: aMl === pMl ? "exact_price" : "price_diff",
        });
      }
    }
  }

  const gameMatchRate = actionRows.length ? pairs.length / actionRows.length : null;
  return {
    providerName,
    sourceClass: ACTION_APIFY_SOURCE_CLASS,
    gameMatchRate: gameMatchRate == null ? null : round4(gameMatchRate),
    matchedGames: pairs.length,
    actionGames: actionRows.length,
    providerGames: providerEvents.length,
    unmatchedAction,
    unmatchedProvider,
    sportsbookMatchRate: null,
    exactSpreadLineAgreement: spreadCompared ? round4(exactSpread / spreadCompared) : null,
    exactTotalLineAgreement: totalCompared ? round4(exactTotal / totalCompared) : null,
    mlPriceAbsDiffMean: mlCompared ? round4(mlAbsDiffSum / mlCompared) : null,
    missingOnAction,
    missingOnProvider,
    actionBookCountMean: actionRows.length
      ? round4(actionRows.reduce((s, r) => s + (r.marketQuality?.bookCount || r.books?.length || 0), 0) / actionRows.length)
      : null,
    note: "Disagreement is not automatically an error — observation timestamps may differ.",
    marketComparisonsSample: marketComparisons.slice(0, 50),
  };
}

/**
 * Live Apify run via REST (no SDK required). Token never returned/logged.
 */
export async function runActionApifyShadow(env, opts = {}) {
  assertActionApifyNotInProductionRouter();
  const token = String(env.APIFY_TOKEN || env.APIFY_API_TOKEN || "").trim();
  if (!token) {
    return {
      ok: false,
      configured: false,
      error: "APIFY_TOKEN not configured — owner must install secret before live shadow runs",
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
    };
  }

  const budget = opts.budget || createResearchBudget();
  const input = buildActorInput(opts);
  const estimate = estimateActorCostUsd(input);
  if (!budget.canAfford(estimate)) {
    return {
      ok: false,
      configured: true,
      blocked: true,
      error: "research-budget-exhausted",
      estimatedCostUsd: estimate,
      spentUsd: budget.spentUsd,
      limitUsd: budget.limitUsd,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
    };
  }

  const waitSecs = Math.min(Number(opts.waitSecs) || 300, 600);
  const actorPath = encodeURIComponent(ACTION_APIFY_ACTOR_ID);
  const url = `https://api.apify.com/v2/acts/${actorPath}/runs?waitForFinish=${waitSecs}`;
  const receivedAt = new Date().toISOString();
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return {
      ok: false,
      configured: true,
      error: `apify-http-${res.status}`,
      // Never echo Authorization or token material.
      detail: String(bodyText).replaceAll(token, "[redacted]").slice(0, 240),
      estimatedCostUsd: estimate,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
    };
  }

  const runJson = await res.json();
  const run = runJson?.data || runJson;
  const runId = run?.id || null;
  const status = run?.status || null;
  const datasetId = run?.defaultDatasetId || null;
  if (!datasetId || !["SUCCEEDED", "SUCCEEDED_WITH_WARNINGS"].includes(String(status))) {
    return {
      ok: false,
      configured: true,
      error: `apify-run-${status || "unknown"}`,
      runId,
      estimatedCostUsd: estimate,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
    };
  }

  const dsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true`;
  const dsRes = await fetchImpl(dsUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!dsRes.ok) {
    return {
      ok: false,
      configured: true,
      error: `apify-dataset-${dsRes.status}`,
      runId,
      estimatedCostUsd: estimate,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
    };
  }
  const items = await dsRes.json();
  const list = Array.isArray(items) ? items : [];
  const { rows, malformed } = normalizeActionDataset(list, {
    runId,
    receivedAt,
    scrapedAt: run?.finishedAt || receivedAt,
  });
  const actualEstimate = estimateActorCostUsd(input, { gamesReturned: rows.length });
  const budgetResult = budget.record({
    runId,
    testId: opts.testId || null,
    leagues: input.leagues,
    periods: input.periods,
    gamesReturned: rows.length,
    optionalBlocks: {
      includeLineMovement: input.includeLineMovement,
      includePlayerProps: input.includePlayerProps,
      includeGameProps: input.includeGameProps,
    },
    estimatedCostUsd: actualEstimate,
  });

  return {
    ok: true,
    configured: true,
    provider: ACTION_APIFY_PROVIDER,
    sourceClass: ACTION_APIFY_SOURCE_CLASS,
    actor: ACTION_APIFY_ACTOR_ID,
    runId,
    datasetId,
    status,
    input,
    rows,
    malformed,
    gamesReturned: rows.length,
    estimatedCostUsd: actualEstimate,
    budget: {
      spentUsd: budget.spentUsd,
      remainingUsd: budget.remainingUsd,
      limitUsd: budget.limitUsd,
      recordOk: budgetResult.ok,
    },
    // Usage accounting for research ledger — no secrets.
    usage: {
      runCount: 1,
      leaguesRequested: input.leagues,
      periodsRequested: input.periods,
      gamesReturned: rows.length,
      optionalBlocksEnabled: Object.entries({
        includeLineMovement: input.includeLineMovement,
        includePlayerProps: input.includePlayerProps,
        includeGameProps: input.includeGameProps,
        includeGameDetail: input.includeGameDetail,
        includeWeather: input.includeWeather,
        includeInjuries: input.includeInjuries,
        includeStandings: input.includeStandings,
        includeFutures: input.includeFutures,
      })
        .filter(([, v]) => v)
        .map(([k]) => k),
      estimatedActorCostUsd: actualEstimate,
      actualApifyCostUsd: null,
    },
  };
}

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}
