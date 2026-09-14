import { useMemo, useState } from "react";
import TeamLogo from "../TeamLogo.jsx";
import { buildBoardGameViewModel } from "../../lib/boardViewModel.js";
import { fmtNum, fmtSigned } from "../../lib/format.js";
import { venueAtmosphereClass } from "../../lib/venueAtmosphere.js";
import "./decisionBoard.css";

/** Short badge; long explanation lives in title tooltips. */
function StatusPill({ vm }) {
  const { event, decision, authority } = vm;
  if (event?.final) {
    return (
      <span className="db-pill db-pill-final" title="Game is final">
        FINAL
      </span>
    );
  }
  if (event?.live) {
    return (
      <span className="db-pill db-pill-live" title="Live — pregame model shown">
        <span className="db-live-dot" aria-hidden="true" />
        LIVE
      </span>
    );
  }
  if (authority?.research || decision?.qualification === "RESEARCH_ONLY") {
    return (
      <span
        className="db-pill db-pill-research"
        title="Research projection — not calibrated for wager qualification"
      >
        RESEARCH
      </span>
    );
  }
  if (decision?.qualification === "QUALIFIED") {
    return (
      <span className="db-pill db-pill-qualified" title="Qualified with execution market and wager authority">
        QUALIFIED
      </span>
    );
  }
  if (decision?.qualification === "WATCH") {
    const unpriced =
      vm?.market?.executionMarketAvailable === false ||
      vm?.authority?.canAuthorizeWager === false;
    return (
      <span
        className="db-pill db-pill-watch"
        title={
          unpriced
            ? "Model lean only — no execution price / wager authority"
            : "Watch — not wager-authorized"
        }
      >
        {unpriced ? "WATCH · UNPRICED" : "WATCH"}
      </span>
    );
  }
  if (decision?.dqState || vm.quality?.marketUnresolved) {
    return (
      <span className="db-pill db-pill-block" title="Data quality block">
        BLOCKED
      </span>
    );
  }
  return <span className="db-pill db-pill-neutral">{decision?.label || "—"}</span>;
}

function SpreadTrack({ fbis, market, fbisLabel, marketLabel }) {
  const a = fbis == null || Number.isNaN(Number(fbis)) ? null : Number(fbis);
  const b = market == null || Number.isNaN(Number(market)) ? null : Number(market);
  if (a == null && b == null) return null;
  const vals = [a, b].filter((x) => x != null);
  const min = Math.min(...vals) - 1.5;
  const max = Math.max(...vals) + 1.5;
  const span = max - min || 1;
  const pct = (v) => `${((v - min) / span) * 100}%`;

  return (
    <div
      className="db-track"
      role="img"
      aria-label={`FBIS ${fbisLabel || (a ?? "—")}, market ${marketLabel || (b ?? "—")}`}
    >
      <div className="db-track-rail" aria-hidden="true">
        {a != null && b != null ? (
          <span
            className="db-track-span"
            style={{
              left: pct(Math.min(a, b)),
              width: `calc(${pct(Math.max(a, b))} - ${pct(Math.min(a, b))})`,
            }}
          />
        ) : null}
        {a != null ? <span className="db-track-dot db-track-fbis" style={{ left: pct(a) }} /> : null}
        {b != null ? <span className="db-track-dot db-track-mkt" style={{ left: pct(b) }} /> : null}
      </div>
      <div className="db-track-legend">
        <span className="db-leg-fbis">
          FBIS <strong>{fbisLabel || fmtSigned(a)}</strong>
        </span>
        <span className="db-leg-mkt">
          MKT <strong>{marketLabel || (b == null ? "—" : fmtSigned(b))}</strong>
        </span>
      </div>
    </div>
  );
}

function TotalBars({ fbis, market }) {
  const a = fbis == null || Number.isNaN(Number(fbis)) ? null : Number(fbis);
  const b = market == null || Number.isNaN(Number(market)) ? null : Number(market);
  if (a == null && b == null) return null;
  const max = Math.max(a ?? 0, b ?? 0, 1);
  return (
    <div
      className="db-total-bars"
      role="img"
      aria-label={`FBIS total ${a ?? "—"}, market total ${b ?? "—"}`}
    >
      <div className="db-tbar-row">
        <span className="db-tbar-lab db-leg-fbis">FBIS</span>
        <div className="db-tbar-track">
          {a != null ? (
            <div className="db-tbar db-tbar-fbis" style={{ width: `${(a / max) * 100}%` }} />
          ) : null}
        </div>
        <strong className="db-tbar-val">{a == null ? "—" : fmtNum(a, 1)}</strong>
      </div>
      <div className="db-tbar-row">
        <span className="db-tbar-lab db-leg-mkt">MKT</span>
        <div className="db-tbar-track">
          {b != null ? (
            <div className="db-tbar db-tbar-mkt" style={{ width: `${(b / max) * 100}%` }} />
          ) : (
            <div className="db-tbar db-tbar-empty" />
          )}
        </div>
        <strong className="db-tbar-val">{b == null ? "—" : fmtNum(b, 1)}</strong>
      </div>
    </div>
  );
}

