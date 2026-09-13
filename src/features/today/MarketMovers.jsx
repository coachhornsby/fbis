import { fmtLine, fmtPct, matchupLabel } from "./formatters.js";

export default function MarketMovers({ events = [] }) {
  return (
    <section className="panel today-section" aria-labelledby="today-movers">
      <div className="panel-header">
        <h2 id="today-movers">Market movers</h2>
        <span className="last-updated">{events.length ? `${events.length} shown` : "None"}</span>
      </div>
      <div className="panel-body">
        {!events.length ? (
          <p className="today-empty">No measured line movement on this slate yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="fbis-table today-compact-table">
              <thead>
                <tr>
                  <th>Matchup</th>
                  <th>Open</th>
                  <th>Current</th>
                  <th>Move</th>
                  <th>Tickets</th>
                  <th>Money</th>
                  <th>Gap</th>
                  <th>Best book</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const m = event.movement || {};
                  return (
                    <tr key={event.id}>
                      <td>
                        <strong>{matchupLabel(event)}</strong>
                        <div className="muted">
                          {(event.league || event.sport || "").toString().toUpperCase()}
                        </div>
                      </td>
                      <td>{fmtLine(m.openingLine)}</td>
                      <td>{fmtLine(m.currentLine)}</td>
                      <td>
                        <span className="today-move-mag">{fmtLine(m.movementMagnitude)}</span>
                        {m.movementDirection ? (
                          <span className="muted"> · {m.movementDirection}</span>
                        ) : null}
                      </td>
                      <td>{fmtPct(m.ticketPct)}</td>
                      <td>{fmtPct(m.moneyPct)}</td>
                      <td>{m.moneyTicketGap == null ? "—" : fmtPct(m.moneyTicketGap)}</td>
                      <td className="muted">{m.bestBook || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
