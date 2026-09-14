import { useMemo } from "react";
import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { fmtNum } from "../../lib/format.js";
import { venueAtmosphereClass } from "../../lib/venueAtmosphere.js";
import "./premiumGameCard.css";

/**
 * Premium FBIS game card — mockup hierarchy:
 * header → matchup+projected scores → FBIS vs MARKET bars →
 * MODEL vs MARKET | ACTION INTEL | GAME INFO
 *
 * Presentation only. Does not alter authority / qualification.
 */
export default function PremiumGameCard({
  game,
  open = false,
  onToggle,
  renderDetail,
}) {
  const card = useMemo(() => buildGameCardViewModel(game), [game]);
  const key = `${game.sport}:${game.id}`;
  const venueClass = venueAtmosphereClass(card.sport || game.sport);

  return (
    <article
      className={`pgc decision-tier-${card.decision?.tier || "NONE"} status-${card.status?.tone || "neutral"}${venueClass ? ` ${venueClass}` : ""}`}
      data-game-id={game.id}
      data-sport={card.sport || undefined}
      data-status={card.status?.key || undefined}
    >
      <CardHeader card={card} />
      <MatchupBlock card={card} />
      <ProjectionMarketBars card={card} />
      <div className="pgc-panels">
        <ModelMarketPanel card={card} />
        <ActionIntelPanel card={card} />
        <GameInfoPanel card={card} />
      </div>
      <footer className="pgc-footer">
        <div className="pgc-footer-meta">
          {card.marketCopy?.source ? (
            <span className="pgc-source" title="Market data source (not a sharp signal)">
              🗄️ Market: {card.marketCopy.source}
            </span>
          ) : null}
          {card.freshness?.label ? (
            <span className={`pgc-fresh${card.freshness.stale ? " is-stale" : ""}`}>
              🕒 {card.freshness.label}
            </span>
          ) : null}
        </div>
        <button type="button" className="pgc-details-btn" onClick={() => onToggle?.(key)}>
          {open ? "HIDE DETAILS" : "VIEW DETAILS →"}
        </button>
      </footer>
      {open ? <div className="pgc-detail">{renderDetail?.(game)}</div> : null}
    </article>
  );
}

function CardHeader({ card }) {
  return (
    <header className="pgc-header">
      <div className="pgc-when">
        {card.event?.live ? <span className="pgc-live-dot" aria-hidden="true" /> : null}
        <span className="pgc-time">{card.timing?.timeLine || "—"}</span>
        <span className="pgc-sport">{String(card.sport || "").toUpperCase()}</span>
      </div>
      <div className="pgc-venue" title={card.context?.venue || card.event?.venue || ""}>
        {card.context?.venue || card.event?.venue || ""}
      </div>
      <StatusBadge status={card.status} />
    </header>
  );
}

function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span className={`pgc-status pgc-status-${status.tone || "neutral"}`} title={status.label}>
      <span aria-hidden="true">{status.icon}</span> {status.label}
    </span>
  );
}

function MatchupBlock({ card }) {
  const p = card.projection;
  const available = Boolean(p?.available);
  return (
    <div className={`pgc-matchup${available ? "" : " no-model"}`}>
      <TeamCol team={card.away} score={available ? p.away : null} align="away" />
      <div className="pgc-mid">
        <span className="pgc-vs">VS</span>
        <WeatherChip weather={card.context?.weather} />
        {!available ? <span className="pgc-no-fbis">No FBIS</span> : null}
        {available && p.research ? (
          <span className="pgc-research-tag" title="Research projection">
            🧪 RESEARCH
          </span>
        ) : null}
      </div>
      <TeamCol team={card.home} score={available ? p.home : null} align="home" />
      {available ? (
        <div className="pgc-proj-caption" aria-hidden="true">
          <span>{card.units?.projectedLabel || "FBIS PROJECTED"}</span>
          <span>{card.units?.projectedLabel || "FBIS PROJECTED"}</span>
        </div>
      ) : null}
    </div>
  );
}

function TeamCol({ team, score, align }) {
  return (
    <div className={`pgc-team pgc-team-${align}`}>
      <TeamLogo team={team} size="hero" tone="dark" />
      <div className="pgc-team-meta">
        <span className="pgc-team-name">{team?.displayName || team?.name || team?.abbr || "—"}</span>
        {team?.record ? <span className="pgc-record">{team.record}</span> : null}
        <strong className="pgc-score">{score == null ? "—" : fmtNum(score, 1)}</strong>
      </div>
    </div>
  );
}

