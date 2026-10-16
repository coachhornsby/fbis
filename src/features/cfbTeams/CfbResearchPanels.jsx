/**
 * Research-only CORE/advanced charts + player prop input cards for CFB team pages.
 * National percentile bars + FBIS-computed ranks — never wager authority.
 */

const BAND_COLORS = {
  Elite: "#3ecf8e",
  Strong: "#5bb8e8",
  "Above Average": "#c5d4e0",
  "Below Average": "#d4a35c",
  Poor: "#d66a6a",
};

function fmt(v, digits = 3) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtMetric(metric) {
  if (metric?.value == null) return "—";
  if (metric.format === "elo") return fmt(metric.value, 0);
  if (metric.format === "ppa" || metric.format === "rate") return fmt(metric.value, 3);
  if (metric.format === "yards") return fmt(metric.value, 2);
  return fmt(metric.value, 2);
}

function PercentileMetricList({ series = [] }) {
  if (!series.length) return null;
  return (
    <ul className="ft-metric-rank-list">
      {series.map((m) => {
        const pct = m.percentile;
        const band = m.performance;
        const color = BAND_COLORS[band] || "#8aa3b5";
        const barW = pct == null ? 0 : Math.max(2, Math.min(100, pct));
        const tip = [
          m.description,
          `Units: ${m.units || "n/a"}`,
          `Preferred direction: ${m.preferredDirection === "higher" ? "higher is better" : "lower is better"}`,
          m.ratingKind === "source_published" ? "Value: source-published rating" : "Value: derived research statistic",
          `Ranks: ${m.rankAuthority || "fbis_computed_research"}`,
          m.source ? `Source: ${m.source}` : null,
          m.season != null ? `Season: ${m.season}` : null,
          m.asOf ? `As of: ${m.asOf}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <li className="ft-metric-rank" key={m.id} title={tip}>
            <div className="ft-metric-rank-top">
              <div className="ft-metric-rank-label">
                <strong>{m.label}</strong>
                <span className="ft-metric-info" aria-label={tip}>i</span>
                <em className="ft-polarity">{m.preferredDirection === "higher" ? "↑ better" : "↓ better"}</em>
              </div>
              <div className="ft-metric-rank-value">{fmtMetric(m)}</div>
            </div>
            <div className="ft-percentile-track" aria-hidden={pct == null}>
              <div className="ft-percentile-fill" style={{ width: `${barW}%`, background: color }} />
            </div>
            <div className="ft-metric-rank-meta">
              {band ? <span className="ft-band" style={{ color }}>{band}</span> : <span className="ft-band ft-band-na">Unranked</span>}
              <span>{pct != null ? `${fmt(pct, 1)}th %ile` : "percentile unavailable"}</span>
              <span>Nat {m.national?.display || "—"}</span>
              <span>Conf {m.conference?.display || "—"}{m.conference?.name ? ` (${m.conference.name})` : ""}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Sparkline({ points = [], label }) {
  if (!points.length) return null;
  const w = 280;
  const h = 64;
  const pad = 6;
  const vals = points.map((p) => Number(p.value));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 1e-9);
  const accent = "#5bb8e8";
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((Number(p.value) - min) / span) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `${pad},${h - pad} ${coords.join(" ")} ${w - pad},${h - pad}`;
  return (
    <div className="ft-spark">
      <div className="ft-spark-head"><strong>{label}</strong><span>{points.length} games</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="ft-spark-svg" role="img" aria-label={label}>
        <polygon points={area} fill={accent} opacity={0.18} />
        <polyline points={coords.join(" ")} fill="none" stroke={accent} strokeWidth={2.2} />
        {points.map((p, i) => {
          const [x, y] = coords[i].split(",").map(Number);
          return <circle key={p.gameId || i} cx={x} cy={y} r={2.4} fill={accent}>
            <title>{`${p.label}: ${fmt(p.value)}`}</title>
          </circle>;
        })}
      </svg>
    </div>
  );
}

const GAME_SERIES_LABELS = {
  offensiveSuccessRate: "Offensive success rate",
  defensiveSuccessRate: "Defensive success rate allowed",
  offensePpa: "Offense PPA",
  defensePpa: "Defense PPA",
};

function BandLegend() {
  return (
    <div className="ft-band-legend" aria-label="Performance classification legend">
      {Object.entries(BAND_COLORS).map(([name, color]) => (
        <span key={name}><i style={{ background: color }} />{name}</span>
      ))}
    </div>
  );
}

export default function CfbResearchPanels({ researchPanels }) {
  if (!researchPanels) return null;
  const {
    panels = [], gameSeries = {}, propResearch, state, asOf, featureVersion, summary, season, conference, coverage, rankAuthority,
  } = researchPanels;
  const gameEntries = Object.entries(gameSeries);
  const empty = state === "NOT_POPULATED" || (!panels.length && !gameEntries.length && !(propResearch?.count > 0));

  return (
    <section className="ft-panel ft-research" aria-label="Research CORE and advanced panels">
      <div className="ft-heading">
        <h3>Research CORE · advanced · prop inputs</h3>
        <small>Research only · no wager authority</small>
      </div>
      <p className="ft-muted">
        National percentile bars and ranks are FBIS-computed from persisted FBS snapshots ({rankAuthority || "fbis_computed_research"}).
        Source rating values stay source-published where labeled.
        {" · "}State {state}
        {season != null ? ` · season ${season}` : ""}
        {conference ? ` · ${conference}` : ""}
        {featureVersion ? ` · ${featureVersion}` : ""}
        {asOf ? ` · as of ${new Date(asOf).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}` : ""}
        {summary ? ` · ${summary.metricCount || 0} metrics · ${summary.rankedMetricCount || 0} nationally ranked · ${summary.peerSnapshots || coverage?.peerSnapshots || 0} peer snapshots` : ""}
      </p>
      {!empty ? <BandLegend /> : null}
      {empty ? (
        <div className="ft-empty">
          <strong>Research graphs not populated yet.</strong>
          <p>
            After week-aware CORE + advanced refresh writes snapshot fields (CORE, PPA, success rate, trenches),
            this panel renders national percentile bars and ranks automatically. No live CFBD calls happen here.
          </p>
        </div>
      ) : null}
      {panels.length ? (
        <div className="ft-research-grid">
          {panels.map((panel) => (
            <article className="ft-research-card" key={panel.id}>
              <h4>{panel.title}</h4>
              {panel.throughWeek != null ? (
                <p className="ft-note">Through week {panel.throughWeek}{panel.weekBounded ? " · week-bounded" : ""}{panel.temporalClass ? ` · class ${panel.temporalClass}` : ""}</p>
              ) : null}
              <PercentileMetricList series={panel.series} />
              {panel.note ? <p className="ft-note">{panel.note}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
      {gameEntries.length ? (
        <div className="ft-spark-grid">
          <h4>Game-to-game research series</h4>
          <div className="ft-spark-row">
            {gameEntries.map(([id, pts]) => (
              <Sparkline key={id} points={pts} label={GAME_SERIES_LABELS[id] || id} />
            ))}
          </div>
        </div>
      ) : null}
      {propResearch?.count > 0 ? (
        <div className="ft-prop-research">
          <h4>Player prop research inputs · {propResearch.modelHook || "CFB-PLAYER-v1"} shadow</h4>
          <p className="ft-note">{propResearch.note}</p>
          {propResearch.teamContext && Object.keys(propResearch.teamContext).length ? (
            <p className="ft-muted">Team context: {Object.entries(propResearch.teamContext).map(([k, v]) => `${k}=${fmt(v)}`).join(" · ")}</p>
          ) : null}
          <div className="ft-prop-cards">
            {propResearch.cards.map((card) => (
              <article className="ft-prop-card" key={card.playerId}>
                <strong>{card.name}</strong>
                <span>{card.position}{card.jersey != null ? ` · #${card.jersey}` : ""}</span>
                <ul>
                  {Object.entries(card.projectionInputs)
                    .filter(([k, v]) => k !== "position" && v != null)
                    .map(([k, v]) => <li key={k}>{k}: {fmt(v)}</li>)}
                </ul>
                <small>Markets hint: {(card.marketsHint || []).join(", ")} · {card.role}</small>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <p className="ft-note">
          Player prop research cards appear when QB/RB/WR season statistics are persisted.
          Full matchup projections stay on the board via shadow CFB-PLAYER-v1 and never authorize wagers from this page.
        </p>
      )}
    </section>
  );
}
