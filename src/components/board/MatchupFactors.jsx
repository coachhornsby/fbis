import TeamLogo from "../TeamLogo.jsx";
import {cfbDirectionalEvidence} from "./CfbDirectionalMatchups.jsx";
import {matchupAdvantageTeam,matchupSignalColors} from "../../lib/matchupTeamBrand.js";
import { evidenceNumber } from "../../lib/boardEvidence.js";
function normalizeFactors(game) {
  const raw =
    game?.matchupFactors ||
    game?.analysis?.matchupFactors ||
    game?.model?.matchupFactors ||
    game?.researchProjection?.matchupFactors ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw.map((f, i) => {
    if (typeof f === "string") return { id: i, label: f, edge: null, detail: null, source: null };
    return {
      id: f?.id || i,
      label: f?.label || f?.name || f?.matchup || "Matchup factor",
      edge: f?.edge || f?.advantage || f?.team || null,
      detail: f?.detail || f?.reason || f?.summary || null,
      value: f?.value ?? f?.delta ?? null,
      source: f?.source || null,
      available: f?.available !== false && !/^(unavailable|unknown|unverified|not available)$/i.test(String(f?.edge || f?.advantage || "")),
    };
  }).filter((f) => f.label);
}

const factorContext = {
  passing:"The passing component compares each offense with the opposing pass defense.",
  pass:"The passing component compares each offense with the opposing pass defense.",
  rushing:"The rushing component compares each offense with the opposing run defense.",
  rush:"The rushing component compares each offense with the opposing run defense.",
  success:"Success rate tracks how often plays keep the offense on schedule.",
  explosive:"Explosiveness compares the teams' big-play component.",
  havoc:"Havoc summarizes the recorded defensive disruption component.",
  pressure:"Pressure and protection compare the pass rush with pass blocking.",
  trenches:"The trenches component compares the line play inputs.",
  finishing:"Finishing drives compares the scoring-opportunity component.",
  quarterback:"The quarterback component reflects the available QB inputs.",
  qb:"The quarterback component reflects the available QB inputs.",
  pace:"Pace describes playing speed; a higher rate alone is not a team advantage.",
  efg:"Effective field-goal percentage weights the extra scoring value of three-pointers.",
  turnovers:"Turnover rate measures how often possessions end with a giveaway.",
  rebounding:"Offensive rebounding creates additional scoring possessions.",
  "free-throws":"Free-throw rate compares how frequently teams reach the line.",
  rest:"The rest component records the model's schedule adjustment.",
  availability:"Availability records the model's personnel adjustment.",
};
function titleForSport(sport) {
  if (sport === "mlb") return "Pitcher & Lineup Matchups";
  if (sport === "nfl" || sport === "cfb") return "Offense vs Defense Matchups";
  if (sport === "nba" || sport === "cbb") return "Basketball Matchup Factors";
  return "Matchup Factors";
}

