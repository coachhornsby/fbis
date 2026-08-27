import { useCallback, useEffect, useMemo, useState } from "react";
import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { withRecommendations, fmtAmerican, fmtNum, fmtPct, fmtVig, edgeClass, kickoff } from "./lib/format.js";
import { gradeOpenBets, loadState, logBet, summarize } from "./lib/learning.js";
import { captureSlate } from "./lib/ledger.js";
import TrackView from "./TrackView.jsx";

export default function App() {
  const [sport, setSport] = useState("mlb");
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [learn, setLearn] = useState(() => loadState());
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState("board");
  const [track, setTrack] = useState(null);
  const [trackError, setTrackError] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackFilters, setTrackFilters] = useState({
    sport: "mlb",
    days: "season",
    year: "2026",
    model: "ensemble",
    checkpoint: "LATEST",
    version: "all",
    type: "perGame",
    team: "",
  });
  const [sysTab, setSysTab] = useState("overall");

  const refresh = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const [res, trackRes] = await Promise.all([
        fetch(`/api/slate?sport=${sport}&_t=${Date.now()}`, { signal }),
        fetch(`/api/track?sport=${sport}&days=2&_t=${Date.now()}`, { signal }).catch(() => null),
      ]);
      const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      let finals = [];
      if (trackRes?.ok) {
        const t = await trackRes.json();
        finals = t.finals || [];
      }
      const nextLearn = gradeOpenBets(loadState(), [...(data.games || []), ...finals]);
      setLearn(nextLearn);
      syncStrategyJournal(nextLearn.bets);
      const withRecs = withRecommendations(data, nextLearn.weights);
      captureSlate(withRecs);
      setSlate(withRecs);
      setUpdated(new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago" }));
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(String(err.message || err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [sport]);

  const refreshTrack = useCallback(async (signal) => {
    setTrackLoading(true);
    setTrackError("");
    try {
      const q = new URLSearchParams({
        sport: trackFilters.sport,
        days: trackFilters.days,
        checkpoint: trackFilters.checkpoint,
        version: trackFilters.version,
        model: trackFilters.model,
        type: trackFilters.type,
        _t: String(Date.now()),
      });
      if (trackFilters.year) q.set("year", trackFilters.year);
      if (trackFilters.team) q.set("team", trackFilters.team);
      const res = await fetch(`/api/track?${q}`, { signal });
      const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setTrack(data);
      const nextLearn = data.finals?.length ? gradeOpenBets(loadState(), data.finals) : loadState();
      if (data.finals?.length) setLearn(nextLearn);
      syncStrategyJournal(nextLearn.bets);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setTrackError(String(err.message || err));
    } finally {
      if (!signal?.aborted) setTrackLoading(false);
    }
  }, [trackFilters]);

  useEffect(() => {
    if (tab !== "board") return undefined;
    const ac = new AbortController();
    refresh(ac.signal);
    const id = setInterval(() => refresh(ac.signal), 45_000);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, [refresh, tab]);

  useEffect(() => {
    if (tab !== "sys") return undefined;
    const ac = new AbortController();
    refreshTrack(ac.signal);
    return () => ac.abort();
  }, [tab, refreshTrack]);

  const recGames = useMemo(
    () => (slate?.games || []).filter((g) => g.rec && !g.status.completed),
    [slate]
  );
  const leanGames = useMemo(
    () => (slate?.games || []).filter((g) => g.lean && !g.rec && !g.status.completed),
    [slate]
  );
  const stats = useMemo(() => summarize(learn, sport), [learn, sport]);
  const health =
    error ? "RED" : stats.units > 0 ? "GREEN" : stats.settled >= 8 && stats.winPct < 0.45 ? "YELLOW" : "GREEN";

  function onLog(game, ticket = game.rec) {
    if (!ticket?.qualified) return;
    const next = logBet(learn, {
      sport,
      gameId: game.id,
      market: ticket.market,
      side: ticket.side,
      pick: ticket.pick,
      line: ticket.line,
      fair: ticket.fair,
      implied: ticket.implied,
      edge: ticket.edge,
      ev: ticket.ev,
      pinVig: ticket.pinVig,
      pinPrice: ticket.pinPrice,
      fairAmerican: ticket.fairAmerican,
      tag: ticket.tag,
      matchup: `${game.away.abbr} @ ${game.home.abbr}`,
      executionBook: ticket.executionBook || "Heritage",
      executionPrice: ticket.executionPrice ?? null,
      benchmarkBook: ticket.benchmarkBook || "Pinnacle",
      entryNoVig: ticket.implied,
      entryAmerican: ticket.pinPrice,
      qualified: true,
      modelVersion: ticket.modelVersion || slate?.modelVersion,
      pHomeFinal: game.model?.pHomeFinal,
      layers: { ...(game.model?.layers || {}) },
      weights: { ...learn.weights },
      priceSource: ticket.priceSource,
    });
    setLearn(next);
  }

  const loggedOpen = new Set(
    learn.bets.filter((b) => b.sport === sport && b.result === "OPEN").map((b) => b.gameId)
  );

  return (
    <>
      <header className="app-header">
        <h1>FBIS</h1>
        <div className="header-divider" />
        <span className="subtitle">
          Fastwater Betting Intelligence System — {tab === "sys" ? "System" : SPORTS[sport].name}
        </span>
        <nav className="nav-tabs">
          {BOARD_SPORTS.map((id) => (
            <button
              key={id}
              className={tab === "board" && sport === id ? "active" : ""}
              onClick={() => {
                setSport(id);
                setTab("board");
              }}
            >
              {SPORTS[id].label}
            </button>
          ))}
          <button className={tab === "sys" ? "active" : ""} onClick={() => setTab("sys")}>
            SYS
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="header-btn header-btn-refresh"
            onClick={() => (tab === "sys" ? refreshTrack() : refresh())}
            disabled={tab === "sys" ? trackLoading : loading}
          >
            {tab === "sys" ? (trackLoading ? "↻ …" : "↻ Reload") : loading ? "↻ …" : "↻ Refresh"}
          </button>
        </div>
        <span className={`overall-badge badge-${health}`}>{error ? "FEED DOWN" : "LIVE"}</span>
      </header>

      <Ticker items={tab === "board" ? slate?.ticker || [] : []} logged={loggedOpen} />

      {tab === "sys" ? (
        <TrackView
          report={track}
          error={trackError}
          loading={trackLoading}
          filters={{ ...trackFilters, tab: sysTab }}
          onFilters={(patch) => {
            if (patch.tab) setSysTab(patch.tab);
            const rest = { ...patch };
            delete rest.tab;
            if (Object.keys(rest).length) setTrackFilters((prev) => ({ ...prev, ...rest }));
          }}
          onRefresh={refreshTrack}
        />
      ) : (
      <div className="main-content">
        {error && <div className="panel"><div className="error">{error}</div></div>}

        <Panel title="System Status" stamp={updated}>
          <div className="status-grid">
            <Stat label="Slate" value={slate?.counts?.games ?? "—"} />
            <Stat label="Live" value={slate?.counts?.live ?? "—"} />
            <Stat label="Open tickets" value={stats.open} />
            <Stat label="Record" value={stats.settled ? `${stats.wins}-${stats.losses}` : "—"} />
            <Stat label="Units" value={`${stats.units >= 0 ? "+" : ""}${stats.units.toFixed(2)}`} />
            <Stat label="Model" value={slate?.modelVersion || "FBIS-v1.3"} />
            <Stat label="Pin / Heritage" value={bookLabel(slate)} />
            <Stat label="Pal" value={palLabel(slate)} />
            <Stat label="Parlay" value={parlayLabel(slate)} />
          </div>
        </Panel>

        <Panel title="Today's Slate" stamp={updated}>
          <SlateTable games={slate?.games || []} onLog={onLog} logged={loggedOpen} />
        </Panel>

        <Panel title="My Bets" extra={<span className="last-updated">{stats.settled} graded · {fmtPct(stats.winPct)} wins</span>}>
          <BetsTable bets={learn.bets.filter((b) => b.sport === sport)} />
        </Panel>

        <Panel title="Qualified +EV" stamp={updated}>
          <RecTable games={recGames} onLog={onLog} logged={loggedOpen} />
        </Panel>

        <Panel title="Model leans">
          <LeanTable games={leanGames} />
        </Panel>

        <div className="compact-bottom">
          <Panel title="Model Diagnostics">
            <LearningPanel learn={learn} />
          </Panel>
          <div className="compact-stacked">
            <Panel title="Cumulative P/L">
              <PlCurve curve={stats.curve} />
            </Panel>
            <Panel title="Model Accuracy">
              <p>Win rate <b className={stats.winPct >= 0.52 ? "text-green" : "text-blue"}>{fmtPct(stats.winPct)}</b> on {stats.settled} settled tickets. Closing-line value avg <b className={stats.clv >= 0 ? "text-green" : "text-red"}>{stats.clv >= 0 ? "+" : ""}{stats.clv.toFixed(2)}</b>.</p>
            </Panel>
          </div>
          <div className="compact-stacked">
            <Panel title="CLV Tracker">
              <p>Positive CLV means entry no-vig beat the Pinnacle close for the side you bet. Model fair vs market is not CLV.</p>
              <div className="status-grid" style={{ marginTop: 10 }}>
                <Stat label="Avg CLV" value={stats.clv ? `${stats.clv >= 0 ? "+" : ""}${stats.clv.toFixed(2)}` : "—"} />
                <Stat label="Layer leader" value={topLayer(learn)} />
              </div>
            </Panel>
            <Panel title="Alerts">
              <Alerts error={error} recs={recGames.length} open={stats.open} />
            </Panel>
          </div>
        </div>

        <Panel title="FBIS System Glossary">
          <div className="glossary-grid">
            <G title="Loop" body="Forecast independently, price the no-vig Pinnacle market, compare, require +EV, log the ticket, freeze the projection, grade the final, diagnose error. Champion weights do not auto-rewrite from last night’s W/L." />
            <G title="Heritage" body="Your book. Every recommended ticket is a Heritage play. Parlay does not list Heritage today, so the Pinnacle number is the benchmark to shop — it is not recorded as a Heritage execution price unless Heritage is actually in the feed." />
            <G title="Pinnacle vig" body="Hold on the two-way Pinnacle market (multiplicative de-vig). FBIS never compares its probability to raw implied. Fair American is 1/p. EV is expectancy at the Pinnacle price." />
            <G title="Kalshi" body="Public sentiment only. Implied probability on the game, not a price you bet. Polymarket and Robinhood sit in the same bucket." />
            <G title="Ballpark Pal" body="Matchup data only: batter vs starting pitcher, park factors, simulated team/F5 runs. Pal is not a sportsbook and is never used as a betting price." />
            <G title="Score layer" body="MLB moneyline uses the Savant/Pal projected margin as its own probability layer (not W-L form). Form stays Pal matchup or record. The frozen Brier number is the blended FBIS probability, not form." />
            <G title="F5" body="First five innings is the starter-matchup market. Pal matchup/F5 run sims inform the lean. Book F5 prices are used only when a real line is posted. Baseball run line is 1.5 full game / 0.5 F5." />
            <G title="ParlayAPI" body="Odds cached 15 minutes so the 1,000 free credits last. Pinnacle game lines (eu) cost 3 credits. Kalshi is a separate 1-credit sentiment pull; empty Kalshi/F5 responses are cached 6 hours so missing markets do not drain the month." />
            <G title="Gates" body="A projection is not a bet. Qualified tickets need a complete two-way Pinnacle market, an actual price, sport-aware probability edge, and +3% EV. Missing EV fails the gate. Model leans are shown separately until they can be priced." />
            <G title="CLV" body="Closing-line value is entry no-vig Pinnacle probability vs closing (last pregame) no-vig Pinnacle probability for the side you bet. Positive means the market moved toward your side. Model fair vs market is a separate disagreement number, not CLV." />
          </div>
        </Panel>
      </div>
      )}
    </>
  );
}

function Panel({ title, stamp, extra, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {extra || (stamp ? <span className="last-updated">{stamp} CT</span> : null)}
      </div>
      <div className="panel-body" style={title.includes("Slate") || title.includes("Bets") || title.includes("Qualified") || title.includes("leans") ? { padding: 0 } : undefined}>
        {children}
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function Ticker({ items, logged }) {
  const loop = items.length ? [...items, ...items] : [];
  return (
    <div id="ticker-bar">
      <div id="ticker-track">
        {loop.length ? loop.map((g, i) => (
          <div className={`ticker-item${logged.has(g.id) ? " has-bet" : ""}`} key={`${g.id}-${i}`}>
            {g.live && <span className="live-dot">●</span>}
            {g.awayLogo && <img className="ticker-logo" src={g.awayLogo} alt="" />}
            {g.away}
            <span className="score-accent">{g.awayScore ?? ""}</span>
            <span className="muted">@</span>
            <span className="score-accent">{g.homeScore ?? ""}</span>
            {g.home}
            {g.homeLogo && <img className="ticker-logo" src={g.homeLogo} alt="" />}
            <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>[{g.status}]</span>
          </div>
        )) : <span className="ticker-empty">NO LIVE GAMES</span>}
      </div>
    </div>
  );
}

function Team({ t, align }) {
  return (
    <div className="team-line" style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
      {t.logo && <img className="team-logo" src={t.logo} alt="" />}
      {t.rank ? <span className="muted">#{t.rank}</span> : null}
      <span>{t.name}</span>
    </div>
  );
}

function SlateTable({ games, onLog, logged }) {
  if (!games.length) return <div className="empty">No games on the board for this date.</div>;
  const mlb = games.some((g) => g.sport === "mlb" || g.homeSp || g.bpp);
  return (
    <table className="fbis-table">
      <thead>
        <tr>
          <th>Matchup</th>
          <th>Kick</th>
          {mlb ? <th>SP</th> : null}
          <th>Proj</th>
          <th>{mlb ? "RL" : "Line"}</th>
          <th>Pin vig</th>
          {mlb ? <th>F5</th> : null}
          <th>Public</th>
          <th>Edge</th>
          <th>Play</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => (
          <tr key={g.id}>
            <td>
              <div className="team-block">
                <Team t={g.away} />
                <Team t={g.home} />
              </div>
            </td>
            <td>
              <div>{g.status.live || g.status.completed ? g.status.detail : kickoff(g.start)}</div>
              {g.status.live && <span className="live-dot">● LIVE</span>}
            </td>
            {mlb ? (
              <td className="sp-cell">
                <div>{g.awaySp?.last || g.awaySp?.name || "TBD"}</div>
                <div>{g.homeSp?.last || g.homeSp?.name || "TBD"}</div>
              </td>
            ) : null}
            <td className="text-blue" title={(g.model?.recipe?.steps || []).join("\n")}>
              <div>{fmtNum(g.model.projAway)} – {fmtNum(g.model.projHome)}</div>
              <div className="muted">{g.model?.recipe?.engine || (g.bpp?.homeRuns != null ? "Pal" : g.savant?.source || "")}</div>
            </td>
            <td>
              <div>{g.odds.details || fmtAmerican(g.odds.homeMl)}</div>
              <div className="muted">{pinLine(g)}</div>
            </td>
            <td>
              <PinVigCell game={g} rec={g.rec} />
            </td>
            {mlb ? <td><F5Cell game={g} /></td> : null}
            <td><PublicCell game={g} /></td>
            <td>
              {g.rec ? <span className={edgeClass(g.rec.edge)}>{g.rec.edge >= 0 ? "+" : ""}{fmtNum(g.rec.edge, 2)}</span> : <span className="edge-neutral">—</span>}
            </td>
            <td>{g.rec ? g.rec.pick : g.lean ? <span className="muted">{g.lean.pick} · lean</span> : <span className="muted">No edge</span>}</td>
            <td>
              <button className="log-btn" disabled={!g.rec || logged.has(g.id) || g.status.completed} onClick={() => onLog(g)}>
                {logged.has(g.id) ? "LOGGED" : "LOG"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecTable({ games, onLog, logged }) {
  if (!games.length) return <div className="empty">No tickets clear the gates on this slate.</div>;
  return (
    <table className="fbis-table">
      <thead>
        <tr>
          <th>Tier</th>
          <th>Pick</th>
          <th>Market</th>
          <th>Price</th>
          <th>Pin vig</th>
          <th>Fair</th>
          <th>EV</th>
          <th>Book</th>
          <th>Edge</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => (
          <tr key={g.id}>
            <td><span className={`tier-badge tier-${g.rec.tag}`}>{g.rec.tag}</span></td>
            <td>
              <div className="muted" style={{ fontSize: 10 }}>{g.away.abbr} @ {g.home.abbr}</div>
              <b>{g.rec.pick}</b>
            </td>
            <td>{g.rec.market}</td>
            <td className="text-blue">
              <div>{g.rec.market === "ML" || g.rec.market === "F5 ML" ? fmtAmerican(g.rec.pinPrice ?? g.rec.line) : g.rec.line}</div>
              <div className="muted">{g.rec.fairAmerican != null ? `fair ${fmtAmerican(g.rec.fairAmerican)}` : ""}</div>
            </td>
            <td>
              <div>{fmtVig(g.rec.pinVig)}</div>
              <div className="muted">{g.rec.implied != null ? `${fmtPct(g.rec.implied)} nv` : "—"}</div>
            </td>
            <td>{fmtPct(g.rec.fair)}</td>
            <td>
              <span className={edgeClass(g.rec.evPct ?? (g.rec.ev != null ? g.rec.ev * 100 : g.rec.edge))}>
                {g.rec.evPct != null || g.rec.ev != null
                  ? `${(g.rec.evPct ?? g.rec.ev * 100) >= 0 ? "+" : ""}${fmtNum(g.rec.evPct ?? g.rec.ev * 100, 1)}%`
                  : "—"}
              </span>
            </td>
            <td>
              <div>{g.rec.book || "Heritage"}</div>
              <div className="muted">{g.rec.priceSource || "shop Heritage"}</div>
            </td>
            <td><span className={edgeClass(g.rec.edge)}>+{fmtNum(g.rec.edge, 2)}</span></td>
            <td>
              <button className="log-btn" disabled={logged.has(g.id)} onClick={() => onLog(g, g.rec)}>
                {logged.has(g.id) ? "LOGGED" : "LOG"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeanTable({ games }) {
  if (!games.length) return <div className="empty">No unpriced or sub-threshold model leans on this slate.</div>;
  return (
    <table className="fbis-table">
      <thead>
        <tr>
          <th>Lean</th>
          <th>Pick</th>
          <th>Market</th>
          <th>Why not +EV</th>
          <th>Fair</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => (
          <tr key={g.id}>
            <td><span className="tier-badge tier-LEAN">LEAN</span></td>
            <td>
              <div className="muted" style={{ fontSize: 10 }}>{g.away.abbr} @ {g.home.abbr}</div>
              <b>{g.lean.pick}</b>
            </td>
            <td>{g.lean.market}</td>
            <td className="muted">
              {g.lean.ev == null ? "No complete Pinnacle pair / no EV" : `EV ${fmtNum((g.lean.evPct ?? g.lean.ev * 100), 1)}% below +3% gate`}
            </td>
            <td>{fmtPct(g.lean.fair)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BetsTable({ bets }) {
  if (!bets.length) return <div className="empty">Log a recommended ticket to start the learning loop.</div>;
  return (
    <table className="fbis-table">
      <thead>
        <tr>
          <th>Matchup</th>
          <th>Pick</th>
          <th>Result</th>
          <th>P/L</th>
          <th>EV</th>
          <th>Pin</th>
          <th>Heritage</th>
          <th>CLV</th>
        </tr>
      </thead>
      <tbody>
        {bets.map((b) => (
          <tr key={b.id + b.loggedAt} className={b.result === "WON" ? "won-row" : b.result === "LOST" ? "lost-row" : ""}>
            <td>{b.matchup}</td>
            <td>{b.pick} <span className="muted">{b.market}</span></td>
            <td className={b.result === "WON" ? "text-green" : b.result === "LOST" ? "text-red" : "muted"}>{b.result}</td>
            <td className={b.profit > 0 ? "text-green" : b.profit < 0 ? "text-red" : ""}>{b.profit ? `${b.profit > 0 ? "+" : ""}${b.profit.toFixed(2)}u` : "—"}</td>
            <td>{b.ev != null ? `${b.ev >= 0 ? "+" : ""}${(b.ev * 100).toFixed(1)}%` : "—"}</td>
            <td>{b.pinPrice != null ? fmtAmerican(b.pinPrice) : fmtVig(b.pinVig)}</td>
            <td className="muted">{b.executionPrice != null ? fmtAmerican(b.executionPrice) : "shop"}</td>
            <td>{b.clv == null ? "—" : `${b.clv > 0 ? "+" : ""}${b.clv.toFixed(2)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LearningPanel({ learn }) {
  const rows = [
    ["Market", learn.weights.market],
    ["ESPN", learn.weights.espn],
    ["Score", learn.weights.score],
    ["Form", learn.weights.form],
  ];
  return (
    <>
      {rows.map(([label, w]) => (
        <div className="weight-row" key={label}>
          <span style={{ width: 64 }}>{label}</span>
          <div className="weight-bar"><div className="weight-fill" style={{ width: `${(w || 0) * 100}%` }} /></div>
          <b>{((w || 0) * 100).toFixed(1)}%</b>
        </div>
      ))}
      <p className="muted" style={{ marginTop: 8 }}>
        Layer nearest-to-outcome counts are diagnostic, not calibration:
        market {learn.layerScores.market || 0} · espn {learn.layerScores.espn || 0} · score {learn.layerScores.score || 0} · form {learn.layerScores.form || 0}.
        Champion blend does not auto-shift. SYS grades Brier / log loss on the frozen FBIS probability.
      </p>
    </>
  );
}

function PlCurve({ curve }) {
  if (!curve.length) return <div className="empty">P/L appears after the first graded ticket.</div>;
  const ys = curve.map((p) => p.y);
  const min = Math.min(0, ...ys);
  const max = Math.max(0, ...ys);
  const span = max - min || 1;
  const w = 320;
  const h = 120;
  const pts = curve.map((p, i) => {
    const x = (i / Math.max(curve.length - 1, 1)) * (w - 8) + 4;
    const y = h - 8 - ((p.y - min) / span) * (h - 16);
    return `${x},${y}`;
  }).join(" ");
  const zeroY = h - 8 - ((0 - min) / span) * (h - 16);
  return (
    <svg className="pl-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="#1a3a5c" />
      <polyline fill="none" stroke="#60c4f8" strokeWidth="2" points={pts} />
    </svg>
  );
}

function Alerts({ error, recs, open }) {
  if (error) return <p className="text-red">Scoreboard feed failed. Retry refresh.</p>;
  if (recs) return <p className="text-green">{recs} qualifying ticket{recs === 1 ? "" : "s"} on the current slate.</p>;
  if (open) return <p>{open} open ticket{open === 1 ? "" : "s"} waiting on a final.</p>;
  return <p className="muted">Quiet. Gates are holding.</p>;
}

function pinLine(g) {
  const home = g.odds?.pinHomeMl ?? g.fairHomeMl;
  const away = g.odds?.pinAwayMl ?? g.fairAwayMl;
  if (home == null && away == null) return g.odds?.pinPresent === false ? "Pin missing" : "Pin → Her";
  return `${fmtAmerican(away)} / ${fmtAmerican(home)}`;
}

function PinVigCell({ game, rec }) {
  const vig = rec?.pinVig ?? game?.pin?.ml?.vig;
  const nv = rec?.implied ?? (rec?.side === "AWAY" ? game?.pin?.ml?.noVigB : game?.pin?.ml?.noVigA);
  if (vig == null && nv == null) return <span className="muted">—</span>;
  return (
    <div>
      <div className="text-blue">{fmtVig(vig)}</div>
      <div className="muted">{nv != null ? `${fmtPct(nv)} nv` : "Pin hold"}</div>
    </div>
  );
}

function palLabel(slate) {
  const p = slate?.pal;
  if (!p?.enabled) return "off";
  if (p.error) return "err";
  return p.cached ? `${p.games ?? "ok"} · cache` : String(p.games ?? "on");
}

function bookLabel(slate) {
  const p = slate?.parlay;
  if (!p?.enabled) return "—";
  if (p.heritageInFeed) return "Pin + Her";
  return "Pin → Her";
}

function F5Cell({ game }) {
  const pal = game.bpp?.f5;
  const book = game.odds?.f5;
  if (!pal && !book) return <span className="muted">—</span>;
  const home = pal?.homeWin;
  const tot = book?.total ?? pal?.total;
  return (
    <div className="f5-cell">
      <div>{home != null ? `${fmtPct(home)} home` : "—"}</div>
      <div className="muted">{tot != null ? `Tot ${fmtNum(tot)}` : book?.homeMl ? fmtAmerican(book.homeMl) : "Pal model"}</div>
    </div>
  );
}

function PublicCell({ game }) {
  const s = game.sentiment || game.odds?.sentiment;
  if (!s?.home) return <span className="muted">—</span>;
  const lean = s.home >= 0.5 ? "home" : "away";
  const pct = lean === "home" ? s.home : s.away;
  return (
    <div>
      <div>{fmtPct(pct)} {lean}</div>
      <div className="muted">Kalshi</div>
    </div>
  );
}

function parlayLabel(slate) {
  const p = slate?.parlay;
  if (!p?.enabled) return "off";
  if (p.error) return "err";
  if (p.remaining == null) return p.cached ? "cached" : "live";
  return `${p.remaining}${p.cached ? " · cache" : ""}`;
}

function syncStrategyJournal(bets) {
  if (!bets?.length) return;
  fetch("/api/strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bets }),
  }).catch(() => {});
}

function G({ title, body }) {
  return (
    <article className="g-card">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function topLayer(learn) {
  const entries = Object.entries(learn.layerScores || {});
  if (!entries.length) return "—";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] ? entries[0][0] : "—";
}