function DeltaPills({ vm }) {
  const c = vm.comparison;
  const d = vm.decision;
  if (vm.authority?.evAvailable && d?.ev != null) {
    return (
      <div className="db-delta-pills">
        <div className={`db-kpi ${d.ev >= 0 ? "db-kpi-pos" : "db-kpi-neg"}`}>
          <span className="db-kpi-lab">EV</span>
          <strong>
            {d.ev >= 0 ? "+" : ""}
            {fmtNum(d.ev, 1)}%
          </strong>
        </div>
      </div>
    );
  }
  if (!c?.hasDiff) {
    return (
      <div className="db-delta-pills">
        <div className="db-kpi db-kpi-muted">
          <span className="db-kpi-lab">Δ</span>
          <strong>—</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="db-delta-pills" title={c.label || "Model difference"}>
      <div className="db-kpi">
        <span className="db-kpi-lab">SIDE Δ</span>
        <strong>{c.spreadDelta == null ? "—" : fmtNum(Math.abs(c.spreadDelta), 1)}</strong>
      </div>
      <div className="db-kpi">
        <span className="db-kpi-lab">TOTAL Δ</span>
        <strong>{c.totalDelta == null ? "—" : fmtSigned(c.totalDelta, 1)}</strong>
      </div>
    </div>
  );
}

function PublicBars({ game }) {
  const splits = game?.publicSplits || game?.actionIntel?.publicSplits;
  if (!splits) return null;
  const tickets = Number(splits.ticketPct ?? splits.tickets);
  const money = Number(splits.moneyPct ?? splits.money);
  const markets = Array.isArray(splits.markets) ? splits.markets : [];
  const knifeRows = markets.filter(
    (m) => m && m.leanSide && m.magnitude != null && m.magnitude > 0
  );
  if (!Number.isFinite(tickets) && !Number.isFinite(money) && !knifeRows.length) return null;

  const homeAbbr =
    game?.home?.abbr || game?.homeAbbr || game?.teams?.homeAbbr || "HOME";
  const awayAbbr =
    game?.away?.abbr || game?.awayAbbr || game?.teams?.awayAbbr || "AWAY";

  const sideLabel = (lean) => {
    if (lean === "HOME") return homeAbbr;
    if (lean === "AWAY") return awayAbbr;
    if (lean === "OVER") return "OVER";
    if (lean === "UNDER") return "UNDER";
    return lean || "—";
  };

  const marketLabel = (market) => {
    if (market === "TOTAL") return "TOT";
    return market || "—";
  };

  const ariaKnives = knifeRows
    .map(
      (m) =>
        `${marketLabel(m.market)} ${sideLabel(m.leanSide)} ${Math.round(m.magnitude)}`
    )
    .join(", ");

  return (
    <div
      className="db-public"
      role="img"
      aria-label={[
        Number.isFinite(tickets) || Number.isFinite(money)
          ? `Public tickets ${Number.isFinite(tickets) ? tickets : "—"}%, money ${Number.isFinite(money) ? money : "—"}%`
          : null,
        ariaKnives ? `Money lean ${ariaKnives}` : null,
      ]
        .filter(Boolean)
        .join(". ")}
    >
      <div className="db-public-title">PUBLIC</div>
      {Number.isFinite(tickets) ? (
        <div className="db-public-row">
          <span>TKT</span>
          <div className="db-public-track">
            <div className="db-public-fill" style={{ width: `${Math.min(100, tickets)}%` }} />
          </div>
          <strong>{fmtNum(tickets, 0)}%</strong>
        </div>
      ) : null}
      {Number.isFinite(money) ? (
        <div className="db-public-row">
          <span>$$$</span>
          <div className="db-public-track">
            <div
              className="db-public-fill db-public-money"
              style={{ width: `${Math.min(100, money)}%` }}
            />
          </div>
          <strong>{fmtNum(money, 0)}%</strong>
        </div>
      ) : null}
      {knifeRows.length ? (
        <div className="db-knife-row" aria-hidden="true">
          {knifeRows.map((m) => (
            <span
              key={m.market}
              className={`db-knife${m.magnitude >= 10 ? " is-hot" : ""}`}
              title={`Money vs tickets on ${m.market}: ${sideLabel(m.leanSide)} ${fmtSigned(m.moneyTicketGap, 0)} (research lean, not a sharp label)`}
            >
              <span className="db-knife-ico">🔪</span>
              <span className="db-knife-mkt">{marketLabel(m.market)}</span>
              <span className="db-knife-side">{sideLabel(m.leanSide)}</span>
              <strong className="db-knife-amt">{fmtSigned(m.magnitude, 0)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}


function ScoreHero({ vm, game }) {
  const p = vm.projection;
  if (p?.loading) {
    return (
      <div className="db-hero db-skeleton" aria-busy="true">
        <div className="db-skel-line" />
      </div>
    );
  }
  if (!p?.available) {
    return (
      <div className="db-hero db-hero-empty">
        <span className="db-empty">No FBIS</span>
      </div>
    );
  }
  return (
    <div className="db-hero">
      <div className="db-hero-side">
        <TeamLogo team={game.away} size={36} />
        <div className="db-hero-meta">
          <span className="db-hero-abbr">{vm.teams.awayAbbr}</span>
          <strong className="db-hero-score">{fmtNum(p.away, 1)}</strong>
        </div>
      </div>
      <div className="db-hero-mid">
        <span className="db-vs">VS</span>
        {p.research ? (
          <span className="db-mini-badge" title="Research model">
            R
          </span>
        ) : null}
      </div>
      <div className="db-hero-side db-hero-home">
        <div className="db-hero-meta">
          <span className="db-hero-abbr">{vm.teams.homeAbbr}</span>
          <strong className="db-hero-score">{fmtNum(p.home, 1)}</strong>
        </div>
        <TeamLogo team={game.home} size={36} />
      </div>
    </div>
  );
}

function MarketChip({ vm }) {
  const m = vm.market;
  if (!m?.available) {
    const short = m?.referenceOnly ? "REF ONLY" : "NO MARKET";
    return (
      <div
        className={`db-mkt-chip ${m?.referenceOnly ? "db-mkt-ref" : "db-mkt-none"}`}
        title={m?.emptyReason || "No current operational market"}
      >
        <span className="db-mkt-icon" aria-hidden="true">
          ◌
        </span>
        <span>{short}</span>
      </div>
    );
  }
  const roleClass =
    m.role === "EXECUTION_MARKET"
      ? "db-mkt-exec"
      : m.role === "CONSENSUS_MARKET"
        ? "db-mkt-cons"
        : "db-mkt-obs";
  const shortLabel =
    m.label === "BEST AVAILABLE"
      ? "BEST"
      : m.label === "EXECUTION OFFER"
        ? "EXEC"
        : m.label === "CONSENSUS"
          ? "CONSENSUS"
          : m.label === "OBSERVED MARKET"
            ? "OBSERVED"
            : m.label || "MARKET";
  return (
    <div
      className={`db-mkt-chip ${roleClass}`}
      title={[m.label, m.book].filter(Boolean).join(" · ")}
    >
      <span className="db-mkt-icon" aria-hidden="true">
        ●
      </span>
      <span>{shortLabel}</span>
      {m.book ? <span className="db-mkt-book">{m.book}</span> : null}
    </div>
  );
}

function GameBody({ vm, game }) {
  return (
    <>
      <ScoreHero vm={vm} game={game} />
      <div className="db-row-compare">
        <SpreadTrack
          fbis={vm.projection?.fairHomeSpread}
          market={vm.market?.available ? vm.market.spread : null}
          fbisLabel={vm.projection?.spreadLabel}
          marketLabel={vm.market?.spreadLabel}
        />
        <TotalBars
          fbis={vm.projection?.total}
          market={vm.market?.available ? vm.market.total : null}
        />
      </div>
      <div className="db-row-bottom">
        <MarketChip vm={vm} />
        <DeltaPills vm={vm} />
        <PublicBars game={game} />
      </div>
    </>
  );
}

function DecisionBoardCard({ game, open, onToggle, renderDetail }) {
  const vm = useMemo(() => buildBoardGameViewModel(game), [game]);
  const key = `${game.sport}:${game.id}`;
  const sport = String(vm.sport || game.sport || "").toLowerCase();
  const venueClass = venueAtmosphereClass(sport);

  return (
    <article
      className={`db-card decision-tier-${vm.decision?.tier || "NONE"}${venueClass ? ` ${venueClass}` : ""}`}
      data-game-id={game.id}
      data-sport={sport || undefined}
    >
      <header className="db-card-header">
        <div className="db-kick">
          {vm.event?.live ? <span className="db-live-dot" aria-hidden="true" /> : null}
          <span className="db-kick-time">{vm.timing?.timeLine || "—"}</span>
          <span className="db-sport-tag">
            {String(vm.sport || game.sport || "").toUpperCase()}
          </span>
        </div>
        <StatusPill vm={vm} />
      </header>
      <GameBody vm={vm} game={game} />
      <footer className="db-card-footer">
        <button type="button" className="db-expand-btn" onClick={() => onToggle(key)}>
          {open ? "Hide" : "Open"}
        </button>
      </footer>
      {open ? <div className="db-detail-panel">{renderDetail?.(game)}</div> : null}
    </article>
  );
}

export function BoardSummaryStrip({ games = [] }) {
  const stats = useMemo(() => {
    let research = 0;
    let watch = 0;
    let qualified = 0;
    let blocked = 0;
    let live = 0;
    let final = 0;
    let withMarket = 0;
    for (const g of games || []) {
      const vm = buildBoardGameViewModel(g);
      if (vm.event?.final) final += 1;
      else if (vm.event?.live) live += 1;
      if (vm.authority?.research || vm.decision?.qualification === "RESEARCH_ONLY") {
        research += 1;
      } else if (vm.decision?.qualification === "WATCH") watch += 1;
      else if (vm.decision?.qualification === "QUALIFIED") qualified += 1;
      if (vm.decision?.dqState || vm.quality?.marketUnresolved) blocked += 1;
      if (vm.market?.available) withMarket += 1;
    }
    return { n: games.length, research, watch, qualified, blocked, live, final, withMarket };
  }, [games]);

  if (!stats.n) return null;

  return (
    <div className="db-summary" aria-label="Board summary">
      <div className="db-summary-count">
        <strong>{stats.n}</strong>
        <span>GAMES</span>
      </div>
      <div className="db-summary-tiles">
        {stats.research > 0 ? (
          <div className="db-sum-tile db-sum-research" title="Research projections">
            <strong>{stats.research}</strong>
            <span>RESEARCH</span>
          </div>
        ) : null}
        {stats.watch > 0 ? (
          <div className="db-sum-tile db-sum-watch">
            <strong>{stats.watch}</strong>
            <span>WATCH</span>
          </div>
        ) : null}
        {stats.qualified > 0 ? (
          <div className="db-sum-tile db-sum-qual">
            <strong>{stats.qualified}</strong>
            <span>QUAL</span>
          </div>
        ) : null}
        {stats.blocked > 0 ? (
          <div className="db-sum-tile db-sum-block">
            <strong>{stats.blocked}</strong>
            <span>BLOCK</span>
          </div>
        ) : null}
        {stats.live > 0 ? (
          <div className="db-sum-tile db-sum-live">
            <strong>{stats.live}</strong>
            <span>LIVE</span>
          </div>
        ) : null}
        {stats.final > 0 ? (
          <div className="db-sum-tile db-sum-final">
            <strong>{stats.final}</strong>
            <span>FINAL</span>
          </div>
        ) : null}
        <div className="db-sum-tile db-sum-mkt" title="Games with operational market">
          <strong>{stats.withMarket}</strong>
          <span>MKT</span>
        </div>
      </div>
      <div className="db-legend" title="Color legend">
        <span className="db-leg-fbis">● FBIS</span>
        <span className="db-leg-mkt">● Market</span>
      </div>
    </div>
  );
}

/**
 * Decision Board — visual hybrid cards.
 * Presentation only: FBIS → Market → Difference → Decision.
 */
export default function DecisionBoard({ games = [], renderDetail }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => {
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!games.length) {
    return <div className="empty">No games on this filter.</div>;
  }

  return (
    <div className="decision-board">
      <BoardSummaryStrip games={games} />
      <div className="db-grid" role="list" aria-label="Decision board cards">
        {games.map((g) => {
          const key = `${g.sport}:${g.id}`;
          const isOpen = open.has(key);
          return (
            <div
              key={key}
              role="listitem"
              className={`db-grid-item${isOpen ? " db-grid-item-open" : ""}`}
            >
              <DecisionBoardCard
                game={g}
                open={isOpen}
                onToggle={toggle}
                renderDetail={renderDetail}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
