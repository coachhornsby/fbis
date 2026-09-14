import { Fragment, useMemo, useState } from "react";
import { TeamIdentity } from "../TeamLogo.jsx";
import { buildBoardGameViewModel } from "../../lib/boardViewModel.js";
import { fmtNum } from "../../lib/format.js";
import "./decisionBoard.css";

function StatusPill({ vm }) {
  const { event, decision, authority } = vm;
  if (event?.final) return <span className="db-pill db-pill-final">FINAL</span>;
  if (event?.live) {
    return <span className="db-pill db-pill-live">LIVE · PREGAME MODEL</span>;
  }
  if (authority?.research || decision?.qualification === "RESEARCH_ONLY") {
    return <span className="db-pill db-pill-research">RESEARCH</span>;
  }
  if (decision?.qualification === "QUALIFIED") {
    return <span className="db-pill db-pill-qualified">QUALIFIED</span>;
  }
  if (decision?.qualification === "WATCH") {
    return <span className="db-pill db-pill-watch">WATCH</span>;
  }
  if (decision?.dqState || vm.quality?.marketUnresolved) {
    return <span className="db-pill db-pill-block">DATA BLOCK</span>;
  }
  return <span className="db-pill db-pill-neutral">{decision?.label || "—"}</span>;
}

function FbisBlock({ vm }) {
  const p = vm.projection;
  if (p?.loading) {
    return (
      <div className="db-block db-fbis db-skeleton" aria-busy="true">
        <div className="db-block-label">FBIS</div>
        <div className="db-skel-line" />
        <div className="db-skel-line short" />
      </div>
    );
  }
  if (!p?.available) {
    return (
      <div className="db-block db-fbis">
        <div className="db-block-label">FBIS</div>
        <div className="db-empty">No independent FBIS projection for this event.</div>
      </div>
    );
  }
  return (
    <div className="db-block db-fbis">
      <div className="db-block-label">
        {p.headlineLabel || "FBIS"}
        {p.research ? <span className="db-mini-badge">RESEARCH</span> : null}
      </div>
      <div className="db-scoreline">
        <span>{vm.teams.awayAbbr}</span>
        <strong>{fmtNum(p.away, 1)}</strong>
      </div>
      <div className="db-scoreline">
        <span>{vm.teams.homeAbbr}</span>
        <strong>{fmtNum(p.home, 1)}</strong>
      </div>
      <div className="db-derived">
        <span>{p.spreadLabel || "—"}</span>
        <span>Total {p.total == null ? "—" : fmtNum(p.total, 1)}</span>
      </div>
      {p.modelVersion ? (
        <div className="db-model-meta muted">
          {p.modelId ? `${p.modelId} · ` : ""}
          {p.modelVersion}
        </div>
      ) : null}
    </div>
  );
}

function MarketBlock({ vm }) {
  const m = vm.market;
  if (!m?.available) {
    return (
      <div className="db-block db-market">
        <div className="db-block-label">{m?.label || "MARKET"}</div>
        <div className="db-empty">{m?.emptyReason || "No executable market."}</div>
      </div>
    );
  }
  return (
    <div className="db-block db-market">
      <div className="db-block-label">
        {m.label}
        {m.book ? <span className="db-mini-badge muted-badge">{m.book}</span> : null}
      </div>
      <div className="db-derived primary">
        <strong>{m.spreadLabel || "—"}</strong>
      </div>
      <div className="db-derived">
        <span>Total {m.total == null ? "—" : fmtNum(m.total, 1)}</span>
      </div>
    </div>
  );
}

function DiffBlock({ vm }) {
  const c = vm.comparison;
  const d = vm.decision;
  if (vm.authority?.evAvailable && d?.ev != null) {
    return (
      <div className="db-block db-diff">
        <div className="db-block-label">EV</div>
        <strong className={d.ev >= 0 ? "text-pos" : "text-neg"}>
          {d.ev >= 0 ? "+" : ""}
          {fmtNum(d.ev, 1)}%
        </strong>
      </div>
    );
  }
  if (!c?.hasDiff) {
    return (
      <div className="db-block db-diff">
        <div className="db-block-label">{c?.label || "MODEL DIFFERENCE"}</div>
        <div className="db-empty">—</div>
      </div>
    );
  }
  return (
    <div className="db-block db-diff">
      <div className="db-block-label">{c.label}</div>
      <div className="db-diff-row">
        <span>Side</span>
        <strong>{c.spreadDelta == null ? "—" : `${Math.abs(c.spreadDelta)} pts`}</strong>
      </div>
      <div className="db-diff-row">
        <span>Total</span>
        <strong>{c.totalDelta == null ? "—" : `${Math.abs(c.totalDelta)} pts`}</strong>
      </div>
      {vm.authority?.research ? (
        <div className="db-authority-note muted">No wagering authority</div>
      ) : null}
    </div>
  );
}

