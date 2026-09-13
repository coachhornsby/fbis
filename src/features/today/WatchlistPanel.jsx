import DecisionChip from "./DecisionChip.jsx";
import { fmtLine, matchupLabel } from "./formatters.js";

export default function WatchlistPanel({ events = [] }) {
  return (
    <section className="panel today-section" aria-labelledby="today-watchlist">
      <div className="panel-header">
        <h2 id="today-watchlist">Watchlist / near qualification</h2>
        <span className="last-updated">{events.length ? `${events.length} shown` : "None"}</span>
      </div>
      <div className="panel-body">
        {!events.length ? (
          <p className="today-empty">
            Nothing on the watchlist. Near-qualified leans will appear here.
          </p>
        ) : (
          <ul className="today-watch-list">
            {events.map((event) => {
              const m = event.movement || {};
              const reasons = event.decision?.reasonCodes || [];
              return (
                <li key={event.id} className="today-watch-item">
                  <div className="today-watch-head">
                    <strong>{matchupLabel(event)}</strong>
                    <DecisionChip state="WATCHLIST" reasonCodes={reasons} />
                  </div>
                  <p className="today-watch-why">
                    {reasons.length
                      ? `Why watching: ${reasons.map((r) => String(r).replace(/_/g, " ")).join(" · ")}`
                      : "Why watching: lean present, not yet qualified."}
                  </p>
                  <div className="muted">
                    Market {fmtLine(m.currentLine)} · Open {fmtLine(m.openingLine)}
                    {event.startCt ? ` · ${event.startCt} CT` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
