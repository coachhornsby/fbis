/**
 * Restore the rich, source-attributed focused sport cards on the All Sports board.
 * The bounded all-sport D1 response is a fast provisional skeleton; it is not
 * market evidence. Only a successful focused /api/today response can replace it.
 * No market, model, outcome, price, or qualification is synthesized here.
 */
export function mergeVerifiedSportBoards(base, focused = []) {
  if (!base || !Array.isArray(base.groups) || !Array.isArray(focused)) return base;
  const selected = new Map();
  for (const entry of focused) {
    const { sport, board } = entry || {};
    if (!sport || !board || board.date !== base.date ||
        board.error || board.health?.state === "UNAVAILABLE" ||
        board.health?.boardDeliveryMode === "D1_UNVERIFIED_MATCHUPS" ||
        board.feeds?.[sport]?.ok === false ||
        !Array.isArray(board.games) || board.games.length === 0 ||
        board.games.some(g => g?.sport !== sport) ||
        !Array.isArray(board.groups) ||
        !board.groups.some(g => g.sport === sport && Array.isArray(g.games) &&
          g.games.length === board.games.length)) continue;
    selected.set(sport, board);
  }
  if (!selected.size) return base;

  const groups = base.groups.map(group => {
    const focusedBoard = selected.get(group.sport);
    if (!focusedBoard) return group;
    const focusedGroup = focusedBoard.groups.find(g => g.sport === group.sport);
    return { ...group, ...focusedGroup, games: focusedBoard.games };
  });
  const games = groups.flatMap(g => g.games || []).sort((a, b) => {
    const t = (Date.parse(a.start || "") || 0) - (Date.parse(b.start || "") || 0);
    return t || String(a.sport || "").localeCompare(String(b.sport || ""));
  });
  const bySport = Object.fromEntries(groups.map(g => [g.sport, g.games?.length || 0]));
  const durableFallbackGames = games.filter(g => Boolean(g.durableFallback)).length;
  const verifiedMarkets = games.filter(g => g.marketAvailable === true).length;
  const projectedGames = games.filter(g => g.projHome != null && g.projAway != null).length;

  const counts = {
    ...base.counts,
    games: games.length,
    bySport,
    durableFallbackGames,
    scheduled: games.filter(g => g.status === "scheduled" || g.status === "pregame").length,
    live: games.filter(g => g.live === true).length,
    final: games.filter(g => g.final === true).length,
    qualified: games.filter(g => Boolean(g.rec)).length,
    leans: games.filter(g => !g.rec && Boolean(g.lean)).length,
  };
  const replaceChecks = (original = [], name) => {
    if (!Array.isArray(original)) return original;
    return original.map(check => {
      const sport = String(check?.name || "").split("-")[0];
      const board = selected.get(sport);
      const replacements = name === "required"
        ? board?.health?.sourceStatus?.requiredChecks
        : board?.health?.checks;
      return replacements?.find(c => c.name === check.name) || check;
    });
  };
  const checks = replaceChecks(base.health?.checks);
  const sourceRequiredChecks = replaceChecks(base.health?.sourceStatus?.requiredChecks, "required");
  const statuses = { ...(base.health?.sourceStatus?.statuses || {}) };
  const feeds = { ...(base.feeds || {}) };
  for (const [sport, board] of selected) {
    if (board.health?.sourceStatus?.statuses?.[sport])
      statuses[sport] = board.health.sourceStatus.statuses[sport];
    if (board.feeds?.[sport]) feeds[sport] = board.feeds[sport];
  }
  const health = {
    ...base.health,
    // The merged set may still contain non-authoritative D1-only matchups.
    // Keep all-sport health conservative and do not promote wager authority.
    state: "DEGRADED",
    boardDeliveryMode: durableFallbackGames
      ? "FOCUSED_FEEDS_WITH_DURABLE_FALLBACK"
      : "FOCUSED_VERIFIED_FEEDS",
    gamesLoaded: games.length,
    durableFallbackGames,
    projectionsAvailable: projectedGames,
    marketsAvailable: verifiedMarkets,
    qualifiedTickets: counts.qualified,
    sourceStatus: { ...(base.health?.sourceStatus || {}), statuses,
      requiredChecks: sourceRequiredChecks },
    checks,
    failures: Array.isArray(checks) ? checks.filter(c => c.required && !c.ok) : base.health?.failures,
  };
  return {
    ...base, groups, sports: groups, games, counts, health, feeds,
    // Retain base coverage authority and PIT governance; do not declare
    // an all-sport snapshot authoritative from individually fetched feeds.
    coverage: base.coverage,
  };
}
