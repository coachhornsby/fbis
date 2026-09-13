import TeamLogo from "../../components/TeamLogo.jsx";
import DecisionChip from "../today/DecisionChip.jsx";
import { fmtLine, fmtPrice } from "../today/formatters.js";

export default function PlayerWorkspace({ player, onClose }) {
  if (!player) return null;
  const markets = player.markets || [];
  const initial = (player.playerName || "?").slice(0, 1).toUpperCase();

  return (
    <section className="panel props-workspace" aria-label="Player workspace">
      <div className="panel-header props-workspace-header">
        <div className="props-player-identity">
          <div className="props-avatar props-avatar-lg" aria-hidden="true">
            {player.imageUrl ? <img src={player.imageUrl} alt="" /> : initial}
          </div>
          <TeamLogo
            team={player.teamIdentity || { abbr: player.team, name: player.team }}
            size={32}
          />
          <div>
            <h2>{player.playerName || "Unknown player"}</h2>
            <p className="muted">
              {[player.team, player.position, player.sport?.toUpperCase()]
                .filter(Boolean)
                .join(" · ") || "—"}
              {player.matchup?.away || player.matchup?.home
                ? ` · ${player.matchup.away || "—"} @ ${player.matchup.home || "—"}`
                : ""}
            </p>
            <p className="muted">
              Identity: {player.playerIdentityConfidence || "UNKNOWN"}
              {player.fbisPlayerId ? ` · FBIS ${player.fbisPlayerId}` : ""}
              {player.providerPlayerId
                ? ` · Provider ${player.providerPlayerId}`
                : " · No provider id"}
            </p>
          </div>
        </div>
        <div className="props-workspace-actions">
          <DecisionChip state="RESEARCH" reasonCodes={["MODEL_NOT_AUTHORIZED"]} />
          {onClose ? (
            <button type="button" className="header-btn" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
      <div className="panel-body">
        <p className="props-banner">
          MODEL NOT AUTHORIZED — research surface only. No wager recommendation.
        </p>
        {!markets.length ? (
          <p className="today-empty">
            No normalized markets for this player on the current slate.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="fbis-table props-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Line</th>
                  <th>Over</th>
                  <th>Under</th>
                  <th>Book</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m, i) => (
                  <tr key={`${m.marketCanonical || m.market}-${m.line}-${i}`}>
                    <td>
                      <strong>{m.marketCanonical || m.market || "—"}</strong>
                      {m.isAlternate ? <div className="muted">Alternate</div> : null}
                      {!m.supportedMarket ? (
                        <div className="muted">Unsupported novelty</div>
                      ) : null}
                    </td>
                    <td>{fmtLine(m.line)}</td>
                    <td>
                      {fmtPrice(m.overOdds ?? (m.side === "over" ? m.price : null))}
                    </td>
                    <td>
                      {fmtPrice(m.underOdds ?? (m.side === "under" ? m.price : null))}
                    </td>
                    <td className="muted">{m.book || "—"}</td>
                    <td>
                      <DecisionChip
                        state={m.surfaceStatus || "RESEARCH"}
                        reasonCodes={m.reasonCodes}
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
