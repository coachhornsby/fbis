import TeamLogo from "../TeamLogo.jsx";
import { matchupSignalColors } from "../../lib/matchupTeamBrand.js";
import "./mlbPitchHitMatchups.css";

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 1) {
  const n = finite(v);
  if (n == null) return "—";
  const scaled = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${scaled.toFixed(digits)}%`;
}

function signedPct(v, digits = 1) {
  const n = finite(v);
  if (n == null) return "—";
  const scaled = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${scaled > 0 ? "+" : ""}${scaled.toFixed(digits)}%`;
}

function fmt(v, digits = 3) {
  const n = finite(v);
  return n == null ? "—" : n.toFixed(digits);
}

function starterInfo(game, side) {
  const persistent = game?.mlbPersistentState?.[side === "home" ? "homeStarter" : "awayStarter"] || null;
  const raw = game?.[side === "home" ? "homeSp" : "awaySp"] || {};
  const era = persistent?.era ?? game?.savant?.[side === "home" ? "homeSpEra" : "awaySpEra"] ?? null;
  const id = raw?.id ?? persistent?.id ?? null;
  return {
    id,
    name: raw?.name || persistent?.name || null,
    era: finite(era),
    wins: persistent?.wins ?? null,
    losses: persistent?.losses ?? null,
    image: id
      ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_auto:best/v1/people/${id}/headshot/67/current`
      : null,
  };
}

function factorById(game, id) {
  const rows = Array.isArray(game?.matchupFactors) ? game.matchupFactors : [];
  return rows.find((r) => String(r?.id) === id) || null;
}

function pitchPacket(game, offenseSide) {
  const pitch = game?.mlbPitchMatchup || {};
  return offenseSide === "home" ? pitch.homeOffense || null : pitch.awayOffense || null;
}

function bppRow(game, offenseSide) {
  const matchup = game?.bpp?.matchup || {};
  return offenseSide === "home" ? matchup.vsAwaySp || null : matchup.vsHomeSp || null;
}

function edgeFromRunFactor(rf, lineupTeam, pitcherTeam) {
  const n = finite(rf);
  if (n == null) return { edge: "EVEN", side: null };
  if (n >= 1.02) return { edge: lineupTeam?.abbr || "HITTERS", side: "lineup" };
  if (n <= 0.98) return { edge: pitcherTeam?.abbr || "PITCHING", side: "pitcher" };
  return { edge: "EVEN", side: null };
}

function buildSide({ game, away, home, offenseSide }) {
  const pitcherSide = offenseSide === "home" ? "away" : "home";
  const lineup = offenseSide === "home" ? home : away;
  const pitcherTeam = offenseSide === "home" ? away : home;
  const sp = starterInfo(game, pitcherSide);
  const packet = pitchPacket(game, offenseSide);
  const bpp = bppRow(game, offenseSide);
  const factor = factorById(game, `pitch-vs-hit-${offenseSide}`)
    || factorById(game, `lineup-${offenseSide}`)
    || factorById(game, `starter-${pitcherSide}`);
  const kProj = finite(packet?.projectedKs)
    ?? finite(game?.mlbDeepShadow?.pitcherKs?.[pitcherSide]?.projection)
    ?? (typeof factor?.value === "string" && /k proj/i.test(factor.value)
      ? finite(String(factor.value).replace(/[^\d.-]/g, ""))
      : null);

  const runFactor = finite(packet?.runFactor);
  const edgeMeta = edgeFromRunFactor(runFactor, lineup, pitcherTeam);
  const factorEdge = String(factor?.edge || "").toUpperCase();
  const edgeAbbr = edgeMeta.edge !== "EVEN"
    ? edgeMeta.edge
    : factorEdge && !["EVEN", "UNAVAILABLE", "UNKNOWN", "HITTERS", "PITCHERS"].includes(factorEdge)
      ? factorEdge
      : "EVEN";

  const metrics = [
    { label: "RUN FACTOR", value: runFactor == null ? "—" : fmt(runFactor, 3) },
    { label: "xwOBA", value: packet?.xwoba == null ? "—" : fmt(packet.xwoba, 3) },
    { label: "LINEUP K", value: packet?.lineupKRate == null ? "—" : pct(packet.lineupKRate) },
    { label: "WHIFF", value: packet?.whiffPerSwing == null ? "—" : pct(packet.whiffPerSwing) },
    { label: "CONTACT", value: packet?.contactPerSwing == null ? "—" : pct(packet.contactPerSwing) },
    { label: "HARD HIT", value: packet?.hardHitRate == null ? "—" : pct(packet.hardHitRate) },
    { label: "ARSENAL", value: packet?.dynamicDifficulty == null ? "—" : fmt(packet.dynamicDifficulty, 2) },
    { label: "K PROJ", value: kProj == null ? "—" : fmt(kProj, 1) },
  ];

  const bppBits = [
    finite(bpp?.rcVs) == null ? null : `RC ${signedPct(bpp.rcVs, 0)}`,
    finite(bpp?.hrVs) == null ? null : `HR ${signedPct(bpp.hrVs, 0)}`,
    finite(bpp?.kVs) == null ? null : `K ${signedPct(bpp.kVs, 0)}`,
  ].filter(Boolean);

  const available = Boolean(
    packet
    || bppBits.length
    || kProj != null
    || sp.name
    || factor
  );

  return {
    id: `mlb-pvh-${offenseSide}`,
    offenseSide,
    pitcherSide,
    lineup,
    pitcherTeam,
    sp,
    edgeAbbr,
    edgeTeam: edgeAbbr === away?.abbr ? away : edgeAbbr === home?.abbr ? home : null,
    runEnv: runFactor == null ? null : signedPct(runFactor - 1, 1),
    metrics,
    bppBits,
    detail: factor?.detail || (packet
      ? "Statcast arsenal × contact-zone research."
      : bppBits.length
        ? "Ballpark Pal starter matchup research."
        : "Starter projection inputs."),
    source: packet
      ? "STATCAST PITCH × HITTER ZONE"
      : bppBits.length
        ? "BALLPARK PAL MATCHUP"
        : "MLB-FBIS STARTER",
    available,
  };
}

export function mlbPitchHitSides(game, away, home) {
  return [
    buildSide({ game, away, home, offenseSide: "home" }),
    buildSide({ game, away, home, offenseSide: "away" }),
  ];
}

export default function MlbPitchHitMatchups({ game, away, home }) {
  const sides = mlbPitchHitSides(game, away, home);
  const available = sides.filter((s) => s.available);
  const homeRf = finite(pitchPacket(game, "home")?.runFactor);
  const awayRf = finite(pitchPacket(game, "away")?.runFactor);
  const edgeFactor = factorById(game, "pitch-hit-edge");
  let summaryEdge = String(edgeFactor?.edge || "").toUpperCase() || "EVEN";
  let summaryValue = edgeFactor?.value || "—";
  if ((summaryEdge === "EVEN" || !edgeFactor) && homeRf != null && awayRf != null) {
    const delta = homeRf - awayRf;
    summaryEdge = Math.abs(delta) < 0.015 ? "EVEN" : delta > 0 ? (home?.abbr || "HOME") : (away?.abbr || "AWAY");
    summaryValue = `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}% run env`;
  }
  const summaryTeam = summaryEdge === away?.abbr ? away : summaryEdge === home?.abbr ? home : null;

  return (
    <section className="mlb-pvh" aria-label="Pitching versus opponent hitting matchup">
      <header className="mlb-pvh-head">
        <div>
          <span>GAME MATCHUP</span>
          <strong>Pitching vs Opponent Hitting</strong>
        </div>
        <b>{available.length} of {sides.length} sides available</b>
      </header>

      <div className="mlb-pvh-summary" aria-label="Lineup versus pitching profile edge">
        <div className="mlb-pvh-summary-edge">
          {summaryTeam ? <TeamLogo team={{ ...summaryTeam, sport: "mlb" }} size={36} /> : null}
          <div>
            <small>PROFILE EDGE</small>
            <strong>{summaryTeam?.abbr || summaryEdge}</strong>
          </div>
        </div>
        <div>
          <small>RUN ENV Δ</small>
          <strong>{summaryValue}</strong>
        </div>
        <p>Lineup contact-zone profile versus opposing starter arsenal. Research only — not wager authority.</p>
      </div>

      <div className="mlb-pvh-grid">
        {sides.map((side) => {
          const edgeColors = side.edgeTeam
            ? matchupSignalColors(side.edgeTeam, "mlb")
            : null;
          const record = side.sp.wins != null && side.sp.losses != null
            ? `${side.sp.wins}-${side.sp.losses}`
            : null;
          return (
            <article
              key={side.id}
              className={`mlb-pvh-card${side.available ? "" : " is-empty"}${side.edgeTeam ? " has-edge" : ""}`}
              style={edgeColors ? {
                "--mlb-pvh-primary": edgeColors.primary || "#315b7a",
                "--mlb-pvh-accent": edgeColors.secondary || "#97cde8",
              } : undefined}
            >
              <div className="mlb-pvh-card-top">
                <div className="mlb-pvh-sp">
                  <span className="mlb-pvh-bubble">
                    {side.sp.image
                      ? <img src={side.sp.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      : <em>{(side.sp.name || "?").slice(0, 1)}</em>}
                  </span>
                  <div>
                    <small>STARTING PITCHER · {side.pitcherTeam?.abbr || "—"}</small>
                    <strong>{side.sp.name || "TBD"}</strong>
                    <span>
                      {[record, side.sp.era != null ? `${side.sp.era.toFixed(2)} ERA` : null]
                        .filter(Boolean).join(" · ") || "Starter profile"}
                    </span>
                  </div>
                </div>
                <div className="mlb-pvh-vs">
                  <span>VS</span>
                  <TeamLogo team={{ ...side.lineup, sport: "mlb" }} size={42} />
                  <strong>{side.lineup?.abbr || "LINEUP"}</strong>
                </div>
              </div>

              <div className="mlb-pvh-edge-row">
                <span>EDGE</span>
                <strong>{side.edgeAbbr}</strong>
                <b>{side.runEnv || "—"}</b>
              </div>

              <div className="mlb-pvh-metrics" aria-label="Advanced matchup metrics">
                {side.metrics.map((m) => (
                  <div key={m.label}>
                    <small>{m.label}</small>
                    <strong>{m.value}</strong>
                  </div>
                ))}
              </div>

              {side.bppBits.length ? (
                <p className="mlb-pvh-bpp">{side.bppBits.join(" · ")}</p>
              ) : null}
              <p className="mlb-pvh-detail">{side.detail}</p>
              <small className="mlb-pvh-source">{side.source}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
