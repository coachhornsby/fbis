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
  return "Matchup Factors";
}

export default function MatchupFactors({ game }) {
  const factors = normalizeFactors(game);
  const sport = String(game?.sport || "").toLowerCase();
  return (
    <section className="matchup-factors" aria-label="Matchup factors">
      <div className="matchup-factors-head">
        <div>
          <span className="matchup-factors-kicker">FBIS ANALYSIS</span>
          <h2>{titleForSport(sport)}</h2>
        </div>
        <span className="matchup-factors-count">{factors.length ? `${factors.length} published` : "Awaiting model factors"}</span>
      </div>
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
