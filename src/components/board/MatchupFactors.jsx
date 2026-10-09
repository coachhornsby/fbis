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
    };
  }).filter((f) => f.label);
}

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
  const factors = sport === "nfl" ? [...gameSpecific, ...supplemental] : legacyFactors;
  return (
    <section className={`matchup-factors${sport === "nfl" ? " matchup-factors-nfl" : ""}`} aria-label="Matchup factors">
      <div className="matchup-factors-head">
        <div>
          <span className="matchup-factors-kicker">FBIS ANALYSIS</span>
          <h2>{sport === "nfl" ? "Why FBIS Sees This Game This Way" : titleForSport(sport)}</h2>
        </div>
        <span className="matchup-factors-count">{sport === "nfl" && matchup?.coverage ? `${factors.length} published · ${matchup.coverage.available}/${matchup.coverage.total} game-specific · ${matchup.adjustment?.evidenceQualified ? "qualified" : "analysis only"}` : factors.length ? `${factors.length} published` : "Awaiting model factors"}</span>
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
      {factors.length ? (
        <div className="matchup-factors-grid">
          {factors.map((factor) => (
            <article className="matchup-factor" key={factor.id}>
              <span className="matchup-factor-label">{factor.label}</span>
              {factor.edge ? <strong className="matchup-factor-edge">{factor.edge}</strong> : null}
              {factor.value != null ? <span className="matchup-factor-value">{factor.value}</span> : null}
              {factor.detail ? <p>{factor.detail}</p> : null}
              {factor.source ? <small className="matchup-factor-source">{factor.source}</small> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="matchup-factors-empty">
          No source-backed matchup factors are published for this game yet. FBIS will not infer matchup advantages from the market line.
        </p>
      )}
    </section>
  );
}
