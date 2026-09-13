import DecisionChip from "./DecisionChip.jsx";
import { fmtLine, fmtNum, fmtPct, fmtPrice, matchupLabel } from "./formatters.js";

export default function TopGameOpportunities({ events = [] }) {
  return (
    <section className="panel today-section" aria-labelledby="today-top-games">
      <div className="panel-header">
        <h2 id="today-top-games">Top game opportunities</h2>
        <span className="last-updated">{events.length ? `${events.length} shown` : "None"}</span>
      </div>
      <div className="panel-body">
        {!events.length ? (
          <p className="today-empty">
            No qualified or watchlist games right now. FBIS will not invent a top five.
          </p>
        ) : (
          <div className="today-opp-list">
            {events.map((event, idx) => {
              const spread = (event.consensusMarkets || []).find((m) => m.marketType === "spread");
              const m = event.movement || {};
              const model = event.model || {};
              return (
                <article key={event.id || idx} className="today-opp-card">
                  <div className="today-opp-rank" aria-label={`Rank ${idx + 1}`}>
                    #{idx + 1}
                  </div>
                  <div className="today-opp-main">
                    <div className="today-opp-matchup">
                      <strong>{matchupLabel(event)}</strong>
                      <span className="muted">
                        {(event.league || event.sport || "").toString().toUpperCase()}
                        {event.startCt ? ` · ${event.startCt}` : ""}
                      </span>
                    </div>
                    <DecisionChip state={event.decision?.state} reasonCodes={event.decision?.reasonCodes} />
                  </div>
                  <div className="today-opp-metrics">
                    <Metric label="FBIS proj" value={model.unavailable ? "—" : fmtNum(model.projMargin)} />
                    <Metric label="Market" value={fmtLine(spread?.line ?? m.currentLine)} />
                    <Metric label="Open" value={fmtLine(m.openingLine)} />
                    <Metric
                      label="Best"
                      value={
                        m.bestLine == null && m.bestPrice == null
                          ? "—"
                          : `${fmtLine(m.bestLine)} ${fmtPrice(m.bestPrice)}${m.bestBook ? ` · ${m.bestBook}` : ""}`
                      }
                    />
                    <Metric label="Tickets" value={fmtPct(m.ticketPct)} />
                    <Metric label="Money" value={fmtPct(m.moneyPct)} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="today-metric">
      <span className="today-metric-label">{label}</span>
      <span className="today-metric-value">{value}</span>
    </div>
  );
}
