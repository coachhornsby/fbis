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

function basketballFactors(game) {
  const sport = String(game?.sport || "").toLowerCase();
  const homeAbbr = abbr(game, "home");
  const awayAbbr = abbr(game, "away");
  const out = [];

  if (sport === "nba") {
    const form = game?.basketballForm;
    const d = form?.decomposition;
    if (!form?.ok || !d?.home || !d?.away) return [];
    const hOff = finite(d.home.offense);
    const hDef = finite(d.home.defenseAllowed);
    const aOff = finite(d.away.offense);
    const aDef = finite(d.away.defenseAllowed);
    if (hOff != null && aDef != null) out.push(factor(
      "home-offense-defense", `${homeAbbr} scoring vs ${awayAbbr} defense`,
      hOff > aDef ? homeAbbr : awayAbbr, round((hOff + aDef) / 2, 1),
      `${homeAbbr} blended offense ${round(hOff,1)} PPG · ${awayAbbr} blended allowance ${round(aDef,1)} PPG`,
      "NBA-FBIS-FORM-v1 scoreboard team form"
    ));
    if (aOff != null && hDef != null) out.push(factor(
      "away-offense-defense", `${awayAbbr} scoring vs ${homeAbbr} defense`,
      aOff > hDef ? awayAbbr : homeAbbr, round((aOff + hDef) / 2, 1),
      `${awayAbbr} blended offense ${round(aOff,1)} PPG · ${homeAbbr} blended allowance ${round(hDef,1)} PPG`,
      "NBA-FBIS-FORM-v1 scoreboard team form"
    ));
    const homeExpected = finite(d.matchup?.homeExpected);
    const awayExpected = finite(d.matchup?.awayExpected);
    if (homeExpected != null && awayExpected != null) out.push(factor(
      "form-matchup", "Independent form matchup", sideFromDelta(game, homeExpected - awayExpected),
      round(Math.abs(homeExpected - awayExpected),1),
      `Pre-HFA scoring matchup: ${homeAbbr} ${round(homeExpected,1)} · ${awayAbbr} ${round(awayExpected,1)}`,
      "NBA-FBIS-FORM-v1"
    ));
    return out;
  }

  if (sport !== "cbb") return [];
  const ev = game?.cbbMatchupEvidence;
  if (!ev?.home || !ev?.away) return [];
  const h = ev.home, a = ev.away;
  const pctDetail = (v) => finite(v) == null ? "—" : `${round(finite(v) * 100,1)}%`;
  const numDetail = (v) => finite(v) == null ? "—" : round(v,1);

  const specs = [
    ["efficiency", "Adjusted efficiency", finite(h.adjOe) == null || finite(a.adjDe) == null || finite(a.adjOe) == null || finite(h.adjDe) == null ? null : (finite(h.adjOe)-finite(a.adjDe))-(finite(a.adjOe)-finite(h.adjDe)),
      `${homeAbbr} O ${numDetail(h.adjOe)} vs ${awayAbbr} D ${numDetail(a.adjDe)} · ${awayAbbr} O ${numDetail(a.adjOe)} vs ${homeAbbr} D ${numDetail(h.adjDe)}`],
    ["efg", "Effective FG%", finite(h.efgPct) == null || finite(a.efgPctD) == null || finite(a.efgPct) == null || finite(h.efgPctD) == null ? null : (finite(h.efgPct)-finite(a.efgPctD))-(finite(a.efgPct)-finite(h.efgPctD)),
      `${homeAbbr} ${pctDetail(h.efgPct)} vs allowed ${pctDetail(a.efgPctD)} · ${awayAbbr} ${pctDetail(a.efgPct)} vs allowed ${pctDetail(h.efgPctD)}`],
    ["three", "3-point shooting", finite(h.threePtPct) == null || finite(a.threePtPctD) == null || finite(a.threePtPct) == null || finite(h.threePtPctD) == null ? null : (finite(h.threePtPct)-finite(a.threePtPctD))-(finite(a.threePtPct)-finite(h.threePtPctD)),
      `${homeAbbr} 3P ${pctDetail(h.threePtPct)} vs allowed ${pctDetail(a.threePtPctD)} · ${awayAbbr} 3P ${pctDetail(a.threePtPct)} vs allowed ${pctDetail(h.threePtPctD)}`],
    ["two", "2-point shooting / rim pressure proxy", finite(h.twoPtPct) == null || finite(a.twoPtPctD) == null || finite(a.twoPtPct) == null || finite(h.twoPtPctD) == null ? null : (finite(h.twoPtPct)-finite(a.twoPtPctD))-(finite(a.twoPtPct)-finite(h.twoPtPctD)),
      `${homeAbbr} 2P ${pctDetail(h.twoPtPct)} vs allowed ${pctDetail(a.twoPtPctD)} · ${awayAbbr} 2P ${pctDetail(a.twoPtPct)} vs allowed ${pctDetail(h.twoPtPctD)}`],
    ["turnovers", "Turnover battle", finite(h.tovRate) == null || finite(a.tovRateD) == null || finite(a.tovRate) == null || finite(h.tovRateD) == null ? null : (finite(a.tovRate)-finite(h.tovRateD))-(finite(h.tovRate)-finite(a.tovRateD)),
      `${homeAbbr} TO ${pctDetail(h.tovRate)} · forced by ${awayAbbr} ${pctDetail(a.tovRateD)} · ${awayAbbr} TO ${pctDetail(a.tovRate)} · forced by ${homeAbbr} ${pctDetail(h.tovRateD)}`],
    ["rebounding", "Offensive rebounding", finite(h.orbRate) == null || finite(a.drbRate) == null || finite(a.orbRate) == null || finite(h.drbRate) == null ? null : (finite(h.orbRate)+finite(a.drbRate))-(finite(a.orbRate)+finite(h.drbRate)),
      `${homeAbbr} ORB ${pctDetail(h.orbRate)} · ${awayAbbr} ORB ${pctDetail(a.orbRate)}`],
    ["free-throws", "Free-throw generation", finite(h.ftr) == null || finite(a.ftrD) == null || finite(a.ftr) == null || finite(h.ftrD) == null ? null : (finite(h.ftr)-finite(a.ftrD))-(finite(a.ftr)-finite(h.ftrD)),
      `${homeAbbr} FTR ${pctDetail(h.ftr)} vs allowed ${pctDetail(a.ftrD)} · ${awayAbbr} FTR ${pctDetail(a.ftr)} vs allowed ${pctDetail(h.ftrD)}`],
    ["tempo", "Tempo", finite(h.tempo) == null || finite(a.tempo) == null ? null : finite(h.tempo)-finite(a.tempo),
      `${homeAbbr} ${numDetail(h.tempo)} · ${awayAbbr} ${numDetail(a.tempo)} possessions/40`],
  ];
  for (const [id,label,delta,detail] of specs) {
    if (delta == null) continue;
    out.push(factor(id,label,sideFromDelta(game,delta),Math.abs(round(delta, id==="efficiency"||id==="tempo"?1:3)),detail,ev.source || "CBB research ratings"));
  }
  const matchup = game?.challengers?.["CBB-MATCHUP-v1"];
  if (matchup?.ok && finite(matchup.matchupAdj) != null) out.unshift(factor(
    "four-factor-adjustment", "Four-factor matchup adjustment", sideFromDelta(game, finite(matchup.matchupAdj)),
    Math.abs(round(matchup.matchupAdj,1)), `CBB-MATCHUP-v1 adjustment: ${round(matchup.matchupAdj,1)} points`, "CBB-MATCHUP-v1"
  ));
  return out;
}

export function buildMatchupFactors(game = {}) {
  const explicit = game?.matchupFactors || game?.analysis?.matchupFactors || game?.model?.matchupFactors || game?.researchProjection?.matchupFactors;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const sport = String(game?.sport || "").toLowerCase();
  if (sport === "mlb") return mlbFactors(game);
  if (sport === "nfl" || sport === "cfb") return footballFactors(game);
  if (sport === "nba" || sport === "cbb") return basketballFactors(game);
  return [];
}

export function attachMatchupFactors(games = []) {
  return (games || []).map((game) => ({ ...game, matchupFactors: buildMatchupFactors(game) }));
}
