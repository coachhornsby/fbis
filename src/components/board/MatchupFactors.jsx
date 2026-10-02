function normalizeFactors(game) {
  const raw =
    game?.matchupFactors ||
    game?.analysis?.matchupFactors ||
    game?.model?.matchupFactors ||
    game?.researchProjection?.matchupFactors ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw.map((f, i) => {
    if (typeof f === "string") return { id: i, label: f, edge: null, detail: null };
    return {
      id: f?.id || i,
      label: f?.label || f?.name || f?.matchup || "Matchup factor",
      edge: f?.edge || f?.advantage || f?.team || null,
      detail: f?.detail || f?.reason || f?.summary || null,
      value: f?.value ?? f?.delta ?? null,
    };
  }).filter((f) => f.label);
}

export default function MatchupFactors({ game }) {
  const factors = normalizeFactors(game);
  return (
    <section className="matchup-factors" aria-label="Matchup factors">
      <div className="matchup-factors-head">
        <div>
          <span className="matchup-factors-kicker">FBIS ANALYSIS</span>
          <h2>Matchup Factors</h2>
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
            </article>
          ))}
        </div>
      ) : (
        <p className="matchup-factors-empty">
          No structured offense-vs-defense matchup factors are published for this game yet. FBIS will not infer them from the market line.
        </p>
      )}
    </section>
  );
}
