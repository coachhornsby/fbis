/**
 * Client-facing matchup-factor contract.
 * Presentation evidence only: consumes model/source fields already attached to each game.
 * Never changes projections, qualification, confidence, or wager authority.
 */

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits = 2) {
  const n = finite(v);
  if (n == null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function abbr(game, side) {
  return game?.[side]?.abbr || side.toUpperCase();
}

function factor(id, label, edge, value, detail, source) {
  return { id, label, edge: edge || null, value: value ?? null, detail: detail || null, source };
}

function sideFromDelta(game, delta) {
  const n = finite(delta);
  if (n == null || Math.abs(n) < 0.05) return "EVEN";
  return n > 0 ? abbr(game, "home") : abbr(game, "away");
}

function footballFactors(game) {
  const sport = String(game?.sport || "").toLowerCase();
  const shadow = sport === "nfl" ? game?.nflProShadow : game?.cfbMatchupV2;
  if (!shadow?.ok || !shadow?.decomposition?.home || !shadow?.decomposition?.away) return [];

  const h = shadow.decomposition.home;
  const a = shadow.decomposition.away;
  const hm = h.matchup || h.layers || {};
  const am = a.matchup || a.layers || {};
  const specs = sport === "nfl"
    ? [
        ["pass", "Pass offense vs pass defense", hm.pass, am.pass],
        ["rush", "Rush offense vs rush defense", hm.rush, am.rush],
        ["explosive", "Explosiveness", hm.explosive, am.explosive],
        ["pressure", "Pressure / protection", hm.pressure, am.pressure],
        ["trenches", "Trenches", hm.trenches, am.trenches],
        ["qb", "Quarterback", h.qb?.value ?? h.qb, a.qb?.value ?? a.qb],
        ["teamPower", "EPA / team efficiency", h.teamPower, a.teamPower],
        ["specialTeams", "Special teams", h.specialTeams, a.specialTeams],
        ["context", "Game context", h.context, a.context],
      ]
    : [
        ["passing", "Pass offense vs pass defense", hm.passing, am.passing],
        ["rushing", "Rush offense vs rush defense", hm.rushing, am.rushing],
        ["success", "Success rate", hm.success, am.success],
        ["explosive", "Explosiveness", hm.explosive, am.explosive],
        ["havoc", "Havoc", hm.havoc, am.havoc],
        ["trenches", "Trenches / pressure", hm.trenches, am.trenches],
        ["finishing", "Finishing drives", hm.finishing, am.finishing],
        ["quarterback", "Quarterback", hm.quarterback, am.quarterback],
        ["pace", "Pace / tempo", hm.pace, am.pace],
      ];

  return specs.flatMap(([id, label, hv, av]) => {
    const home = finite(hv);
    const away = finite(av);
    if (home == null && away == null) return [];
    const delta = (home ?? 0) - (away ?? 0);
    return [factor(
      id,
      label,
      sideFromDelta(game, delta),
      Math.abs(round(delta, 2)),
      `${abbr(game, "home")} ${home == null ? "—" : round(home, 2)} · ${abbr(game, "away")} ${away == null ? "—" : round(away, 2)}`,
      sport === "nfl" ? "NFL-PRO-v1 decomposition" : "CFB-MATCHUP-v2 decomposition"
    )];
  });
}

function mlbFactors(game) {
  const model = game?.mlbDeepShadow;
  if (!model?.ok) return [];
  const home = model.decomposition?.home || {};
  const away = model.decomposition?.away || {};
  const bpp = game?.bpp || {};
  const out = [];
  const homeAbbr = abbr(game, "home");
  const awayAbbr = abbr(game, "away");

  const matchupRows = [
    { side: "home", team: homeAbbr, pitcher: bpp?.matchup?.vsAwaySp?.pitcher || game?.awaySp?.name, row: bpp?.matchup?.vsAwaySp },
    { side: "away", team: awayAbbr, pitcher: bpp?.matchup?.vsHomeSp?.pitcher || game?.homeSp?.name, row: bpp?.matchup?.vsHomeSp },
  ];
  for (const x of matchupRows) {
    if (!x.row || (finite(x.row.rcVs) == null && finite(x.row.hrVs) == null && finite(x.row.kVs) == null)) continue;
    const parts = [
      finite(x.row.rcVs) == null ? null : `RC ${round(x.row.rcVs, 0) > 0 ? "+" : ""}${round(x.row.rcVs, 0)}% vs typical`,
      finite(x.row.hrVs) == null ? null : `HR ${round(x.row.hrVs, 0) > 0 ? "+" : ""}${round(x.row.hrVs, 0)}%`,
      finite(x.row.kVs) == null ? null : `K ${round(x.row.kVs, 0) > 0 ? "+" : ""}${round(x.row.kVs, 0)}%`,
      finite(x.row.n) == null ? null : `n=${round(x.row.n, 0)}`,
    ].filter(Boolean);
    out.push(factor(
      `lineup-${x.side}`,
      `${x.team} lineup vs ${x.pitcher || "opposing starter"}`,
      x.team,
      finite(x.row.rcVs) == null ? null : `${round(x.row.rcVs, 0) > 0 ? "+" : ""}${round(x.row.rcVs, 0)}% RC`,
      parts.join(" · "),
      "Ballpark Pal starter matchup"
    ));
  }

  const starters = [
    { side:"home", team:homeAbbr, name:game?.homeSp?.name, era:game?.savant?.homeSpEra, opp:awayAbbr, k:model?.pitcherKs?.home },
    { side:"away", team:awayAbbr, name:game?.awaySp?.name, era:game?.savant?.awaySpEra, opp:homeAbbr, k:model?.pitcherKs?.away },
  ];
  for (const sp of starters) {
    const era = finite(sp.era);
    const kp = finite(sp.k?.projection);
    if (era == null && kp == null) continue;
    out.push(factor(
      `starter-${sp.side}`,
      `${sp.name || sp.team + " starter"} vs ${sp.opp} lineup`,
      sp.team,
      kp != null ? `${round(kp,1)} K proj` : `${round(era,2)} ERA`,
      [era != null ? `ERA ${round(era,2)}` : null, kp != null ? `FBIS K projection ${round(kp,1)}` : null, finite(sp.k?.opponentKRate) != null ? `opponent K rate ${round(sp.k.opponentKRate * 100,1)}%` : null].filter(Boolean).join(" · "),
      "MLB-FBIS-v2 starter inputs"
    ));
  }

  const batters = Array.isArray(bpp.batterMatchups) ? bpp.batterMatchups : [];
  for (const row of batters.slice(0, 8)) {
    const rc = finite(row.rcVs);
    const hr = finite(row.hrVs);
    const k = finite(row.kVs);
    if (!row.batterName || (rc == null && hr == null && k == null)) continue;
    const team = row.batterTeam || null;
    out.push(factor(
      `batter-${row.batterId || row.batterName}-${row.pitcherId || row.pitcherName || ""}`,
      `${row.batterName} vs ${row.pitcherName || "starter"}`,
      team,
      rc != null ? `${round(rc,0) > 0 ? "+" : ""}${round(rc,0)}% RC` : hr != null ? `${round(hr,0) > 0 ? "+" : ""}${round(hr,0)}% HR` : null,
      [rc != null ? `runs created ${round(rc,0) > 0 ? "+" : ""}${round(rc,0)}% vs typical` : null, hr != null ? `HR ${round(hr,0) > 0 ? "+" : ""}${round(hr,0)}%` : null, k != null ? `K ${round(k,0) > 0 ? "+" : ""}${round(k,0)}%` : null].filter(Boolean).join(" · "),
      "Ballpark Pal batter-vs-starter matchup"
    ));
  }

  const env = finite(home.environmentFactor ?? away.environmentFactor);
  if (env != null && Math.abs(env - 1) >= 0.005) {
    out.push(factor("environment", "Park / weather / umpire environment", env > 1 ? "HITTERS" : "PITCHERS", `${round((env - 1) * 100,1) > 0 ? "+" : ""}${round((env - 1) * 100,1)}%`, "Combined run-environment factor used by MLB-FBIS-v2.", "MLB-FBIS-v2 environment"));
  }

  return out;
}

export function buildMatchupFactors(game = {}) {
  const explicit = game?.matchupFactors || game?.analysis?.matchupFactors || game?.model?.matchupFactors || game?.researchProjection?.matchupFactors;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const sport = String(game?.sport || "").toLowerCase();
  if (sport === "mlb") return mlbFactors(game);
  if (sport === "nfl" || sport === "cfb") return footballFactors(game);
  return [];
}

export function attachMatchupFactors(games = []) {
  return (games || []).map((game) => ({ ...game, matchupFactors: buildMatchupFactors(game) }));
}