function WeatherChip({ weather }) {
  if (!weather) return null;
  const bits = [];
  if (weather.temp != null) bits.push(`${Math.round(weather.temp)}°`);
  if (weather.wind != null) {
    bits.push(`Wind ${Math.round(weather.wind)} mph${weather.windDir ? ` ${weather.windDir}` : ""}`);
  } else if (weather.description) {
    bits.push(weather.description);
  }
  if (!bits.length && weather.indoor) bits.push("Indoor");
  if (!bits.length) return null;
  return (
    <div className="pgc-weather" title={weather.description || ""}>
      🌤️ {bits.join(" · ")}
    </div>
  );
}

function ProjectionMarketBars({ card }) {
  const fbis = card.projection?.available ? card.projection.total : null;
  const mkt = card.market?.available ? card.market.total : null;
  if (fbis == null && mkt == null) return null;
  const max = Math.max(fbis ?? 0, mkt ?? 0, 1);
  return (
    <div
      className="pgc-bars"
      role="img"
      aria-label={`FBIS total ${fbis ?? "—"}, market total ${mkt ?? "—"}`}
    >
      <div className="pgc-bar-row">
        <span className="pgc-bar-lab fbis">🧠 FBIS</span>
        <div className="pgc-bar-track">
          {fbis != null ? (
            <div className="pgc-bar-fill fbis" style={{ width: `${(fbis / max) * 100}%` }} />
          ) : null}
        </div>
        <strong className="pgc-bar-val fbis">{fbis == null ? "—" : fmtNum(fbis, 1)}</strong>
      </div>
      <div className="pgc-bar-row">
        <span className="pgc-bar-lab mkt">🏦 MARKET</span>
        <div className="pgc-bar-track">
          {mkt != null ? (
            <div className="pgc-bar-fill mkt" style={{ width: `${(mkt / max) * 100}%` }} />
          ) : (
            <div className="pgc-bar-fill empty" />
          )}
        </div>
        <strong className="pgc-bar-val mkt">{mkt == null ? "—" : fmtNum(mkt, 1)}</strong>
      </div>
    </div>
  );
}

function ModelMarketPanel({ card }) {
  const c = card.comparison || {};
  return (
    <section className="pgc-panel pgc-panel-model" aria-label="Model versus market">
      <h3 className="pgc-panel-title">📊 MODEL vs MARKET</h3>
      <div className="pgc-metric">
        <span className="pgc-metric-lab">⚔️ SIDE DIFF</span>
        <strong className="pgc-metric-val">{c.sideDiffLabel || "—"}</strong>
        {c.sideRelationshipLabel ? (
          <span className={`pgc-chip ${c.sideRelationship === "OPPOSITE_SIDES" ? "warn" : "ok"}`}>
            {c.sideRelationship === "OPPOSITE_SIDES" ? "🔀" : "➡️"} {c.sideRelationshipLabel}
          </span>
        ) : null}
      </div>
      <div className="pgc-side-rows">
        <SideRow icon="🧠" label="FBIS" side={c.fbisSide} />
        <SideRow icon="🏦" label="MARKET" side={c.marketSide} />
      </div>
      <div className="pgc-metric">
        <span className="pgc-metric-lab">📈 TOTAL DIFF</span>
        <strong className="pgc-metric-val">{c.totalDiffLabel || "—"}</strong>
        {c.totalDirectionLabel ? (
          <span className="pgc-chip">
            {c.totalDirection === "FBIS_HIGHER"
              ? "⬆️"
              : c.totalDirection === "FBIS_LOWER"
                ? "⬇️"
                : "↔️"}{" "}
            {c.totalDirectionLabel}
          </span>
        ) : null}
      </div>
      <div className="pgc-total-pair">
        <span>🧠 {c.fbisTotal == null ? "—" : fmtNum(c.fbisTotal, 1)}</span>
        <span>🏦 {c.marketTotal == null ? "—" : fmtNum(c.marketTotal, 1)}</span>
      </div>
    </section>
  );
}

function SideRow({ icon, label, side }) {
  if (!side) {
    return (
      <div className="pgc-side-row muted">
        <span>
          {icon} {label}
        </span>
        <span>—</span>
      </div>
    );
  }
  return (
    <div className="pgc-side-row">
      <span className="pgc-side-lab">
        {icon} {label}
      </span>
      <span className="pgc-side-team">
        {side.team ? <TeamLogo team={side.team} size="micro" tone="dark" /> : null}
        <strong>{side.label}</strong>
      </span>
    </div>
  );
}

