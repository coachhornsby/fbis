import TeamLogo from "../../components/TeamLogo.jsx";
import { fmtNum, fmtPrice } from "../today/formatters.js";
import { formatMarketLabel } from "./buildPlayerPropsBoard.js";

function fmtPropLine(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return String(Number(v));
}

function fmtProb(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.round(pct)}%`;
}

function fmtDelta(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const body = Math.abs(n).toFixed(1);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return "0.0";
}

export default function PlayerWorkspace({ player, onClose }) {
  if (!player) return null;
  const markets = player.markets || [];

  return (
    <section className="props-workspace" aria-label="Player detail">
      <div className="props-workspace-header">
        <div className="props-player-identity">
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
          </div>
        </div>
        {onClose ? (
          <button type="button" className="header-btn" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <p className="props-workspace-note">
        FBIS projection and probabilities are research signals only. No wager is submitted.
      </p>

      {!markets.length ? (
        <p className="props-empty-inline">No markets for this player on today&apos;s slate.</p>
      ) : (
        <div className="props-workspace-grid">
          {markets.map((m, i) => {
            const label = formatMarketLabel(m.marketCanonical || m.market);
            const over = m.overOdds ?? (m.side === "over" ? m.price : null);
            const under = m.underOdds ?? (m.side === "under" ? m.price : null);
            return (
              <article
                key={`${m.marketCanonical || m.market}-${m.line}-${i}`}
                className="props-card props-card-compact"
              >
                <div className="props-card-line-row">
                  <span className="props-card-line">{fmtPropLine(m.line)}</span>
                  <span className="props-card-market">{label}</span>
                </div>
                <div className="props-fbis-panel">
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">FBIS proj</span>
                    <span className="props-fbis-value">
                      {m.fbisProjection == null ? "—" : fmtNum(m.fbisProjection, 1)}
                    </span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">vs line</span>
                    <span className="props-fbis-value">{fmtDelta(m.projectionDelta)}</span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">P(More)</span>
                    <span className="props-fbis-value">{fmtProb(m.probabilityOver)}</span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">P(Less)</span>
                    <span className="props-fbis-value">{fmtProb(m.probabilityUnder)}</span>
                  </div>
                </div>
                <div className="props-more-less">
                  <div className="props-side">
                    <span className="props-side-label">↑ More</span>
                    <span className="props-side-price">{fmtPrice(over)}</span>
                  </div>
                  <div className="props-side">
                    <span className="props-side-label">↓ Less</span>
                    <span className="props-side-price">{fmtPrice(under)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
