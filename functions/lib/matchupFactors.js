/**
 * Client-facing matchup-factor contract.
 * Presentation evidence only: consumes model/source fields already attached to each game.
 * Never changes projections, qualification, confidence, or wager authority.
 */

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Strict parsing only for football/NHL presentation; no projection inputs are modified.
function evidenceNumber(value) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const n = Number(value);
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
    const home = evidenceNumber(hv);
    const away = evidenceNumber(av);
    const coverageKey = { passing: "pass", rushing: "rush", explosive: "explosives", finishing: "finishingDrives" }[id] || id;
    const missing = sport === "cfb" && shadow.coverage?.missing?.includes(coverageKey);
    if (missing || home == null || away == null) return [factor(id, label, "UNAVAILABLE", null,
      "Required explanatory inputs unavailable; neutral model fallback is not a measured matchup.",
      sport === "nfl" ? "NFL-PRO-v1 decomposition" : "CFB-MATCHUP-v2 decomposition")];
    const delta = home - away;
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
    const pure = game?.nbaFbisV1;
    const pd = pure?.decomposition;
    if (pure?.ok && pd?.home && pd?.away) {
      const h = pd.home, a = pd.away;
      const src = "NBA-FBIS-v1 frozen decomposition";
      const pushPair = (id,label,hv,av,{lowerBetter=false,digits=2,suffix=""}={}) => {
        const hn=finite(hv), an=finite(av); if(hn==null||an==null)return;
        const delta=lowerBetter?an-hn:hn-an;
        out.push(factor(id,label,sideFromDelta(game,delta),Math.abs(round(hn-an,digits)),
          `${homeAbbr} ${round(hn,digits)}${suffix} · ${awayAbbr} ${round(an,digits)}${suffix}`,src));
      };
      const hOff=finite(h.off),aOff=finite(a.off),hDef=finite(h.def),aDef=finite(a.def);
      if([hOff,aOff,hDef,aDef].every(v=>v!=null)){
        const delta=(hOff-aDef)-(aOff-hDef);
        out.push(factor("efficiency","Offense vs defense efficiency",sideFromDelta(game,delta),Math.abs(round(delta,1)),
          `${homeAbbr} ORtg ${round(hOff,1)} vs ${awayAbbr} DRtg ${round(aDef,1)} · ${awayAbbr} ORtg ${round(aOff,1)} vs ${homeAbbr} DRtg ${round(hDef,1)}`,src));
      }
      pushPair("pace","Pace",h.pace,a.pace,{digits:1});
      pushPair("efg","Effective FG%",h.efg,a.efg,{digits:3});
      pushPair("turnovers","Turnover rate",h.tov,a.tov,{lowerBetter:true,digits:3});
      pushPair("rebounding","Offensive rebound rate",h.orb,a.orb,{digits:3});
      pushPair("free-throws","Free-throw rate",h.ftr,a.ftr,{digits:3});
      const hRest=finite(pd.homeRest?.pts),aRest=finite(pd.awayRest?.pts);
      if(hRest!=null&&aRest!=null) pushPair("rest","Rest / schedule impact",hRest,aRest,{digits:2});
      const hAvail=finite(pd.homeAvailability?.points),aAvail=finite(pd.awayAvailability?.points);
      if(hAvail!=null&&aAvail!=null&&(Math.abs(hAvail)>0.01||Math.abs(aAvail)>0.01))
        pushPair("availability","Availability impact",hAvail,aAvail,{digits:2});
      if(finite(pure.margin)!=null) out.push(factor(
        "projection","Independent possession-model matchup",sideFromDelta(game,pure.margin),Math.abs(round(pure.margin,1)),
        `Independent score: ${awayAbbr} ${pure.away} · ${homeAbbr} ${pure.home} · ${round(pure.expectedPossessions,1)} possessions`,src
      ));
      if(out.length) return out;
    }

    // Fail-soft fallback when the frozen NBA research snapshot is not present.
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


