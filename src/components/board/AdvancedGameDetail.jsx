import { useMemo, useState } from "react";
import TeamLogo from "../TeamLogo.jsx";
import { buildAdvancedGameViewModel } from "../../lib/advancedGameViewModel.js";
import { venueAtmosphereClass, venueAtmosphereStyle } from "../../lib/venueAtmosphere.js";
import "./advancedGameDetail.css";

/**
 * Advanced Details View — mockup Overview + tabs.
 * Presentation only. Unpublished metrics use honest empty states.
 */
export default function AdvancedGameDetail({ game, onClose }) {
  const vm = useMemo(() => buildAdvancedGameViewModel(game), [game]);
  const [tab, setTab] = useState("overview");
  const [splitsMode, setSplitsMode] = useState("tickets");

  if (!vm) return null;
  const venueClass = venueAtmosphereClass(vm.sport);
  const venueStyle = venueAtmosphereStyle(game);
  const tabs = supportedTabs(vm, game);

  return (
    <section className={`agd${venueClass ? ` ${venueClass}` : ""}`} style={venueStyle} aria-label="Advanced game details">
      <header className="agd-hero">
        <div className="agd-hero-ribbon">{String(vm.sport || "").toUpperCase()} · GAME WORKSTATION</div>
        <div className="agd-hero-status">
          {vm.status?.label ? (
            <span className={`agd-status agd-status-${String(vm.status.tone || "").toLowerCase()}`}>
              {vm.status.key === "QUALIFIED" ? "✓ " : ""}
              {vm.status.label}
            </span>
          ) : null}
          {typeof onClose === "function" ? (
            <button type="button" className="agd-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          ) : null}
        </div>
        <HeroTeam team={vm.away} score={vm.projectedScores?.away} projectionLabel={vm.projectedScores?.label} side="away" />
        <div className="agd-hero-center">
          <div className="agd-hero-time">{[vm.card?.timing?.dateLine, vm.timeLine].filter((v) => v && v !== "—").join(" · ") || "—"}</div>
          {vm.venueLine ? <div className="agd-hero-venue">{vm.venueLine}</div> : null}
          {vm.weatherLine ? <div className="agd-hero-weather">{weatherEmoji(vm.weatherLine)} {vm.weatherLine}</div> : null}
          <div className="agd-hero-matchup">{vm.matchupLabel}</div>
        </div>
        <HeroTeam team={vm.home} score={vm.projectedScores?.home} projectionLabel={vm.projectedScores?.label} side="home" />
      </header>

      <nav className="agd-tabs" aria-label="Detail sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`agd-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="agd-body">
        {tab === "overview" ? (
          <div className="agd-overview">
            <StarterCard side="away" vm={vm} />

            <div className="agd-model-command">
              <ProbBar title="WIN PROBABILITY (FBIS MODEL)" data={vm.probabilities.win} away={vm.away} home={vm.home} />
              <ProjectedScores vm={vm} />
              <div className="agd-command-metrics">
                <TeamMetric label="FBIS SIDE" side={vm.comparison?.fbisSide} tone="fbis" />
                <TeamMetric label="MARKET SIDE" side={vm.comparison?.marketSide} tone="market" />
                <Kv label="MODEL TOTAL" value={vm.projectedScores?.total ?? "—"} />
                <ConfidenceCard confidence={vm.probabilities.confidence} />
              </div>
            </div>

            <StarterCard side="home" vm={vm} />

            <aside className="agd-takeaways agd-overview-takeaways">
              <h3 className="agd-section-title">⚔ KEY MATCHUP ADVANTAGES</h3>
              <ul>
                {(vm.takeaways || []).map((t, i) => (
                  <li key={`${t.tone}-${i}`} className={`agd-takeaway agd-takeaway-${t.tone}`}>
                    <span className="agd-takeaway-icon">{t.icon}</span>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="agd-market-command">
              <h3 className="agd-section-title">📊 MODEL vs MARKET</h3>
              <div className="agd-market-grid">
                <TeamMetric label="FBIS SIDE" side={vm.comparison?.fbisSide} tone="fbis" />
                <TeamMetric label="MARKET SIDE" side={vm.comparison?.marketSide} tone="market" />
                <Kv label="SIDE DIFF" value={vm.comparison?.sideDiffLabel || "—"} />
                <Kv label="TOTAL DIFF" value={vm.comparison?.totalDiffLabel || "—"} />
                <Kv label="FBIS TOTAL" value={vm.projectedScores?.total ?? "—"} />
                <Kv label="MARKET TOTAL" value={vm.comparison?.marketTotal ?? "—"} />
              </div>
            </div>

            <aside className="agd-right agd-overview-market">
              <BettingSplitsCard
                splits={vm.bettingSplits}
                away={vm.away}
                home={vm.home}
                mode={splitsMode}
                setMode={setSplitsMode}
                compact
              />
              <LineHistoryCard history={vm.lineHistory} compact />
            </aside>

            <div className="agd-context-strip">
              <h3 className="agd-section-title">📋 ADDITIONAL FACTORS</h3>
              <div className="agd-context-grid">
                <Kv label={`${weatherEmoji(vm.weatherLine)} WEATHER`} value={vm.weatherLine || "Unavailable"} />
                <Kv label="🏟 VENUE" value={vm.venueLine || "Unavailable"} />
                <Kv label="🩹 PERSONNEL" value={vm.injuries?.available ? `${vm.injuries.rows.length} listed` : "Unavailable"} />
                <Kv label="🧠 AUTHORITY" value={vm.authority?.research ? "RESEARCH" : vm.status?.label || "—"} />
              </div>
            </div>

            <div className="agd-action-strip">
              <h3 className="agd-section-title">🔥 ACTION INTEL</h3>
              <ActionSnapshot vm={vm} />
            </div>
          </div>
        ) : null}

        {tab === "model" ? (
          <div className="agd-tab-panel">
            <ProjectedScores vm={vm} />
            <div className="agd-kv-grid">
              <Kv label="FBIS side" value={vm.comparison?.fbisSide?.label || "—"} />
              <Kv label="Market side" value={vm.comparison?.marketSide?.label || "—"} />
              <Kv label="Side diff" value={vm.comparison?.sideDiffLabel || "—"} />
              <Kv label="Total diff" value={vm.comparison?.totalDiffLabel || "—"} />
              <Kv label="FBIS total" value={vm.projectedScores?.total ?? "—"} />
              <Kv label="Market total" value={vm.comparison?.marketTotal ?? "—"} />
            </div>
            <div className="agd-prob-grid">
              <ProbBar title="WIN PROBABILITY (MODEL)" data={vm.probabilities.win} away={vm.away} home={vm.home} />
              <ConfidenceCard confidence={vm.probabilities.confidence} />
              <EvCard ev={vm.probabilities.ev} home={vm.home} />
              <TotalCard total={vm.probabilities.total} />
            </div>
          </div>
        ) : null}

        {tab === "action" ? <ActionPanel vm={vm} /> : null}

        {tab === "market" ? (
          <div className="agd-tab-panel">
            <div className="agd-kv-grid">
              <Kv label="Market" value={vm.marketCopy?.primary || vm.market?.label || "—"} />
              <Kv label="Book" value={vm.market?.book || "—"} />
              <Kv
                label="Spread"
                value={
                  vm.market?.spreadLabel ||
                  (vm.market?.spread != null ? String(vm.market.spread) : "—")
                }
              />
              <Kv label="Total" value={vm.market?.total != null ? String(vm.market.total) : "—"} />
            </div>
          </div>
        ) : null}

        {tab === "matchup" ? <MatchupPanel vm={vm} /> : null}

        {tab === "weather" ? (
          <div className="agd-tab-panel">
            <div className="agd-kv-grid">
              <Kv label="Venue" value={vm.venueLine || "—"} />
              <Kv label="Weather" value={vm.weatherLine || "—"} />
              <Kv label="Wind" value={vm.windLabel || "—"} />
            </div>
            {!vm.weatherLine && !vm.windLabel ? (
              <p className="agd-empty">Weather not available for this game</p>
            ) : null}
          </div>
        ) : null}

        {tab === "injuries" ? (
          vm.injuries?.available ? (
            <div className="agd-tab-panel">
              <div className="agd-injuries">
                {vm.injuries.rows.map((r, i) => (
                  <div key={`${r.player}-${i}`} className="agd-injury">
                    <strong>{r.player}</strong>
                    <span>{r.team || ""}</span>
                    <span>{r.status}</span>
                    <span>{r.detail || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyPanel title="Injuries" reason={vm.injuries?.emptyReason || "Unavailable"} />
          )
        ) : null}

        {tab === "lineHistory" ? <LineHistoryCard history={vm.lineHistory} /> : null}

        {tab === "projections" ? (
          <div className="agd-tab-panel">
            <ProjectedScores vm={vm} />
            <TotalCard total={vm.probabilities.total} />
          </div>
        ) : null}

        {tab === "trends" ? (
          <EmptyPanel title="Trends" reason="Trend series not published for this game" />
        ) : null}

        {tab === "bettingSplits" ? (
          <BettingSplitsCard
            splits={vm.bettingSplits}
            away={vm.away}
            home={vm.home}
            mode={splitsMode}
            setMode={setSplitsMode}
          />
        ) : null}
      </div>

      <footer className="agd-footer">
        <div className="agd-footer-meta">
          <span>{vm.footer?.asOfLabel}</span>
          <span>Sources: {vm.footer?.sources}</span>
        </div>
        <div className="agd-footer-actions">
          <button type="button" className="agd-btn agd-btn-ghost" disabled title="Coming soon">
            ★ Add to Watchlist
          </button>
          {typeof onClose === "function" ? (
            <button type="button" className="agd-btn" onClick={onClose}>
              ✕ Close
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function HeroTeam({ team, score, projectionLabel, side }) {
  return (
    <div className={`agd-hero-team agd-hero-team-${side}`}>
      <TeamLogo team={team} size={126} className="agd-hero-logo" />
      <div className="agd-hero-team-copy">
        <div className="agd-hero-city">{team?.fullName || team?.displayName || team?.name || team?.abbr || "—"}</div>
        {team?.record ? <div className="agd-hero-record">({team.record})</div> : null}
        <div className="agd-hero-proj-label">{projectionLabel || "FBIS PROJECTED SCORE"}</div>
        <div className="agd-hero-score">{score ?? "—"}</div>
      </div>
    </div>
  );
}

function supportedTabs(vm, game) {
  return (vm.tabs || []).filter((t) => {
    if (t.id === "action") return Boolean(vm.action?.available);
    if (t.id === "market") return Boolean(vm.market?.available || vm.market?.marketAvailable || vm.comparison?.marketTotal != null);
    if (t.id === "weather") return Boolean(vm.weatherLine || vm.windLabel || vm.venueLine);
    if (t.id === "injuries") return Boolean(vm.injuries?.available);
    if (t.id === "lineHistory") return Boolean(vm.lineHistory?.available);
    if (t.id === "projections") return Boolean(vm.projectedScores?.available);
    if (t.id === "trends") return Boolean(game?.trends || game?.trendSeries);
    if (t.id === "bettingSplits") return Boolean(vm.bettingSplits?.available);
    return true;
  });
}

function StarterCard({ side, vm }) {
  const team = side === "away" ? vm.away : vm.home;
  const starter = vm.context?.starters?.[side];
  return (
    <div className={`agd-starter-card agd-starter-card-${side}`}>
      <h3 className="agd-section-title">{team?.abbr || side.toUpperCase()} · {vm.context?.startersLabel || "GAME PERSONNEL"}</h3>
      <div className="agd-starter-lead">
        {starter?.photo ? (
          <span className="agd-player-photo-wrap"><img className="agd-player-photo" src={starter.photo} alt={`${starter.name} headshot`} /></span>
        ) : (
          <TeamLogo team={team} size={62} />
        )}
        <div>
          <strong>{starter?.name || "Not available"}</strong>
          <span>{starter
            ? [starter.hand ? `${starter.hand}HP` : null, starter.era != null ? `${Number(starter.era).toFixed(2)} ERA` : null].filter(Boolean).join(" · ")
            : vm.context?.startersLabel
              ? "Upstream starter data unavailable"
              : "Personnel data unavailable"}</span>
        </div>
      </div>
      {starter ? (
        <div className="agd-starter-metrics">
          <Kv label="ERA" value={starter.era != null ? Number(starter.era).toFixed(2) : "—"} />
          <Kv label="HAND" value={starter.hand ? `${starter.hand}HP` : "—"} />
          {starter.record ? <Kv label="RECORD" value={starter.record} /> : null}
          {starter.whip != null ? <Kv label="WHIP" value={starter.whip.toFixed(2)} /> : null}
          {starter.strikeoutPct != null ? <Kv label="K%" value={`${starter.strikeoutPct}%`} /> : null}
          {starter.walkPct != null ? <Kv label="BB%" value={`${starter.walkPct}%`} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionSnapshot({ vm }) {
  const a = vm.action || {};
  if (!a.available) return <p className="agd-empty">{a.emptyLabel || "No current ACTION snapshot"}</p>;
  return (
    <div className="agd-action-snapshot">
      <ActionTile tone="signal" icon="🎯" label={a.headline?.label || "SIGNAL"} value={a.headline?.lineLabel || a.headline?.detail || "—"} team={a.headline?.team} />
      <ActionTile tone="move" icon="📈" label="LINE MOVE" value={a.lineMove?.label || "—"} />
      <ActionTile tone="tickets" icon="🎟️" label="TICKETS" value={a.tickets ? `${a.tickets.awayPct}% / ${a.tickets.homePct}%` : "—"} />
      <ActionTile tone="money" icon="💰" label="MONEY" value={a.money ? `${a.money.awayPct}% / ${a.money.homePct}%` : "—"} />
      <ActionTile tone="sample" icon="👥" label="SAMPLE" value={a.sample?.label || "—"} />
    </div>
  );
}

function ActionTile({ tone, icon, label, value, team }) {
  return <div className={`agd-action-tile agd-action-tile-${tone}`}><span>{icon} {label}</span><strong>{team ? <TeamLogo team={team} size={22} /> : null}{value}</strong></div>;
}

function TeamMetric({ label, side, tone }) {
  return <div className={`agd-team-metric agd-team-metric-${tone}`}><span>{label}</span><strong>{side?.team ? <TeamLogo team={side.team} size={34} /> : null}{side?.line != null ? fmtLine(side.line) : side?.label || "—"}</strong></div>;
}

function weatherEmoji(text) {
  const value = String(text || "").toLowerCase();
  if (/thunder|storm/.test(value)) return "⛈️";
  if (/rain|shower/.test(value)) return "🌧️";
  if (/snow|sleet|ice/.test(value)) return "🌨️";
  if (/partly|mostly cloudy/.test(value)) return "🌤️";
  if (/cloud|overcast/.test(value)) return "☁️";
  if (/sun|clear/.test(value)) return "☀️";
  if (/wind/.test(value)) return "💨";
  return "🌡️";
}

function ProjectedScores({ vm }) {
  const p = vm.projectedScores || {};
  return (
    <div className="agd-proj">
      <h3 className="agd-section-title">PROJECTED SCORES</h3>
      {p.available ? (
        <div className="agd-proj-row">
          <div className="agd-proj-team">
            <TeamLogo team={vm.away} size={38} />
            <div>
              <div className="agd-proj-score">{p.away ?? "—"}</div>
              <div className="agd-proj-name">
                {String(vm.away?.name || vm.away?.abbr || "AWAY").toUpperCase()}
                {vm.away?.record ? ` (${vm.away.record})` : ""}
              </div>
            </div>
          </div>
          <div className="agd-proj-total">
            <span>Total</span>
            <strong>{p.total ?? "—"}</strong>
          </div>
          <div className="agd-proj-team agd-proj-team-home">
            <div>
              <div className="agd-proj-score">{p.home ?? "—"}</div>
              <div className="agd-proj-name">
                {String(vm.home?.name || vm.home?.abbr || "HOME").toUpperCase()}
                {vm.home?.record ? ` (${vm.home.record})` : ""}
              </div>
            </div>
            <TeamLogo team={vm.home} size={38} />
          </div>
        </div>
      ) : (
        <p className="agd-empty">No FBIS projection published</p>
      )}
    </div>
  );
}

function ProbBar({ title, data, away, home }) {
  return (
    <div className="agd-card">
      <div className="agd-card-title">{title}</div>
      {data?.available ? (
        <>
          <div className="agd-prob-track" aria-hidden="true">
            <div className="agd-prob-away" style={{ width: `${data.awayPct}%` }} />
            <div className="agd-prob-home" style={{ width: `${data.homePct}%` }} />
          </div>
          <div className="agd-prob-legend">
            <span>
              <TeamLogo team={away} size={14} /> {data.awayPct}%
            </span>
            <span>
              <TeamLogo team={home} size={14} /> {data.homePct}%
            </span>
          </div>
        </>
      ) : (
        <p className="agd-empty">{data?.reason || "Unavailable"}</p>
      )}
    </div>
  );
}

function EvCard({ ev, home }) {
  return (
    <div className="agd-card">
      <div className="agd-card-title">EXPECTED VALUE (MODEL)</div>
      {ev?.available ? (
        <div className="agd-ev-row">
          <span>
            <TeamLogo team={home} size={14} />{" "}
            {ev.valuePct != null ? `${fmtSigned(ev.valuePct)}%` : "—"}
            {ev.pick ? ` · ${ev.pick}` : ""}
          </span>
        </div>
      ) : (
        <p className="agd-empty">{ev?.reason || "Unavailable"}</p>
      )}
    </div>
  );
}

function ConfidenceCard({ confidence }) {
  const score = confidence?.available ? confidence.score : 0;
  const filled = confidence?.available ? Math.max(0, Math.min(5, Math.round(score / 20))) : 0;
  return (
    <div className="agd-card">
      <div className="agd-card-title">MODEL CONFIDENCE</div>
      {confidence?.available ? (
        <>
          <div className="agd-conf-track" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={`agd-conf-seg${i < filled ? " is-on" : ""}`} />
            ))}
          </div>
          <div className="agd-conf-label">
            {confidence.label} ({confidence.score}/100)
          </div>
        </>
      ) : (
        <p className="agd-empty">{confidence?.reason || "Unavailable"}</p>
      )}
    </div>
  );
}

function TotalCard({ total }) {
  return (
    <div className="agd-card">
      <div className="agd-card-title">GAME TOTAL</div>
      {total?.available ? (
        <>
          <div className="agd-total-val">{total.total ?? "—"}</div>
          <div className="agd-total-split">
            {total.overPct != null && total.underPct != null
              ? `Over ${total.overPct}% | Under ${total.underPct}%`
              : total.reason || "OU probabilities not published"}
          </div>
        </>
      ) : (
        <p className="agd-empty">Total not published</p>
      )}
    </div>
  );
}

function LineHistoryCard({ history, compact = false }) {
  return (
    <div className={`agd-card agd-line-hist${compact ? " is-compact" : ""}`}>
      <div className="agd-card-title-row">
        <div className="agd-card-title">LINE HISTORY</div>
        <span className="agd-chip">{history?.title || "Spread"}</span>
      </div>
      {history?.available ? (
        <LineSpark points={history.points || []} />
      ) : (
        <p className="agd-empty">{history?.emptyReason || "Unavailable"}</p>
      )}
    </div>
  );
}

function LineSpark({ points }) {
  if (!points.length) return <p className="agd-empty">No points</p>;
  const vals = points.map((p) => p.line);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(0.5, max - min);
  const w = 280;
  const h = 90;
  const pad = 8;
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.line - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c[0]},${c[1]}`).join(" ");

  return (
    <div className="agd-spark">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Line history">
        {[pad, h / 2, h - pad].map((y) => <line key={y} x1={pad} x2={w - pad} y1={y} y2={y} className="agd-spark-grid" />)}
        <text x={pad + 2} y={pad + 11} className="agd-spark-axis">{fmtLine(max)}</text>
        <text x={pad + 2} y={h - pad - 4} className="agd-spark-axis">{fmtLine(min)}</text>
        <path d={d} fill="none" stroke="#ff4f7b" strokeWidth="3" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill="#ff84a5" stroke="#fff" strokeWidth=".7" />
        ))}
      </svg>
      <div className="agd-spark-labels">
        {points.map((p, i) => (
          <span key={i}>
            {p.label || ""} {fmtLine(p.line)}
          </span>
        ))}
      </div>
    </div>
  );
}

function BettingSplitsCard({ splits, away, home, mode, setMode, compact = false }) {
  const active = mode === "money" ? splits?.money : splits?.tickets;
  return (
    <div className={`agd-card agd-splits${compact ? " is-compact" : ""}`}>
      <div className="agd-card-title-row">
        <div className="agd-card-title">BETTING SPLITS</div>
        <div className="agd-toggle">
          {["tickets", "money", "both"].map((m) => (
            <button
              key={m}
              type="button"
              className={`agd-toggle-btn${mode === m ? " is-active" : ""}`}
              onClick={() => setMode?.(m)}
            >
              {m === "tickets" ? "Tickets" : m === "money" ? "Money" : "Both"}
            </button>
          ))}
        </div>
      </div>

      {!splits?.available ? (
        <p className="agd-empty">No ACTION splits for this game</p>
      ) : mode === "both" ? (
        <>
          <SplitRow label="Public Tickets" row={splits.tickets} away={away} home={home} />
          <SplitRow label="Money" row={splits.money} away={away} home={home} />
        </>
      ) : (
        <SplitRow
          label={mode === "money" ? "Money" : "Public Tickets"}
          row={active}
          away={away}
          home={home}
        />
      )}
    </div>
  );
}

function SplitRow({ label, row, away, home }) {
  if (!row) return <p className="agd-empty">{label}: unavailable</p>;
  return (
    <div className="agd-split-row">
      <div className="agd-split-lab">{label}</div>
      <div className="agd-prob-track" aria-hidden="true">
        <div className="agd-prob-away" style={{ width: `${row.awayPct ?? 0}%` }} />
        <div className="agd-prob-home" style={{ width: `${row.homePct ?? 0}%` }} />
      </div>
      <div className="agd-prob-legend">
        <span>
          <TeamLogo team={away} size={14} /> {row.awayPct ?? "—"}%
        </span>
        <span>
          <TeamLogo team={home} size={14} /> {row.homePct ?? "—"}%
        </span>
      </div>
    </div>
  );
}

function ActionPanel({ vm }) {
  const a = vm.action || {};
  if (!a.available) {
    return <EmptyPanel title="Action Intel" reason={a.emptyLabel || "NO CURRENT DATA"} />;
  }
  return (
    <div className="agd-tab-panel">
      {a.headline ? (
        <div className="agd-signal">
          <div className="agd-signal-top">
            <span>{a.headline.icon || "◎"}</span>
            <strong>{a.headline.label}</strong>
          </div>
          <div className="agd-signal-body">
            {a.headline.team ? <TeamLogo team={a.headline.team} size={28} /> : null}
            <div>
              <div className="agd-signal-line">{a.headline.lineLabel || "—"}</div>
              <div className="agd-signal-detail">{a.headline.detail || ""}</div>
            </div>
          </div>
        </div>
      ) : null}
      <BettingSplitsCard
        splits={vm.bettingSplits}
        away={vm.away}
        home={vm.home}
        mode="both"
        setMode={() => {}}
      />
      <div className="agd-kv-grid">
        <Kv label="Line move" value={a.lineMove?.label || "—"} />
        <Kv
          label="Sample"
          value={
            a.sample?.label
              ? `${a.sample.label}${a.sample.count != null ? " tracked bets" : ""}`
              : "—"
          }
        />
        <Kv label="Book range" value={a.bookRange?.label || "—"} />
        <Kv label="Best book" value={a.bestBook || "—"} />
      </div>
    </div>
  );
}

function MatchupPanel({ vm }) {
  const starters = vm.context?.starters;
  return (
    <div className="agd-tab-panel">
      <div className="agd-match-teams">
        <div>
          <TeamLogo team={vm.away} size={48} />
          <strong>{vm.away?.displayName || vm.away?.abbr}</strong>
          <span>{vm.away?.record || ""}</span>
        </div>
        <div className="agd-vs">VS</div>
        <div>
          <TeamLogo team={vm.home} size={48} />
          <strong>{vm.home?.displayName || vm.home?.abbr}</strong>
          <span>{vm.home?.record || ""}</span>
        </div>
      </div>
      {starters?.away || starters?.home ? (
        <div className="agd-starters">
          <h3 className="agd-section-title">{vm.context?.startersLabel || "STARTERS"}</h3>
          {["away", "home"].map((side) => {
            const s = starters?.[side];
            if (!s) return null;
            return (
              <div key={side} className="agd-starter">
                <TeamLogo team={s.team || (side === "away" ? vm.away : vm.home)} size={20} />
                <div>
                  <strong>{s.name}</strong>
                  <span>
                    {[
                      s.hand ? `${s.hand}HP` : null,
                      s.era != null ? `${Number(s.era).toFixed(2)} ERA` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="agd-empty">No starter details for this sport/slate</p>
      )}
    </div>
  );
}

function EmptyPanel({ title, reason }) {
  return (
    <div className="agd-tab-panel">
      <h3 className="agd-section-title">{title}</h3>
      <p className="agd-empty">{reason}</p>
    </div>
  );
}

function Kv({ label, value }) {
  return (
    <div className="agd-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fmtSigned(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtLine(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "PK";
  const rounded = Math.round(v * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
