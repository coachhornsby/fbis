import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { withRecommendations, fmtAmerican, fmtNum, fmtPct, fmtVig, edgeClass, kickoff, formatMarketPeriod, formatClv } from "./lib/format.js";
import TeamLogo, { TeamIdentity, TicketMatchup } from "./components/TeamLogo.jsx";
import { ChallengerSelect } from "./components/ChallengerSelect.jsx";
import { gradeOpenBets, loadState, logBet, summarize } from "./lib/learning.js";
import { captureSlate } from "./lib/ledger.js";
import TrackView from "./TrackView.jsx";
import TodayView, { GameDetails } from "./TodayView.jsx";
import HeritageImport from "./HeritageImport.jsx";
import MyBetsView from "./MyBetsView.jsx";
import { todayCT } from "../functions/lib/slateEngine.js";
import { buildPropConvictions } from "../functions/lib/propConviction.js";

function readUrlState() {
  if (typeof window === "undefined") return { tab: "today", date: todayCT(), sport: "mlb" };
  const u = new URL(window.location.href);
  return {
    tab: u.searchParams.get("tab") || "today",
    date: u.searchParams.get("date") || todayCT(),
    sport: u.searchParams.get("sport") || "mlb",
  };
}

function writeUrlState({ tab, date, sport }) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  u.searchParams.set("tab", tab);
  if (sport) u.searchParams.set("sport", sport);
  if (tab === "today" && date) u.searchParams.set("date", date);
  else u.searchParams.delete("date");
  window.history.replaceState({}, "", u);
}

