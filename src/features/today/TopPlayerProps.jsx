import DecisionChip from "./DecisionChip.jsx";
import { fmtLine, fmtPrice } from "./formatters.js";

export default function TopPlayerProps({ rows = [] }) {
  return (
    <section className="panel today-section" aria-labelledby="today-top-props">
      <div className="panel-header">
        <h2 id="today-top-props">Top player props</h2>
        <span className="last-updated">{rows.length ? `${rows.length} shown` : "None"}</span>
      </div>
      <div className="panel-body">
        {!rows.length ? (
          <p className="today-empty">
            No normalized player props available for this slate. Action props remain shadow / research-only.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="fbis-table today-compact-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Market</th>
                  <th>Line</th>
                  <th>Best</th>
                  <th>Matchup</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.eventId}-${row.providerPlayerId || row.playerName}-${i}`}>
                    <td>
                      <div className="today-player-cell">
                        <div className="today-player-avatar" aria-hidden="true">
                          {(row.playerName || "?").slice(0, 1)}
                        </div>
                        <div>
                          <strong>{row.playerName || "—"}</strong>
                          <div className="muted">
                            {[row.team, row.position].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{row.marketCanonical || row.market || "—"}</td>
                    <td>{fmtLine(row.line)}</td>
                    <td>
                      {fmtPrice(row.overOdds ?? row.price)}
                      {row.book ? <span className="muted"> · {row.book}</span> : null}
                    </td>
                    <td className="muted">
                      {row.matchup?.away || "—"} @ {row.matchup?.home || "—"}
                    </td>
                    <td>
                      <DecisionChip
                        state={row.surfaceStatus || "RESEARCH"}
                        reasonCodes={row.reasonCodes}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
