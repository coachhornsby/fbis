import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(Math.abs(n % 1) > 0.001 ? 1 : 0);
}

function Stars({ value = 1 }) {
  const safe = Math.max(1, Math.min(5, Number(value) || 1));
  return (
    <span className="cgc-star-row" aria-label={`${safe} of 5 confidence stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} className={i < safe ? "filled" : "empty"} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.28l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96L12 2.2z" /></svg>
      ))}
    </span>
  );
}

function lineLabel(team, line) {
  const n = Number(line);
  if (!team || !Number.isFinite(n)) return "SPREAD";
  if (Math.abs(n) < 0.05) return `${team.abbr || "PICK"} PK`;
  return `${team.abbr || "TEAM"} ${n > 0 ? "+" : ""}${fmt(n)}`;
}

function bestEdge(vm) {
  const cmp = vm.comparison || {};
  const spreadAbs = Number(cmp.sideDiff);
  const spreadSigned = Number(cmp.sideSignedDiff);
  const total = Number(cmp.totalDiff);
  const totalAbs = Number.isFinite(total) ? Math.abs(total) : -1;
  const spreadMagnitude = Number.isFinite(spreadAbs) ? Math.abs(spreadAbs) : -1;

  if (spreadMagnitude < 0 && totalAbs < 0) {
    return { value: "—", detail: "NO EDGE", type: "EDGE", team: null, total: false };
  }

  if (spreadMagnitude >= totalAbs) {
    const marketHomeSpread = Number(vm.market?.spread);
    const away = vm.away || {};
    const home = vm.home || {};
    let team = null;
    let offeredLine = null;

    // signed gap = fair home spread - market home spread.
    // Positive => market is too favorable to the away team.
    // Negative => market is too favorable to the home team.
    if (Number.isFinite(spreadSigned) && Number.isFinite(marketHomeSpread)) {
      if (spreadSigned > 0) {
        team = away;
        offeredLine = -marketHomeSpread;
      } else if (spreadSigned < 0) {
        team = home;
        offeredLine = marketHomeSpread;
      }
    }

    return {
      value: `+${fmt(spreadMagnitude)}`,
      detail: lineLabel(team, offeredLine),
      type: "SPREAD",
      team,
      total: false,
    };
  }

  return {
    value: `${total > 0 ? "+" : ""}${fmt(total)}`,
    detail: total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL",
    type: "TOTAL",
    team: null,
    total: true,
  };
}

function actionSplitLabel(split, away, home) {
  if (!split) return "—";
  const awayPct = Number(split.awayPct);
  const homePct = Number(split.homePct);
  if (!Number.isFinite(awayPct) || !Number.isFinite(homePct)) return "—";
  if (homePct >= awayPct) return `${home.abbr || "HOME"} ${Math.round(homePct)}%`;
  return `${away.abbr || "AWAY"} ${Math.round(awayPct)}%`;
}

function matchupSignalLabel(signal, away, home) {
  if (!signal?.available) return { text: "—", tone: "neutral" };
  const n = Number(signal.adjustment);
  if (!Number.isFinite(n) || Math.abs(n) < 0.15) return { text: "EVEN", tone: "neutral" };
  const team = n > 0 ? home : away;
  return { text: team?.abbr || (n > 0 ? "HOME" : "AWAY"), tone: n > 0 ? "home" : "away" };
}

function actionMoveLabel(action, away, home) {
  const open = Number(action?.movement?.open);
  const current = Number(action?.movement?.current);
  if (Number.isFinite(open) && Number.isFinite(current) && Math.abs(current - open) < 0.05) {
    const team = current < 0 ? home : away;
    const teamLine = current < 0 ? current : -current;
    return `NO MOVE · ${lineLabel(team, teamLine)}`;
  }
  if (action?.lineMove?.label) return action.lineMove.label;
  if (action?.movement?.label) return action.movement.label;
  if (action?.consensus?.spreadHome != null) {
    const s = Number(action.consensus.spreadHome);
    const team = s < 0 ? home : away;
    const teamLine = s < 0 ? s : -s;
    return `CURRENT · ${lineLabel(team, teamLine)}`;
  }
  return "NO MOVE YET";
}

export default function CompactGameCard({ game, onOpen }) {
  const vm = buildGameCardViewModel(game);
  const stars = confidenceStars(game);
  const away = vm.away || {};
  const home = vm.home || {};
  const proj = vm.projection || {};
  const market = vm.market || {};
  const action = vm.action || {};
  const sportId = String(vm.sport || game?.sport || "").toLowerCase();
  const isNfl = sportId === "nfl";
  const showAction = true; // Keep compact-card information architecture consistent across sports.
  const marketSideLabel = ["mlb","npb","kbo"].includes(sportId) ? "MARKET RUN LINE" : sportId === "nhl" ? "MARKET PUCK LINE" : sportId === "soccer" ? "MARKET SIDE" : "MARKET SPREAD";
  const edge = bestEdge(vm);
  const matchup = isNfl ? game?.nflGameMatchup : null;
  const genericFactors = !isNfl && Array.isArray(game?.matchupFactors) ? game.matchupFactors.slice(0, 5) : [];
  const matchupSignals = Array.isArray(matchup?.signals) ? matchup.signals : [];
  const matchupById = Object.fromEntries(matchupSignals.map((s) => [s.id, s]));
  const matchupItems = [
    ["pressure", "PRESSURE"],
    ["run", "RUN"],
    ["coverageRoute", "COVERAGE"],
    ["explosive", "EXPLOSIVE"],
    ["earlyDown", "EARLY DOWN"],
  ].map(([id, label]) => ({ id, label, ...matchupSignalLabel(matchupById[id], away, home) }));
  const genericMatchupItems = genericFactors.map((factor, i) => {
    const edge = String(factor?.edge || factor?.advantage || factor?.team || "EVEN").toUpperCase();
    const homeHit = edge === String(home.abbr || "").toUpperCase();
    const awayHit = edge === String(away.abbr || "").toUpperCase();
    return { id: factor?.id || `factor-${i}`, label: String(factor?.label || factor?.name || "MATCHUP").toUpperCase(), text: homeHit ? home.abbr : awayHit ? away.abbr : edge || "EVEN", tone: homeHit ? "home" : awayHit ? "away" : "neutral" };
  });
  const baselineMargin = Number(matchup?.baseline?.margin);
  const finalMargin = Number(matchup?.final?.margin);
  const matchupAdj = Number(matchup?.adjustment?.margin);
  const isFinal = String(vm.status?.key || "").toUpperCase() === "FINAL" || Boolean(game?.status?.completed);
  const finalAway = game?.away?.score ?? away?.score ?? null;
  const finalHome = game?.home?.score ?? home?.score ?? null;
  const hasFinalScore = isFinal && finalAway != null && finalHome != null;
  const soccerPick = String(vm.sport || game?.sport || "").toLowerCase() === "soccer"
    ? (game?.soccerConfidence || game?.confidencePick || game?.soccerFbis?.confidencePick || null)
    : null;
  const soccerPickTeam = soccerPick?.side === "HOME" ? home : soccerPick?.side === "AWAY" ? away : null;

  return (
    <article
      className={"cgc pgc"+(stars===5?" cgc-five-star":"")}
      data-game-id={vm.id || game?.id || ""}
      data-sport={vm.sport || ""}
      tabIndex={0}
      role="button"
      onClick={() => onOpen?.(game)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(game);
        }
      }}
      aria-label={`Open ${away.abbr || "away"} at ${home.abbr || "home"} analysis`}
    >
      <header className="cgc-head">
        <div className="cgc-head-left">
          <span className="cgc-sport-pill">{String(vm.sport || "").toUpperCase()}</span>
          <span className="cgc-time">{vm.timing?.timeLine || "—"}</span>
        </div>
        <div className="cgc-head-right">
          <span className="cgc-star-rating" aria-label={`${stars} of 5 confidence stars`}><b>{stars}</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.28l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96L12 2.2z" /></svg></span>
          <span className={`cgc-status cgc-status-${String(vm.status?.tone || "neutral").toLowerCase()}`}>
            {vm.status?.label || "FBIS"}
          </span>
        </div>
      </header>

      {hasFinalScore ? (
        <section className="cgc-final-score" aria-label="Final score">
          <span>FINAL SCORE</span>
          <strong><b>{away.abbr}</b> {finalAway} <i>–</i> {finalHome} <b>{home.abbr}</b></strong>
          <small>vs FBIS {proj.available ? `${proj.away ?? "—"}–${proj.home ?? "—"}` : "projection"}</small>
        </section>
      ) : null}

      <div className="cgc-main">
        <div className="cgc-matchup">
          <div className="cgc-team-block">
            <TeamLogo team={away} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{away.abbr || "—"}</strong>
            <span className="cgc-team-name">{away.fullName || away.name || away.abbr || "—"}</span>
            <strong className="cgc-proj">{proj.available ? (proj.away ?? "—") : "—"}</strong>
            <span>FBIS SCORE</span>
          </div>

          <span className="cgc-vs">VS</span>

          <div className="cgc-team-block">
            <TeamLogo team={home} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{home.abbr || "—"}</strong>
            <span className="cgc-team-name">{home.fullName || home.name || home.abbr || "—"}</span>
            <strong className="cgc-proj">{proj.available ? (proj.home ?? "—") : "—"}</strong>
            <span>FBIS SCORE</span>
          </div>
        </div>

        <aside className={`cgc-best-edge${soccerPick ? " is-side" : edge.total ? " is-total" : " is-side"}`}>
          <span>{soccerPick ? "CONFIDENCE PICK" : "BEST EDGE"}</span>
          <div className="cgc-edge-identity">
            {soccerPick ? (
              soccerPickTeam ? <TeamLogo team={soccerPickTeam} size={42} className="cgc-edge-logo" /> : <div className="cgc-total-mark">DRAW</div>
            ) : edge.team ? (
              <TeamLogo team={edge.team} size={42} className="cgc-edge-logo" />
            ) : edge.total ? (
              <div className="cgc-total-mark">TOTAL</div>
            ) : null}
          </div>
          <strong>{soccerPick ? `${soccerPick.stars || stars}★` : edge.value}</strong>
          <b>{soccerPick ? soccerPick.pick || "—" : edge.detail}</b>
          <small>{soccerPick ? "1X2 · MODEL CONFIDENCE" : edge.type}</small>
        </aside>
      </div>

      <div className="cgc-market-strip" aria-label="FBIS and market comparison">
        <div className="cgc-market-item">
          <span>{marketSideLabel}</span>
          <strong>{market.spreadLabel || "—"}</strong>
        </div>
        <div className="cgc-market-divider" aria-hidden="true" />
        <div className="cgc-market-item cgc-market-item-fbis">
          <span>FBIS TOTAL</span>
          <strong>{proj.total ?? "—"}</strong>
        </div>
        <div className="cgc-market-divider" aria-hidden="true" />
        <div className="cgc-market-item">
          <span>MARKET TOTAL</span>
          <strong>{market.total ?? "—"}</strong>
        </div>
      </div>

      {showAction ? (
        <div className={`cgc-action-strip${action.available ? "" : " is-unavailable"}`} aria-label="ACTION market intelligence">
          <div className="cgc-action-brand">
            <span>ACTION</span>
            <strong>{action.headline?.label || (action.available ? "MARKET INTEL" : action.emptyLabel || "NO SNAPSHOT")}</strong>
          </div>
          <div className="cgc-action-item">
            <span>TICKETS</span>
            <strong>{actionSplitLabel(action.tickets, away, home)}</strong>
          </div>
          <div className="cgc-action-item">
            <span>MONEY</span>
            <strong>{actionSplitLabel(action.money, away, home)}</strong>
          </div>
          <div className="cgc-action-item cgc-action-move">
            <span>LINE MOVE</span>
            <strong>{actionMoveLabel(action, away, home)}</strong>
          </div>
        </div>
      ) : null}

      {isNfl && matchup?.ok ? (
        <section className="cgc-matchup-read" aria-label="FBIS individual game matchup analysis">
          <div className="cgc-matchup-read-head">
            <div><span>GAME MATCHUP</span><strong>{matchup?.adjustment?.evidenceQualified ? "QUALIFIED" : "READ"}</strong></div>
            <b>{matchup?.coverage ? `${matchup.coverage.available}/${matchup.coverage.total}` : "—"}</b>
          </div>
          <div className="cgc-matchup-pills">
            {matchupItems.filter((item) => item.text !== "—").map((item) => (
              <div className={`cgc-matchup-pill tone-${item.tone}`} key={item.id}>
                <span>{item.label}</span><strong>{item.text}</strong>
              </div>
            ))}
          </div>
          <div className="cgc-matchup-adjustment">
            <span>BASELINE <b>{Number.isFinite(baselineMargin) ? `${baselineMargin > 0 ? home.abbr : away.abbr} ${fmt(-Math.abs(baselineMargin))}` : "—"}</b></span>
            <i>→</i>
            <span>ADJ <b>{Number.isFinite(matchupAdj) ? `${matchupAdj > 0 ? "+" : ""}${fmt(matchupAdj)}` : "0"}</b></span>
            <i>→</i>
            <span>GAME READ <b>{Number.isFinite(finalMargin) ? `${finalMargin > 0 ? home.abbr : away.abbr} ${fmt(-Math.abs(finalMargin))}` : "—"}</b></span>
          </div>
        </section>
      ) : (
        <section className={`cgc-matchup-read${genericMatchupItems.length ? "" : " is-unavailable"}`} aria-label="FBIS matchup analysis">
          <div className="cgc-matchup-read-head">
            <div><span>GAME MATCHUP</span><strong>{genericMatchupItems.length ? "FBIS ANALYSIS" : "NO ANALYTICS YET"}</strong></div>
            <b>{genericMatchupItems.length ? `${genericMatchupItems.length} SIGNALS` : "—"}</b>
          </div>
          <div className="cgc-matchup-pills">
            {genericMatchupItems.length ? genericMatchupItems.map((item) => (
              <div className={`cgc-matchup-pill tone-${item.tone}`} key={item.id}>
                <span>{item.label}</span><strong>{item.text}</strong>
              </div>
            )) : <div className="cgc-matchup-pill tone-neutral"><span>STATUS</span><strong>AWAITING MATCHUP DATA</strong></div>}
          </div>
        </section>
      )}


      <footer className="cgc-footer">
        <div className="cgc-footer-metric">
          <strong>{vm?.projection?.modelId && vm?.projection?.modelVersion
            ? `${vm.projection.modelId} · ${vm.projection.modelVersion}`
            : vm?.projection?.modelId || game?.modelVersion || "FBIS"}</strong>
          <span>MODEL</span>
        </div>
        <div className="cgc-footer-metric">
          <strong>{vm.comparison?.sideDiffLabel || vm.comparison?.totalDiffLabel || "—"}</strong>
          <span>MODEL / MARKET GAP</span>
        </div>
        <span className="cgc-view">VIEW <b>→</b></span>
      </footer>
    </article>
  );
}
