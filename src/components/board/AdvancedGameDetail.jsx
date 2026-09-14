import { useMemo, useState } from "react";
import TeamLogo from "../TeamLogo.jsx";
import { buildAdvancedGameViewModel } from "../../lib/advancedGameViewModel.js";
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

  return (
    <section className="agd" aria-label="Advanced game details">
      <header className="agd-header">
        <div className="agd-matchup">
          <TeamLogo team={vm.away} size={36} />
          <div className="agd-matchup-text">
            <div className="agd-matchup-title">{vm.matchupLabel}</div>
            <div className="agd-matchup-meta">
              <span>{vm.timeLine}</span>
              <span className="agd-sport">{String(vm.sport || "").toUpperCase()}</span>
            </div>
          </div>
          <TeamLogo team={vm.home} size={36} />
        </div>

        <div className="agd-meta">
          {vm.venueLine ? <span>📍 {vm.venueLine}</span> : null}
          {vm.weatherLine ? <span>🌤 {vm.weatherLine}</span> : null}
          {vm.windLabel ? <span>💨 {vm.windLabel}</span> : null}
        </div>

        <div className="agd-header-right">
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
      </header>

      <nav className="agd-tabs" aria-label="Detail sections">
        {vm.tabs.map((t) => (
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
            <aside className="agd-takeaways">
              <h3 className="agd-section-title">KEY TAKEAWAYS</h3>
              <ul>
                {(vm.takeaways || []).map((t, i) => (
                  <li key={`${t.tone}-${i}`} className={`agd-takeaway agd-takeaway-${t.tone}`}>
                    <span className="agd-takeaway-icon">{t.icon}</span>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="agd-center">
              <ProjectedScores vm={vm} />
              <div className="agd-prob-grid">
                <ProbBar title="WIN PROBABILITY (MODEL)" data={vm.probabilities.win} away={vm.away} home={vm.home} />
                <ProbBar title="COVER PROBABILITY" data={vm.probabilities.cover} away={vm.away} home={vm.home} />
                <EvCard ev={vm.probabilities.ev} home={vm.home} />
                <ConfidenceCard confidence={vm.probabilities.confidence} />
              </div>
            </div>

            <aside className="agd-right">
              <LineHistoryCard history={vm.lineHistory} compact />
              <BettingSplitsCard
                splits={vm.bettingSplits}
                away={vm.away}
                home={vm.home}
                mode={splitsMode}
                setMode={setSplitsMode}
                compact
              />
            </aside>
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

function ProjectedScores({ vm }) {
  const p = vm.projectedScores || {};
  return (
    <div className="agd-proj">
      <h3 className="agd-section-title">PROJECTED SCORES</h3>
      {p.available ? (
        <div className="agd-proj-row">
          <ProjTeam side="away" team={vm.away} score={p.away} />
          <div className="agd-proj-total">
            <span>Total</span>
            <strong>{p.total ?? "—"}</strong>
          </div>
          <ProjTeam side="home" team={vm.home} score={p.home} />
        </div>
      ) : (
        <p className="agd-empty">No FBIS projection published</p>
      )}
    </div>
  );
}

function ProjTeam({ side, team, score }) {
  const abbr = String(team?.abbr || team?.name || (side === "home" ? "HOME" : "AWAY")).toUpperCase();
  const full = team?.name ? String(team.name).toUpperCase() : null;
  return (
    <div className={`agd-proj-team agd-proj-team-${side}`}>
      <TeamLogo team={team} size={28} />
      <div className="agd-proj-score">{score ?? "—"}</div>
      <div className="agd-proj-name" title={full || abbr}>
        <span className="agd-proj-abbr">{abbr}</span>
        {team?.record ? <span className="agd-proj-record">({team.record})</span> : null}
      </div>
      {full && full !== abbr ? <div className="agd-proj-fullname">{full}</div> : null}
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
        <p className="agd-empty">
          {compact ? "No ACTION snapshot yet" : history?.emptyReason || "Unavailable"}
        </p>
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
        <path d={d} fill="none" stroke="#ff6b8a" strokeWidth="2.5" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="#ff6b8a" />
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
        <p className="agd-empty">{compact ? "No ACTION snapshot yet" : "No ACTION splits for this game"}</p>
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
  return v > 0 ? `+${v}` : `${v}`;
}