function baseballAsiaFactors(game, sport) {
  const model = sport === "npb" ? game?.npbV2 : game?.kboV2;
  if (!model?.ok) return [];
  const h = model.components?.home || {}, a = model.components?.away || {};
  const src = sport === "npb" ? "NPB-FBIS-v2" : "KBO-FBIS-v2";
  const out = [];
  const addPair = (id,label,hv,av,icon="⚾") => {
    const hn=finite(hv), an=finite(av); if(hn==null||an==null)return;
    out.push(factor(id, `${icon} ${label}`, sideFromDelta(game,hn-an), Math.abs(round(hn-an,2)),
      `${abbr(game,"home")} ${round(hn,2)} · ${abbr(game,"away")} ${round(an,2)}`, src));
  };
  addPair("offense","Offensive run creation",h.offenseFactor,a.offenseFactor,"🔥");
  const hs=model.starters?.home, as=model.starters?.away;
  if(hs||as){
    const hera=finite(hs?.era), aera=finite(as?.era);
    if(hera!=null||aera!=null) out.push(factor("starters","🎯 Starting pitching",
      hera!=null&&aera!=null?(hera<aera?abbr(game,"home"):aera<hera?abbr(game,"away"):"EVEN"):null,
      hera!=null&&aera!=null?Math.abs(round(hera-aera,2)):null,
      `${abbr(game,"home")} ${hs?.name||"starter"} ERA ${hera??"—"} · ${abbr(game,"away")} ${as?.name||"starter"} ERA ${aera??"—"}`,src));
  }
  addPair("run-prevention","Run prevention",h.preventionFactor,a.preventionFactor,"🧱");
  addPair("bullpen","Bullpen / run prevention",finite(h.bullpenEra)==null?null:-finite(h.bullpenEra),finite(a.bullpenEra)==null?null:-finite(a.bullpenEra),"🧱");
  addPair("lineup","Lineup strength",h.lineupFactor,a.lineupFactor,"💥");
  addPair("form","Recent form",h.recentFactor,a.recentFactor,"📈");
  const park=finite(h.parkFactor ?? a.parkFactor);
  if(park!=null) out.push(factor("environment","🌤️ Park / run environment",park>1.01?"HITTERS":park<0.99?"PITCHERS":"EVEN",
    `${round((park-1)*100,1)>0?"+":""}${round((park-1)*100,1)}%`,`Run environment factor ${round(park,3)}`,src));
  return out;
}

function wnbaFactors(game) {
  const p=game?.wnbaV2; const d=p?.decomposition;
  if(!p?.ok||!d?.home||!d?.away)return [];
  const H=abbr(game,"home"),A=abbr(game,"away"),out=[];
  const add=(id,label,hv,av,icon)=>{const h=finite(hv),a=finite(av);if(h==null||a==null)return;
    out.push(factor(id,`${icon} ${label}`,sideFromDelta(game,h-a),Math.abs(round(h-a,1)),
      `${H} ${round(h,1)} · ${A} ${round(a,1)}`,"WNBA-FBIS-v2 possession/efficiency"));};
  add("matchup-eff","Matchup efficiency",d.home.matchupOrtg,d.away.matchupOrtg,"⚡");
  add("offense","Offensive rating",d.home.ortg,d.away.ortg,"🔥");
  add("defense","Defensive rating",-(finite(d.home.drtg)??0),-(finite(d.away.drtg)??0),"🛡️");
  add("pace","Pace",d.home.pace,d.away.pace,"🏃");
  if(finite(p.margin)!=null) out.push(factor("projection","🎯 Possession-model matchup",sideFromDelta(game,p.margin),Math.abs(round(p.margin,1)),
    `Independent score: ${A} ${p.away} · ${H} ${p.home}`,"WNBA-FBIS-v2"));
  return out;
}

function nhlFactors(game) {
  const p=game?.nhlProV2; const l=p?.layers;
  if(!p?.ok||!l)return [];
  const H=abbr(game,"home"),A=abbr(game,"away"),out=[];
  const pair=(id,label,hv,av,icon,source="NHL-PRO-v2")=>{const h=evidenceNumber(hv),a=evidenceNumber(av);if(h==null||a==null)return;
    out.push(factor(id,`${icon} ${label}`,sideFromDelta(game,h-a),Math.abs(round(h-a,2)),`${H} ${round(h,2)} · ${A} ${round(a,2)}`,source));};
  pair("five-v-five","5v5 expected goals",l.eventChainXg?.home,l.eventChainXg?.away,"🏒");
  pair("finishing","Finishing / shooting",l.finishing?.home,l.finishing?.away,"🎯");
  const hg=evidenceNumber(l.goalie?.home?.impactPerShot),ag=evidenceNumber(l.goalie?.away?.impactPerShot);
  const goalieAvailable = (g) => g?.goalieId != null && g?.source === "NHL_PRO_V2_GSAX" && evidenceNumber(g.impactPerShot) != null;
  if (goalieAvailable(l.goalie?.home) && goalieAvailable(l.goalie?.away)) {
    pair("goaltending","Historical goalie GSAx impact",hg,ag,"🥅","NHL-PRO-v2 historical prior; not confirmed game-day starters");
  } else {
    out.push(factor("goaltending", "🥅 Goaltending GSAx impact", "UNAVAILABLE", null,
      "Goalie identity or learned historical prior unavailable; starting goalies are not confirmed by this layer.", "NHL-PRO-v2"));
  }
  pair("special-teams","Special teams xG",l.specialTeams?.home,l.specialTeams?.away,"⚡");
  const hp=evidenceNumber(l.tracking?.historicalProxy?.homeHighDanger),ap=evidenceNumber(l.tracking?.historicalProxy?.awayHighDanger);
  if(hp!=null&&ap!=null) pair("high-danger","High-danger chances",hp,ap,"🔥");
  const hr=evidenceNumber(l.situation?.homeRestDays),ar=evidenceNumber(l.situation?.awayRestDays);
  if(hr!=null&&ar!=null) pair("rest","Rest / schedule",hr,ar,"🧊");
  return out;
}