export default function MatchupFactors({ game }) {
  const summaryMargin = (value, signed = false) => {
    const n = evidenceNumber(value);
    if (!Number.isFinite(n)) return "—";
    if (signed) return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
    return `${n > 0 ? game?.home?.abbr : game?.away?.abbr} ${Math.abs(n).toFixed(1)}`;
  };
  const legacyFactors = normalizeFactors(game);
  const sport = String(game?.sport || "").toLowerCase();
  const matchup = sport === "nfl" ? game?.nflGameMatchup : null;
  const matchupSignals = Array.isArray(matchup?.signals) ? matchup.signals : [];
  const gameSpecific = matchupSignals.filter((s) => s?.available).map((s) => ({
    id: `game-${s.id}`,
    label: s.label,
    edge: !Number.isFinite(evidenceNumber(s.adjustment)) ? "UNAVAILABLE" : Math.abs(evidenceNumber(s.adjustment)) < 0.15 ? "EVEN" : Number(s.adjustment) > 0 ? game?.home?.abbr : game?.away?.abbr,
    value: Number.isFinite(evidenceNumber(s.adjustment)) ? (evidenceNumber(s.adjustment) > 0 ? "+" : "") + evidenceNumber(s.adjustment).toFixed(1) : null,
    detail: s.evidence || null,
    source: "GAME MATCHUP ENGINE",
  }));
  const covered = new Set(gameSpecific.map((f) => String(f.id).replace(/^game-/, "")));
  const supplemental = sport === "nfl"
    ? legacyFactors.filter((f) => !covered.has(String(f.id)))
    : legacyFactors;
  const sourceFactors = sport === "cfb" ? cfbDirectionalEvidence(game).filter(r => r.available).map(r => {
    const offense=game[r.off] || {}, defense=game[r.off === "home" ? "away" : "home"] || {};
    const off=offense.abbr || offense.name || r.off, def=defense.abbr || defense.name || "Opponent";
    const kind=r.kind === "pass" ? "passing" : "rushing";
    const sourceComparison=["CFBD_TIER3_ADJUSTED","SDV_SEASON","SDV_SOURCE_OBSERVED_RESEARCH"].includes(r.sourceType);
    const delta=Number(r.value);
    const value=sourceComparison ? `${delta>0?"+":""}${delta.toFixed(3)} EPA/play` : `${delta>0?"+":""}${delta.toFixed(2)} component`;
    const difference=sourceComparison ? `${off} ${kind} offense minus ${def} ${kind} defense allowed: ${value}.` : `${off} ${kind} offense vs ${def} defense: ${value} in the recorded unit comparison.`;
    const secondary=r.cfbdDifference!=null&&r.sdvDifference!=null ? ` Independent SDV comparison: ${r.sdvDifference>0?"+":""}${Number(r.sdvDifference).toFixed(3)} EPA/play.` : "";
    return {id:`source-${r.id}`,label:`${off} ${kind} offense vs ${def} defense`,
      edge:r.winner ? game[r.winner]?.abbr || game[r.winner]?.name : "EVEN",value,
      detail:difference+secondary+(r.disagreement ? " The sources point in different directions." : "")+" An efficiency comparison, not a predicted scoring margin.",
      source:r.sourceType === "CFBD_TIER3_ADJUSTED" ? "CFBD adjusted efficiency · research comparison" : sourceComparison ? "SportsDataverse season efficiency · research comparison" : "Recorded unit comparison",
      available:true,researchComparison:true};
  }) : [];
  const factors = sport === "nfl" ? [...gameSpecific, ...supplemental] : [...legacyFactors,...sourceFactors];
  const availableFactors = factors.filter(f => f.available !== false && !/^(unavailable|unknown|unverified|not available)$/i.test(String(f.edge || "")));
  return (
    <section className={`matchup-factors matchup-factors-dynamic${sport === "nfl" ? " matchup-factors-nfl" : ""}`} aria-label="Matchup factors">
      <div className="matchup-factors-head">
        <div>
          <span className="matchup-factors-kicker">FBIS ANALYSIS</span>
          <h2>{sport === "nfl" ? "Why FBIS Sees This Game This Way" : titleForSport(sport)}</h2>
        </div>
        <span className="matchup-factors-count">{`${availableFactors.length} available · ${factors.length-availableFactors.length} pending`}</span>
      </div>
      {sport === "nfl" && matchup?.ok ? (
        <div className="matchup-factors-summary">
          <span>BASELINE <strong>{summaryMargin(matchup.baseline?.margin)}</strong></span>
          <i>→</i>
          <span>MATCHUP ADJ <strong>{summaryMargin(matchup.adjustment?.margin, true)}</strong></span>
          <i>→</i>
          <span>GAME READ <strong>{summaryMargin(matchup.final?.margin)}</strong></span>
        </div>
      ) : null}
      {sourceFactors.length ? <p className="matchup-factors-empty">Source matchup comparisons are shown alongside available model factors. Source statistics do not establish which inputs drove the active projection.</p> : null}
      {availableFactors.length ? (
        <div className="matchup-factors-grid">
          {availableFactors.map((factor) => {
            const identified=matchupAdvantageTeam(factor,game.away,game.home);
            const colors=identified ? matchupSignalColors(identified.team,sport) : null;
            const title=identified?.team?.fullName || identified?.team?.name || factor.edge;
            const synopsis=(factor.researchComparison ? "" : `${factorContext[String(factor.id).replace(/^game-/,"")] || ""} `) + (factor.detail || `${factor.label}: ${factor.value ?? "available"}. ${title && title !== "EVEN" ? `Recorded factor direction: ${title}.` : "No directional team separation reported."}`);
            return <article className={`matchup-factor${identified ? " is-team-branded" : " is-neutral"}`} key={factor.id}
              style={identified ? {"--factor-team":colors?.primary || "#315b7a","--factor-accent":colors?.secondary || "#97cde8"} : undefined}>
              <span className="matchup-factor-label">{factor.label}</span>
              <div className="matchup-factor-identity">
                {identified ? <TeamLogo team={{...identified.team,sport}} size={46} /> : null}
                {factor.edge ? <strong className="matchup-factor-edge">{title}</strong> : null}
              </div>
              {factor.value != null ? <span className="matchup-factor-value">{factor.value}</span> : null}
              <p className="matchup-factor-synopsis">{synopsis}</p>
              {factor.researchComparison ? <small className="matchup-factor-kind">SOURCE COMPARISON · NOT MODEL ATTRIBUTION</small> : null}
              {factor.source ? <small className="matchup-factor-source">{factor.source}</small> : null}
            </article>;
          })}
        </div>
      ) : (
        <p className="matchup-factors-empty">
          Model explanation inputs unavailable. External matchup statistics may still appear above; they do not establish which inputs drove the projection.
        </p>
      )}
    </section>
  );
}
