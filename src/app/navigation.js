/**
 * Customer vs owner/admin navigation for the FBIS product shell.
 * Sports are filters, not permanent primary tabs.
 */

export const CUSTOMER_NAV = Object.freeze([
  { id: "today", label: "TODAY", description: "Command center" },
  { id: "markets", label: "MARKETS", description: "Full slate & line shopping" },
  { id: "player-props", label: "PLAYER PROPS", description: "Normalized player markets" },
  { id: "bets", label: "MY BETS", description: "Executed bets only" },
  { id: "performance", label: "PERFORMANCE", description: "Model / qualified / executed" },
  { id: "research", label: "RESEARCH", description: "Labs & historical analysis" },
]);

export const ADMIN_NAV = Object.freeze([
  { id: "system", label: "SYSTEM", description: "Health, providers, costs, diagnostics" },
]);

/** Supported board sports used as filters (not primary IA). */
export const SPORT_FILTERS = Object.freeze([
  { id: "all", label: "ALL" },
  { id: "cfb", label: "CFB" },
  { id: "nfl", label: "NFL" },
  { id: "mlb", label: "MLB" },
  { id: "nba", label: "NBA" },
  { id: "cbb", label: "CBB" },
]);

/**
 * Map legacy App tab/sport URL state → product route ids.
 */
export function legacyToRoute({ tab, sport } = {}) {
  if (tab === "sys") return { route: "system", sportFilter: sport || "all" };
  if (tab === "bets") return { route: "bets", sportFilter: sport || "all" };
  if (tab === "today") return { route: "today", sportFilter: sport || "all" };
  if (tab === "board") return { route: "markets", sportFilter: sport || "mlb" };
  return { route: "today", sportFilter: "all" };
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
    case "today":
      return { tab: "today", sport: sportFilter === "all" ? "mlb" : sportFilter };
    case "markets":
      return {
        tab: "board",
        sport: sportFilter === "all" ? "mlb" : sportFilter,
      };
    case "player-props":
    case "performance":
    case "research":
      // Load today board as backing data until feature modules land.
      return { tab: "today", sport: sportFilter === "all" ? "mlb" : sportFilter };
    default:
      return { tab: "today", sport: "mlb" };
  }
}

export function formatShellDate(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).toUpperCase();
}