function ActionIntelPanel({ card }) {
  const a = card.action || {};
  if (!a.available) {
    return (
      <section className="pgc-panel pgc-panel-action is-empty" aria-label="Action intel">
        <h3 className="pgc-panel-title">🔥 ACTION INTEL</h3>
        <p className="pgc-empty">— {a.emptyLabel || "NO CURRENT DATA"}</p>
      </section>
    );
  }

  return (
    <section className="pgc-panel pgc-panel-action" aria-label="Action intel">
      <h3 className="pgc-panel-title">
        🔥 ACTION INTEL
        <span className="pgc-powered">Powered by ACTION</span>
      </h3>
      {a.headline ? (
        <div className={`pgc-action-headline kind-${a.headline.kind}`}>
          <span aria-hidden="true">{a.headline.icon}</span>
          <div>
            <strong>{a.headline.label}</strong>
            {a.headline.detail ? <span>{a.headline.detail}</span> : null}
          </div>
        </div>
      ) : null}
      <SplitBars label="🎟️ TICKETS" split={a.tickets} />
      <SplitBars label="💰 MONEY" split={a.money} />
      {a.divergence?.label ? (
        <div className="pgc-chip warn">
          {a.divergence.label}
          {a.divergence.team ? (
            <>
              {" "}
              <TeamLogo team={a.divergence.team} size="micro" tone="dark" /> {a.divergence.team.abbr}
            </>
          ) : null}
        </div>
      ) : null}
      {a.movement?.label ? (
        <div className="pgc-move">
          <span>📈 LINE MOVE</span>
          <strong>
            {a.movement.team ? <TeamLogo team={a.movement.team.team} size="micro" tone="dark" /> : null}
            {a.movement.label}
          </strong>
        </div>
      ) : null}
      <div className="pgc-action-meta">
        {a.sample ? (
          <span title="Tracked sample from ACTION">
            👥 {a.sample.low ? "LOW SAMPLE" : "SAMPLE"} {a.sample.label}
          </span>
        ) : null}
        {a.bookRange ? <span>📚 {a.bookRange.label}</span> : null}
      </div>
    </section>
  );
}

function SplitBars({ label, split }) {
  if (!split) return null;
  const aria = `${split.away?.abbr || "Away"} ${split.awayPct} percent, ${split.home?.abbr || "Home"} ${split.homePct} percent`;
  return (
    <div className="pgc-split" role="img" aria-label={`${label}: ${aria}`}>
      <div className="pgc-split-lab">{label}</div>
      <div className="pgc-split-row">
        <TeamLogo team={split.away} size="micro" tone="dark" />
        <div className="pgc-split-track">
          <div className="pgc-split-fill away" style={{ width: `${split.awayPct}%` }} />
        </div>
        <strong>{split.awayPct}%</strong>
      </div>
      <div className="pgc-split-row">
        <TeamLogo team={split.home} size="micro" tone="dark" />
        <div className="pgc-split-track">
          <div className="pgc-split-fill home" style={{ width: `${split.homePct}%` }} />
        </div>
        <strong>{split.homePct}%</strong>
      </div>
    </div>
  );
}

function GameInfoPanel({ card }) {
  const ctx = card.context || {};
  const starters = ctx.starters;
  return (
    <section className="pgc-panel pgc-panel-info" aria-label="Game info">
      <h3 className="pgc-panel-title">📋 GAME INFO</h3>
      {starters?.away || starters?.home ? (
        <div className="pgc-starters">
          <div className="pgc-info-lab">⚾ STARTING PITCHERS</div>
          <PitcherRow pitcher={starters.away} />
          <PitcherRow pitcher={starters.home} />
        </div>
      ) : null}
      {ctx.venue ? (
        <div className="pgc-info-row">
          <span>🏟️ VENUE</span>
          <strong>{ctx.venue}</strong>
        </div>
      ) : null}
      {ctx.weather ? (
        <div className="pgc-info-row">
          <span>🌤️ WEATHER</span>
          <strong>
            {[
              ctx.weather.temp != null ? `${Math.round(ctx.weather.temp)}°` : null,
              ctx.weather.description,
              ctx.weather.wind != null
                ? `${Math.round(ctx.weather.wind)} mph${ctx.weather.windDir ? ` ${ctx.weather.windDir}` : ""}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </strong>
        </div>
      ) : null}
      {!starters?.away && !starters?.home && !ctx.venue && !ctx.weather ? (
        <p className="pgc-empty">— No extra context</p>
      ) : null}
    </section>
  );
}

function PitcherRow({ pitcher }) {
  if (!pitcher) return null;
  return (
    <div className="pgc-pitcher">
      <TeamLogo team={pitcher.team} size="micro" tone="dark" />
      <div>
        <strong>{pitcher.name}</strong>
        <span>
          {[pitcher.hand, pitcher.era != null ? `${fmtNum(pitcher.era, 2)} ERA` : null, pitcher.record]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}
