import TeamLogo from "../../components/TeamLogo.jsx";
import { fmtLine, fmtPrice } from "../today/formatters.js";
import { formatMarketLabel } from "./buildPlayerPropsBoard.js";

export default function PlayerWorkspace({ player, onClose }) {
  if (!player) return null;
  const markets = player.markets || [];
  const initial = (player.playerName || "?").slice(0, 1).toUpperCase();

  return (
    <section className="props-workspace" aria-label="Player detail">
      <div className="props-workspace-header">
        <div className="props-player-identity">
          <div className="props-avatar props-avatar-lg" aria-hidden="true">
            {player.imageUrl ? <img src={player.imageUrl} alt="" /> : initial}
          </div>
          <TeamLogo
            team={player.teamIdentity || { abbr: player.team, name: player.team }}
            size={28}
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
        Research view only. Lines and prices are shown for comparison — nothing is submitted.
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
              <article key={`${m.marketCanonical || m.market}-${m.line}-${i}`} className="props-card props-card-compact">
                <p className="props-card-market">{label}</p>
                <p className="props-card-line">{fmtLine(m.line)}</p>
                <div className="props-more-less">
                  <div className="props-side">
                    <span className="props-side-label">More</span>
                    <span className="props-side-price">{fmtPrice(over)}</span>
                  </div>
                  <div className="props-side">
                    <span className="props-side-label">Less</span>
                    <span className="props-side-price">{fmtPrice(under)}</span>
                  </div>
                </div>
                <div className="props-card-footer muted">
                  <span>{m.book || "Best available"}</span>
                  {m.isAlternate ? <span>Alternate</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