async function responseJson(res, label) {
  const type = String(res.headers?.get?.("content-type") || "");
  const text = await res.text();
  if (!type.includes("application/json")) {
    throw new Error(`${label} feed unavailable (HTTP ${res.status}). Please retry in a moment.`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned an invalid response (HTTP ${res.status}).`);
  }
}

function datePlusDays(date, offset) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

async function fetchCfbWeek(signal) {
  const slates = [];
  for (let i = 0; i < 7; i += 1) {
    const res = await fetch(`/api/slate?sport=cfb&date=${datePlusDays(todayCT(), i)}&_t=${Date.now()}`, { signal });
    const body = await responseJson(res, "CFB");
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
    slates.push(body);
  }
  return slates;
}

function combineCfbWeek(slates) {
  const games = slates.flatMap((s) => s.games || []).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return {
    ...(slates[0] || { sport: "cfb", sportName: "College Football" }),
    date: slates.length ? `${slates[0].date} through ${slates.at(-1).date}` : todayCT(),
    weekBoard: true,
    generatedAt: new Date().toISOString(),
    games,
    ticker: slates.flatMap((s) => s.ticker || []),
    counts: {
      games: games.length,
      live: games.filter((g) => g.status?.live).length,
      final: games.filter((g) => g.status?.completed).length,
      upcoming: games.filter((g) => !g.status?.live && !g.status?.completed).length,
    },
  };
}

export default function App() {
  const initial = readUrlState();
  const [sport, setSport] = useState(initial.sport);
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [learn, setLearn] = useState(() => loadState());
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState(initial.tab);
  const [todayDate, setTodayDate] = useState(initial.date);
  const [todayBoard, setTodayBoard] = useState(null);
  const [todayError, setTodayError] = useState("");
  const [todayLoading, setTodayLoading] = useState(false);
  const [todaySport, setTodaySport] = useState("all");
  const [todayBucket, setTodayBucket] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [betsPack, setBetsPack] = useState({ bets: [], summary: null });
  const [track, setTrack] = useState(null);
  const [trackError, setTrackError] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackFilters, setTrackFilters] = useState({
    sport: "all",
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
      const [slateResult, trackRes] = await Promise.all([
        sport === "cfb" ? fetchCfbWeek(signal) : fetch(`/api/slate?sport=${sport}&_t=${Date.now()}`, { signal }),
        fetch(`/api/track?sport=${sport}&days=2&_t=${Date.now()}`, { signal }).catch(() => null),
      ]);
      const data = sport === "cfb" ? combineCfbWeek(slateResult) : await responseJson(slateResult, sport.toUpperCase());
      if (signal?.aborted) return;
      if (sport !== "cfb" && (!slateResult.ok || data.error)) throw new Error(data.error || `HTTP ${slateResult.status}`);
      let finals = [];
      if (trackRes?.ok) {
        const t = await responseJson(trackRes, "Tracking");
        finals = t.finals || [];
      }
      const nextLearn = gradeOpenBets(loadState(), [...(data.games || []), ...finals]);
      setLearn(nextLearn);
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
      const data = await responseJson(res, "Tracking");
      if (signal?.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setTrack(data);
      const nextLearn = data.finals?.length ? gradeOpenBets(loadState(), data.finals) : loadState();
      if (data.finals?.length) setLearn(nextLearn);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setTrackError(String(err.message || err));
    } finally {
      if (!signal?.aborted) setTrackLoading(false);
    }
  }, [trackFilters]);

  const refreshToday = useCallback(async (signal) => {
    setTodayLoading(true);
    setTodayError("");
    try {
      const res = await fetch(`/api/today?date=${todayDate}&_t=${Date.now()}`, { signal });
      const data = await responseJson(res, "Today");
      if (signal?.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setTodayBoard(data);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setTodayError(String(err.message || err));
    } finally {
      if (!signal?.aborted) setTodayLoading(false);
    }
  }, [todayDate]);

  const refreshBets = useCallback(async (signal) => {
    try {
      const res = await fetch(`/api/bets?_t=${Date.now()}`, { signal });
      const data = await responseJson(res, "Bets");
      if (signal?.aborted) return;
      setBetsPack({ bets: data.bets || [], summary: data.summary });
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    writeUrlState({ tab, date: todayDate, sport });
  }, [tab, todayDate, sport]);

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
    if (tab !== "today") return undefined;
    const ac = new AbortController();
    refreshToday(ac.signal);
    const id = setInterval(() => refreshToday(ac.signal), 60_000);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, [refreshToday, tab]);

  useEffect(() => {
    if (tab !== "bets" && tab !== "today" && tab !== "board") return undefined;
    const ac = new AbortController();
    refreshBets(ac.signal);
    return () => ac.abort();
  }, [tab, refreshBets]);

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
  const executedSportBets = useMemo(() => (betsPack.bets || []).filter((b) => b.sport === sport), [betsPack.bets, sport]);
  const executedStats = useMemo(() => summarizeExecutedRows(executedSportBets), [executedSportBets]);
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
          Fastwater Betting Intelligence System — {tab === "sys" ? "System" : tab === "today" ? "TODAY" : tab === "bets" ? "My Bets" : SPORTS[sport].name}
        </span>
        <nav className="nav-tabs">
          <button
            className={tab === "today" ? "active" : ""}
            onClick={() => setTab("today")}
          >
            TODAY
          </button>
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
          <button className={tab === "bets" ? "active" : ""} onClick={() => setTab("bets")}>
            BETS
          </button>
          <button className={tab === "sys" ? "active" : ""} onClick={() => setTab("sys")}>
            SYS
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="header-btn header-btn-refresh"
            onClick={() => (tab === "sys" ? refreshTrack() : tab === "today" ? refreshToday() : tab === "bets" ? refreshBets() : refresh())}
            disabled={tab === "sys" ? trackLoading : tab === "today" ? todayLoading : loading}
          >
            {tab === "sys" ? (trackLoading ? "↻ …" : "↻ Reload") : loading || todayLoading ? "↻ …" : "↻ Refresh"}
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
      ) : tab === "today" ? (
        <TodayView
          board={todayBoard}
          error={todayError}
          loading={todayLoading}
          date={todayDate}
          onDate={setTodayDate}
          sportFilter={todaySport}
          onSportFilter={setTodaySport}
          bucket={todayBucket}
          onBucket={setTodayBucket}
          onImport={() => setImportOpen(true)}
        />
      ) : tab === "bets" ? (
        <MyBetsView
          bets={betsPack.bets}
          summary={betsPack.summary}
          onImport={() => setImportOpen(true)}
          onRefresh={refreshBets}
        />
      ) : (
      <div className="main-content">
        {error && <div className="panel"><div className="error">{error}</div></div>}

        <Panel title="System Status" stamp={updated}>
          <div className="status-grid">
            <Stat label="Slate" value={slate?.counts?.games ?? "—"} />
            <Stat label="Live" value={slate?.counts?.live ?? "—"} />
            <Stat label="Open bets" value={executedStats.open} />
            <Stat label="Record" value={executedStats.record || "—"} />
            <Stat label="P/L" value={executedStats.profit == null ? "—" : `${executedStats.profit >= 0 ? "+" : ""}$${executedStats.profit.toFixed(2)}`} />
            <Stat label="Model" value={slate?.modelVersion || "FBIS-v1.3"} />
            <Stat label="Pin / Heritage" value={bookLabel(slate)} />
            <Stat label="Pal" value={palLabel(slate)} />
            <Stat label="Parlay" value={parlayLabel(slate)} />
          </div>
        </Panel>

        <Panel title="Today's Slate" stamp={updated}>
          <SlateTable games={slate?.games || []} onLog={onLog} logged={loggedOpen} />
        </Panel>

        <Panel title="My Heritage Bets" extra={<span className="last-updated">{executedSportBets.length} imported · D1 history</span>}>
          <div className="today-controls" style={{ marginBottom: 10 }}>
            <button className="header-btn header-btn-refresh" onClick={() => setImportOpen(true)}>IMPORT HERITAGE BET SLIP</button>
          </div>
          <ExecutedBetsTable bets={executedSportBets} />
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
              <p>
                Projection accuracy lives on SYS. Logged-rec win rate{" "}
                <b className={stats.winPct >= 0.52 ? "text-green" : "text-blue"}>{stats.winPct == null ? "—" : fmtPct(stats.winPct)}</b>
                {stats.settled ? ` on ${stats.settled} settled tickets.` : " — no settled strategy tickets yet."}
              </p>
            </Panel>
          </div>
          <div className="compact-stacked">
            <Panel title="CLV Tracker">
              <p>Positive CLV means Pinnacle close no-vig beat entry no-vig for the side you bet. Heritage Current Line is not Pin CLV. Model fair vs market is not CLV.</p>
              <div className="status-grid" style={{ marginTop: 10 }}>
                <Stat label="Avg CLV" value={stats.clv == null ? "—" : `${stats.clv >= 0 ? "+" : ""}${stats.clv.toFixed(2)}`} />
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
      <HeritageImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          refreshBets();
          if (tab === "today") refreshToday();
        }}
      />
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
            {g.awayLogo && <TeamLogo team={{ logo: g.awayLogo, name: g.awayName || g.away, abbr: g.away }} />}
            {g.away}
            <span className="score-accent">{g.awayScore ?? ""}</span>
            <span className="muted">@</span>
            <span className="score-accent">{g.homeScore ?? ""}</span>
            {g.home}
            {g.homeLogo && <TeamLogo team={{ logo: g.homeLogo, name: g.homeName || g.home, abbr: g.home }} />}
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
      <TeamIdentity team={t} />
    </div>
  );
}

function SlateTable({ games, onLog, logged }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((before) => {
    const next = new Set(before);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  if (!games.length) return <div className="empty">No games on the board for this date.</div>;
  const mlb = games.some((g) => g.sport === "mlb" || g.homeSp || g.bpp);
  const columns = 9 + (mlb ? 2 : 0);
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
          <Fragment key={g.id}>
          <tr>
            <td>
              <div className="team-block">
                <Team t={g.away} />
                <Team t={g.home} />
                {(mlb || g.sport === "cfb") ? <button className="game-expand" onClick={() => toggle(g.id)} aria-expanded={open.has(g.id)}>
                  {open.has(g.id) ? "Hide game details" : "View game details"}
                </button> : null}
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
              <SlateProj game={g} />
            </td>
            <td>
              <div>{g.marketLabels?.spreadHome?.label || g.odds.details || fmtAmerican(g.odds.homeMl)}</div>
              <div className="muted">{pinLine(g)}</div>
            </td>
            <td>
              <PinVigCell game={g} rec={g.rec} />
            </td>
            {mlb ? <td><F5Cell game={g} /></td> : null}
            <td><PublicCell game={g} /></td>
            <td>
              {g.cfb && !g.cfb.bettingAllowed ? (
                <span className="muted">—</span>
              ) : g.rec ? <span className={edgeClass(g.rec.edge)}>{g.rec.edge >= 0 ? "+" : ""}{fmtNum(g.rec.edge, 2)}</span> : <span className="edge-neutral">—</span>}
            </td>
            <td>{g.cfb && !g.cfb.bettingAllowed ? <span className="muted">{g.cfb.blockReason || "Blocked"}</span> : g.rec ? g.rec.pick : g.lean ? <span className="muted">{g.lean.pick} · lean</span> : <span className="muted">No edge</span>}</td>
            <td>
              <button className="log-btn" disabled={!g.rec || Boolean(g.cfb && !g.cfb.bettingAllowed) || logged.has(g.id) || g.status.completed} onClick={() => onLog(g)}>
                {logged.has(g.id) ? "LOGGED" : "LOG"}
              </button>
            </td>
          </tr>
          {open.has(g.id) ? <tr className="game-detail-row"><td colSpan={columns}><GameDetails g={slateDetailGame(g)} /></td></tr> : null}
          </Fragment>
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

function SlateProj({ game }) {
  if (game.sport === "nfl" || game.projectionKind === "PINNACLE_IMPLIED") {
    const a = game.marketProjAway ?? game.model?.marketProjAway;
    const h = game.marketProjHome ?? game.model?.marketProjHome;
    return (
      <>
        <div className="muted">FBIS projection unavailable</div>
        {a != null && <div className="proj-implied">PINNACLE IMPLIED {fmtNum(a)} – {fmtNum(h)}</div>}
      </>
    );
  }
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") {
    return (
      <>
        <div className="proj-blocked">PROJECTION BLOCKED</div>
        <div className="muted">Team-specific inputs missing</div>
      </>
    );
  }
  return (
    <>
      <div>{fmtNum(game.model.projAway)} – {fmtNum(game.model.projHome)}</div>
      <div className="muted">{game.model?.recipe?.engine || (game.bpp?.homeRuns != null ? "Pal" : game.savant?.source || "")}</div>
      {game.cfb?.projectionState && <div className="proj-state muted">{game.cfb.projectionState}</div>}
      {(game.sport === "cfb" || game.sport === "cbb") && (
        <ChallengerSelect game={game} championHome={game.model?.projHome} championAway={game.model?.projAway} />
      )}
    </>
  );
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
      <div>{pal?.awayRuns != null ? `Pal ${fmtNum(pal.awayRuns)}–${fmtNum(pal.homeRuns)}` : home != null ? `${fmtPct(home)} home` : "—"}</div>
      <div className="muted">{book?.awayMl != null && book?.homeMl != null ? `ML ${fmtAmerican(book.awayMl)} / ${fmtAmerican(book.homeMl)}` : "ML unpriced"}</div>
      <div className="muted">{book?.spread != null && book?.spreadHomePrice != null && book?.spreadAwayPrice != null ? `RL ${book.spread > 0 ? "+" : ""}${book.spread} · ${fmtAmerican(book.spreadAwayPrice)} / ${fmtAmerican(book.spreadHomePrice)}` : "RL unpriced"}</div>
      <div className="muted">{book?.total != null && book?.overPrice != null && book?.underPrice != null ? `Tot ${fmtNum(book.total)} · O ${fmtAmerican(book.overPrice)} / U ${fmtAmerican(book.underPrice)}` : tot != null ? `Pal Tot ${fmtNum(tot)}` : "Tot unpriced"}</div>
    </div>
  );
}

function ExecutedBetsTable({ bets }) {
  if (!bets.length) return <div className="empty">No imported Heritage bets for this sport.</div>;
  return (
    <table className="fbis-table">
      <thead><tr><th>Ticket</th><th>Matchup</th><th>Pick</th><th>Result</th><th>P/L</th><th>Price</th><th>CLV</th></tr></thead>
      <tbody>{bets.map((b) => (
        <tr key={b.id} className={b.result === "WON" ? "won-row" : b.result === "LOST" ? "lost-row" : ""}>
          <td>{b.externalTicketId}<div className="muted">{b.date}</div></td>
          <td>
            <TicketMatchup
              awayIdentity={b.awayIdentity}
              homeIdentity={b.homeIdentity}
              awayTeam={b.awayTeam}
              homeTeam={b.homeTeam}
              matchupText={b.matchupText}
            />
          </td>
          <td>{b.selectedTeam || b.selectedSide}{b.executionLine != null ? ` ${b.executionLine}` : ""} <span className="muted">{formatMarketPeriod(b.market, b.period)}</span></td>
          <td className={b.result === "WON" ? "text-green" : b.result === "LOST" ? "text-red" : "muted"}>{b.result || "OPEN"}</td>
          <td className={Number(b.profit) > 0 ? "text-green" : Number(b.profit) < 0 ? "text-red" : ""}>{b.profit == null ? "—" : `${Number(b.profit) >= 0 ? "+" : ""}$${Number(b.profit).toFixed(2)}`}</td>
          <td>{fmtAmerican(b.executionPrice)}</td>
          <td>{formatClv(b.clv, b.clvStatus)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function summarizeExecutedRows(rows) {
  const terminal = (rows || []).filter((b) => ["WON", "LOST", "PUSH", "VOID"].includes(b.result));
  const wins = terminal.filter((b) => b.result === "WON").length;
  const losses = terminal.filter((b) => b.result === "LOST").length;
  const profits = terminal.map((b) => Number(b.profit)).filter(Number.isFinite);
  return {
    open: (rows || []).filter((b) => !b.result || b.result === "OPEN").length,
    settled: terminal.length,
    record: wins + losses ? `${wins}-${losses}` : null,
    profit: profits.length ? profits.reduce((sum, n) => sum + n, 0) : null,
  };
}

function slateDetailGame(g) {
  const sportsbookProps = (g.odds?.playerProps || []).filter((p) => p?.line != null && p?.overPrice != null && p?.underPrice != null);
  const palProps = (g.bpp?.props || []);
  return {
    ...g,
    projAway: g.projAwayScore,
    projHome: g.projHomeScore,
    projTotal: g.projTotal ?? (g.projAwayScore != null && g.projHomeScore != null ? g.projAwayScore + g.projHomeScore : null),
    palAway: g.bpp?.awayRuns ?? null,
    palHome: g.bpp?.homeRuns ?? null,
    palF5Away: g.bpp?.f5?.awayRuns ?? null,
    palF5Home: g.bpp?.f5?.homeRuns ?? null,
    palF5HomeWin: g.bpp?.f5?.homeWin ?? null,
    pinMlAway: g.odds?.pinAwayMl ?? g.odds?.awayMl ?? null,
    pinMlHome: g.odds?.pinHomeMl ?? g.odds?.homeMl ?? null,
    f5Book: g.odds?.f5 || null,
    sportsbookProps,
    palProps: palProps.slice(0, 40),
    propConvictions: g.propConvictions || buildPropConvictions({ palProps, sportsbookProps, lineupsOfficial: Boolean(g.bpp?.lineupsOfficial), confirmedPitcherIds: [g.bpp?.homeSp?.id, g.bpp?.awaySp?.id] }),
    lineupsOfficial: Boolean(g.bpp?.lineupsOfficial),
    palPark: g.bpp?.park || null,
    weather: g.weather || null,
    venue: g.venue || "",
    sentiment: g.sentiment || g.odds?.sentiment || null,
    modelVersion: g.modelVersion,
    checkpoint: g.checkpoint || null,
    sport: g.sport,
    projectionState: g.cfb?.projectionState || g.projectionState || null,
    projectionRecipe: g.model?.recipe || null,
    pinSpread: g.odds?.pinSpread ?? g.odds?.spread ?? null,
    pinTotal: g.odds?.pinTotal ?? g.odds?.total ?? null,
    neutral: Boolean(g.neutralSite),
    cfbDetail: g.cfb ? {
      hfa: g.cfb.hfa, sigmaMargin: g.cfb.sigmaMargin, sigmaTotal: g.cfb.sigmaTotal, maturity: g.cfb.maturity,
      dataQuality: g.cfb.dataQuality, flags: g.cfb.flags || [], priorVersion: g.cfb.priorVersion,
      home: g.cfb.homeEst
        ? {
            rank: g.cfb.homeEst.rank,
            priorOff: g.cfb.homeEst.priorOff,
            priorDef: g.cfb.homeEst.priorDef,
            games: g.cfb.homeEst.n,
            currentOff: g.cfb.homeEst.currentOff,
            currentDef: g.cfb.homeEst.currentDef,
            off: g.cfb.homeEst.off,
            def: g.cfb.homeEst.def,
            usedFeatures: g.cfb.homeEst.featureVector?.used || [],
            qb: g.cfb.homeEst.featureVector?.qb || null,
          }
        : null,
      away: g.cfb.awayEst
        ? {
            rank: g.cfb.awayEst.rank,
            priorOff: g.cfb.awayEst.priorOff,
            priorDef: g.cfb.awayEst.priorDef,
            games: g.cfb.awayEst.n,
            currentOff: g.cfb.awayEst.currentOff,
            currentDef: g.cfb.awayEst.currentDef,
            off: g.cfb.awayEst.off,
            def: g.cfb.awayEst.def,
            usedFeatures: g.cfb.awayEst.featureVector?.used || [],
            qb: g.cfb.awayEst.featureVector?.qb || null,
          }
        : null,
    } : null,
    myBets: g.myBets || [],
  };
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