function DecisionBoardRow({ game, open, onToggle, renderDetail }) {
  const vm = useMemo(() => buildBoardGameViewModel(game), [game]);
  const key = `${game.sport}:${game.id}`;

  return (
    <Fragment>
      <tr
        className={`db-row decision-tier-${vm.decision?.tier || "NONE"}`}
        data-game-id={game.id}
        data-maturity={vm.authority?.maturity || ""}
      >
        <td className="db-col-matchup">
          <div className="db-matchup">
            <div className="db-kick">
              {vm.event?.live ? (
                <span className="live-dot" aria-hidden="true">
                  ●
                </span>
              ) : null}
              <span>{vm.timing?.timeLine || game.startCt || "—"}</span>
              <span className="db-sport-tag">{String(vm.sport || "").toUpperCase()}</span>
            </div>
            <div className="db-teams">
              {!vm.teams?.identityOk ? (
                <div className="db-identity-warn">Opponent identity unavailable</div>
              ) : (
                <>
                  <TeamIdentity team={game.away} score={game.score?.away} size={36} />
                  <TeamIdentity team={game.home} score={game.score?.home} size={36} />
                </>
              )}
            </div>
            <button
              type="button"
              className="db-expand-btn"
              aria-expanded={open}
              onClick={() => onToggle(key)}
            >
              {open ? "Hide" : "View"} →
            </button>
          </div>
        </td>
        <td className="db-col-fbis">
          <FbisBlock vm={vm} />
        </td>
        <td className="db-col-market">
          <MarketBlock vm={vm} />
        </td>
        <td className="db-col-diff">
          <DiffBlock vm={vm} />
        </td>
        <td className="db-col-status">
          <StatusPill vm={vm} />
          {vm.decision?.reason ? (
            <div className="db-status-reason muted">{vm.decision.reason}</div>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="db-detail-row">
          <td colSpan={5}>
            <div className="db-detail-panel">{renderDetail?.(game)}</div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function DecisionBoardCard({ game, open, onToggle, renderDetail }) {
  const vm = useMemo(() => buildBoardGameViewModel(game), [game]);
  const key = `${game.sport}:${game.id}`;

  return (
    <article
      className={`db-card decision-tier-${vm.decision?.tier || "NONE"}`}
      data-game-id={game.id}
    >
      <header className="db-card-header">
        <div className="db-card-matchup">
          {!vm.teams?.identityOk ? (
            <strong>Identity unavailable</strong>
          ) : (
            <strong>
              {vm.teams.awayAbbr} @ {vm.teams.homeAbbr}
            </strong>
          )}
          <span className="muted">{vm.timing?.timeLine || "—"}</span>
        </div>
        <StatusPill vm={vm} />
      </header>
      <div className="db-card-grid">
        <FbisBlock vm={vm} />
        <MarketBlock vm={vm} />
      </div>
      <DiffBlock vm={vm} />
      <footer className="db-card-footer">
        <button type="button" className="db-expand-btn" onClick={() => onToggle(key)}>
          {open ? "Hide details" : "View →"}
        </button>
      </footer>
      {open ? <div className="db-detail-panel">{renderDetail?.(game)}</div> : null}
    </article>
  );
}

/**
 * Decision Board slate — desktop dense rows + mobile cards.
 * Columns: MATCHUP | FBIS | MARKET | DIFF | STATUS
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
    return <div className="empty">No games on the board for this filter.</div>;
  }

  return (
    <div className="decision-board">
      <div className="db-desktop table-scroll" role="region" aria-label="Decision board table">
        <table className="fbis-table db-table">
          <thead>
            <tr>
              <th>Matchup</th>
              <th>FBIS</th>
              <th>Market</th>
              <th>Diff</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const key = `${g.sport}:${g.id}`;
              return (
                <DecisionBoardRow
                  key={key}
                  game={g}
                  open={open.has(key)}
                  onToggle={toggle}
                  renderDetail={renderDetail}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="db-mobile" role="list" aria-label="Decision board cards">
        {games.map((g) => {
          const key = `${g.sport}:${g.id}`;
          return (
            <div key={key} role="listitem">
              <DecisionBoardCard
                game={g}
                open={open.has(key)}
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
