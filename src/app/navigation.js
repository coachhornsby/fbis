/**
 * FBIS product navigation — Board-first decision workstation.
 * Sports are filters, not permanent primary tabs.
 *
 * Primary IA: BOARD · MODELS · MODEL LAB · MY BETS · MARKET · SYSTEM
 */

export const CUSTOMER_NAV = Object.freeze([
  { id: "board", label: "BOARD", description: "Decision workstation — FBIS → Market → Diff → Decision" },
  { id: "models", label: "MODELS", description: "Sport/model status and projections" },
  { id: "model-lab", label: "MODEL LAB", description: "Validation, version comparison, prospective evidence" },
  { id: "bets", label: "MY BETS", description: "Manual wager journal and performance" },
  { id: "market", label: "MARKET", description: "Advanced market intelligence and price comparison" },
]);

export const ADMIN_NAV = Object.freeze([
  { id: "system", label: "SYSTEM", description: "Health, providers, collection, DQ, operational evidence" },
]);

/** Supported board sports used as filters (not primary IA). */
export const SPORT_FILTERS = Object.freeze([
  { id: "all", label: "ALL" },
  { id: "nfl", label: "NFL" },
  { id: "cfb", label: "CFB" },
  { id: "mlb", label: "MLB" },
  { id: "nba", label: "NBA" },
  { id: "cbb", label: "CBB" },
]);

/** Routes that show the sport filter bar. */
export const SPORT_FILTER_ROUTES = Object.freeze([
  "board",
  "market",
  "models",
  "model-lab",
  "bets",
]);

// Back-compat alias used by older shell imports.
export const SPORT_FILTER_ROUTES_LEGACY = SPORT_FILTER_ROUTES;

/**
 * Map legacy App tab/sport URL state → product route ids.
 * Preserves old today/markets/research/publish/player-props deep links.
 */
export function legacyToRoute({ tab, sport } = {}) {
  if (tab === "sys") return { route: "system", sportFilter: sport || "all" };
  if (tab === "bets") return { route: "bets", sportFilter: sport || "all" };
  if (tab === "today") return { route: "board", sportFilter: sport || "all" };
  if (tab === "board") return { route: "market", sportFilter: sport || "mlb" };
  return { route: "board", sportFilter: "all" };
}

/**
 * Map product route → legacy tab for existing data loaders.
 */
export function routeToLegacy(route, sportFilter = "all") {
  switch (route) {
    case "system":
      return { tab: "sys", sport: sportFilter === "all" ? "mlb" : sportFilter };
    case "bets":
      return { tab: "bets", sport: sportFilter === "all" ? "mlb" : sportFilter };
    case "board":
    case "today": // legacy alias
      return { tab: "today", sport: sportFilter === "all" ? "mlb" : sportFilter };
    case "market":
    case "markets": // legacy alias
      return {
        tab: "board",
        sport: sportFilter === "all" ? "mlb" : sportFilter,
      };
    case "models":
    case "model-lab":
    case "player-props":
    case "performance":
    case "publish":
    case "research":
      // Load today board as backing data until feature modules need otherwise.
      return { tab: "today", sport: sportFilter === "all" ? "mlb" : sportFilter };
    default:
      return { tab: "today", sport: "mlb" };
  }
}

/** Normalize legacy route ids to the Board-first IA. */
export function normalizeRoute(route) {
  switch (route) {
    case "today":
      return "board";
    case "markets":
      return "market";
    case "research":
      return "model-lab";
    case "player-props":
    case "publish":
    case "performance":
      return "models";
    default:
      return route || "board";
  }
}

export function formatShellDate(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

/** Approved product expansion — do not change silently. */
export const FBIS_PRODUCT_SUBTITLE = "Forecasting & Betting Intelligence System";

export const FBIS_WORKFLOW_TAGLINE = "FBIS → Market → Diff → Decision";