function soccerFactors(game) {
  const p=game?.soccerFbis; if(!p?.ok)return [];
  const d=p.diagnostics||{},H=abbr(game,"home"),A=abbr(game,"away"),out=[];
  const pair=(id,label,hv,av,icon,lowerBetter=false)=>{const h=finite(hv),a=finite(av);if(h==null||a==null)return;
    const delta=lowerBetter?a-h:h-a;
    out.push(factor(id,`${icon} ${label}`,sideFromDelta(game,delta),Math.abs(round(h-a,2)),`${H} ${round(h,2)} · ${A} ${round(a,2)}`,"SOCCER-FBIS-v1 point-in-time history"));};
  pair("attack","Attack strength",d.homeAttackRate,d.awayAttackRate,"⚽");
  pair("defense","Defensive resistance",d.homeDefenseRate,d.awayDefenseRate,"🛡️",true);
  if(finite(p.home)!=null&&finite(p.away)!=null) pair("expected-goals","Expected goals",p.home,p.away,"🎯");
  if(finite(d.homeRestDays)!=null&&finite(d.awayRestDays)!=null) pair("rest","Rest / schedule",d.homeRestDays,d.awayRestDays,"🔋");
  if(finite(p.pBttsYes)!=null) out.push(factor("btts","🔥 Both-teams-to-score profile",p.pBttsYes>=.5?"YES":"NO",round(p.pBttsYes*100,1)+"%",
    `Model BTTS Yes ${round(p.pBttsYes*100,1)}%`,"SOCCER-FBIS-v1"));
  return out;
}

function tennisFactors(game) {
  const t=game?.tennisMatchup || game?.tennisAnalytics || game?.matchup?.tennis;
  if(!t)return [];
  const P1=game?.away?.abbr||game?.away?.name||"P1",P2=game?.home?.abbr||game?.home?.name||"P2",out=[];
  const pair=(id,label,a,b,icon,higher=true,source="FBIS tennis analytics")=>{const x=finite(a),y=finite(b);if(x==null||y==null)return;
    const delta=higher?y-x:x-y; out.push(factor(id,`${icon} ${label}`,Math.abs(delta)<.0001?"EVEN":delta>0?P2:P1,Math.abs(round(y-x,2)),`${P1} ${round(x,2)} · ${P2} ${round(y,2)}`,source));};
  pair("form","Recent form",t.away?.formRating,t.home?.formRating,"📈");
  pair("surface","Surface rating / Elo",t.away?.surfaceElo,t.home?.surfaceElo,"🎾");
  pair("serve","Serve strength",t.away?.holdPct??t.away?.servePointsWon,t.home?.holdPct??t.home?.servePointsWon,"💣");
  pair("return","Return pressure",t.away?.breakPct??t.away?.returnPointsWon,t.home?.breakPct??t.home?.returnPointsWon,"↩️");
  pair("fitness","Fitness / load",t.away?.fitnessScore??t.away?.restScore,t.home?.fitnessScore??t.home?.restScore,"🔋");
  return out;
}

export function buildMatchupFactors(game = {}) {
  const explicit = game?.matchupFactors || game?.analysis?.matchupFactors || game?.model?.matchupFactors || game?.researchProjection?.matchupFactors;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const sport = String(game?.sport || "").toLowerCase();
  if (sport === "mlb") return mlbFactors(game);
  if (sport === "nfl" || sport === "cfb") return footballFactors(game);
  if (sport === "nba" || sport === "cbb") return basketballFactors(game);
  if (sport === "wnba") return wnbaFactors(game);
  if (sport === "nhl") return nhlFactors(game);
  if (sport === "npb" || sport === "kbo") return baseballAsiaFactors(game, sport);
  if (sport === "soccer") return soccerFactors(game);
  if (sport === "tennis" || sport === "atp" || sport === "wta") return tennisFactors(game);
  return [];
}

export function attachMatchupFactors(games = []) {
  return (games || []).map((game) => ({ ...game, matchupFactors: buildMatchupFactors(game) }));
}
