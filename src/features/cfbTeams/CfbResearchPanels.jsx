/**
 * Research-only CORE/advanced charts + player prop input cards for CFB team pages.
 * Display only — never implies projection or wager authority.
 */

function fmt(v, digits = 3) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function BarChart({ series = [], accent = "#78c7f2" }) {
  if (!series.length) return null;
  const absMax = Math.max(...series.map((s) => Math.abs(Number(s.value) || 0)), 1e-9);
  const w = 320;
  const rowH = 28;
  const h = series.length * rowH + 8;
  const labelW = 118;
  const barMax = w - labelW - 56;
  return (
    <svg className="ft-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Research metric bars">
      {series.map((s, i) => {
        const y = i * rowH + 4;
        const raw = Number(s.value) || 0;
        const bw = Math.max(2, (Math.abs(raw) / absMax) * barMax);
        const x0 = labelW + (raw < 0 ? barMax - bw : 0);
        const fill = s.polarity === "lower_better" ? "#9eb6c8" : accent;
        return (
          <g key={s.id || i}>
            <text x={0} y={y + 16} className="ft-chart-label">{s.label}</text>
            <rect x={x0} y={y + 6} width={bw} height={14} rx={3} fill={fill} opacity={0.92} />
            <text x={labelW + barMax + 8} y={y + 16} className="ft-chart-value">{fmt(raw)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Sparkline({ points = [], label, accent = "#78c7f2" }) {
  if (!points.length) return null;
  const w = 280;
  const h = 64;
  const pad = 6;
  const vals = points.map((p) => Number(p.value));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 1e-9);
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

export default function CfbResearchPanels({ researchPanels, accent }) {
  if (!researchPanels) return null;
  const { panels = [], gameSeries = {}, propResearch, state, asOf, featureVersion, summary } = researchPanels;
  const gameEntries = Object.entries(gameSeries);
  const empty = state === "NOT_POPULATED" || (!panels.length && !gameEntries.length && !(propResearch?.count > 0));

  return (
    <section className="ft-panel ft-research" aria-label="Research CORE and advanced panels">
      <div className="ft-heading">
        <h3>Research CORE · advanced · prop inputs</h3>
        <small>Research only · no wager authority</small>
      </div>
      <p className="ft-muted">
        Graphs read persisted `team_feature_snapshots` and season evidence after CORE/advanced plumbing lands.
        {" · "}State {state}
        {featureVersion ? ` · ${featureVersion}` : ""}
        {asOf ? ` · as of ${new Date(asOf).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}` : ""}
        {summary ? ` · ${summary.panelCount} panels · ${summary.gameSeriesCount} game series · ${summary.propCardCount} prop cards` : ""}
      </p>
      {empty ? (
        <div className="ft-empty">
          <strong>Research graphs not populated yet.</strong>
          <p>
            After week-aware CORE + advanced refresh writes snapshot fields (CORE, PPA, success rate, trenches),
            this panel renders bar charts and game sparklines automatically. No live CFBD calls happen here.
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
              <BarChart series={panel.series} accent={accent || "#78c7f2"} />
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
              <Sparkline key={id} points={pts} label={GAME_SERIES_LABELS[id] || id} accent={accent || "#78c7f2"} />
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
