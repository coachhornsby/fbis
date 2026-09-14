import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { withRecommendations, fmtAmerican, fmtNum, fmtPct, fmtVig, edgeClass, kickoff, formatMarketPeriod, formatClv } from "./lib/format.js";
import TeamLogo, { TeamIdentity, TicketMatchup } from "./components/TeamLogo.jsx";
import { ChallengerSelect } from "./components/ChallengerSelect.jsx";
import BoardGrid from "./components/board/BoardGrid.jsx";
import { mergeBoardQaFixtures, mergeTodayQaFixtures } from "./lib/boardFixtures.js";
import { gradeOpenBets, loadState, logBet, summarize } from "./lib/learning.js";
import { captureSlate } from "./lib/ledger.js";
import TrackView from "./TrackView.jsx";
import TodayView, { GameDetails } from "./TodayView.jsx";
import HeritageImport from "./HeritageImport.jsx";
import MyBetsView from "./MyBetsView.jsx";
import { todayCT } from "../functions/lib/slateEngine.js";
import { buildPropConvictions } from "../functions/lib/propConviction.js";
import { badgeLabel, badgeTone, deriveGlobalState, deriveViewState } from "./lib/healthState.js";
import AppShell, { FeaturePlaceholder } from "./app/AppShell.jsx";
import PublishView from "./features/publish/PublishView.jsx";
import { legacyToRoute, routeToLegacy } from "./app/navigation.js";
import PlayerPropsBoard from "./features/playerProps/PlayerPropsBoard.jsx";
import ModelLabView from "./features/modelLab/ModelLabView.jsx";
import DataHealthView from "./features/dataHealth/DataHealthView.jsx";
import MispricesView from "./features/misprices/MispricesView.jsx";
import "./features/playerProps/playerProps.css";
import "./features/today/today.css"; // DecisionChip / table tokens for props route without TodayView
import "./features/canonical/canonical.css";
import { resolveBoardProjection } from "./lib/boardDecision.js";

function readUrlState() {
  if (typeof window === "undefined") return { tab: "today", date: todayCT(), sport: "mlb", route: "today", sportFilter: "all" };
  const u = new URL(window.location.href);
  const tab = u.searchParams.get("tab") || "today";
  const sport = u.searchParams.get("sport") || "mlb";
  const routeParam = u.searchParams.get("route");
  const mapped = legacyToRoute({ tab, sport });
  return {
    tab,
    date: u.searchParams.get("date") || todayCT(),
    sport,
    route: routeParam || mapped.route,
    sportFilter: u.searchParams.get("sportFilter") || mapped.sportFilter || "all",
  };
}

function writeUrlState({ tab, date, sport, route, sportFilter }) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  u.searchParams.set("tab", tab);
  if (sport) u.searchParams.set("sport", sport);
  if (route) u.searchParams.set("route", route);
  if (sportFilter) u.searchParams.set("sportFilter", sportFilter);
  if (tab === "today" && date) u.searchParams.set("date", date);
  else u.searchParams.delete("date");
  // Preserve visual QA fixture flag across tab/sport navigation.
  if (u.searchParams.get("boardQa") !== "1") u.searchParams.delete("boardQa");
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

function fmtStamp(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function App() {
  const initial = readUrlState();
  const [sport, setSport] = useState(initial.sport);
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [learn, setLearn] = useState(() => loadState());
  const [loading, setLoading] = useState(false);
  const [boardLastSuccessAt, setBoardLastSuccessAt] = useState("");
  const [boardLastAttemptAt, setBoardLastAttemptAt] = useState("");
  const [boardStale, setBoardStale] = useState(false);

  const [tab, setTab] = useState(initial.tab);
  const [route, setRoute] = useState(initial.route || "today");
  const [sportFilter, setSportFilter] = useState(initial.sportFilter || "all");
  const [todayDate, setTodayDate] = useState(initial.date);
  const [todayBoard, setTodayBoard] = useState(null);
  const [todayError, setTodayError] = useState("");
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayLastSuccessAt, setTodayLastSuccessAt] = useState("");
  const [todayLastAttemptAt, setTodayLastAttemptAt] = useState("");
  const [todayStale, setTodayStale] = useState(false);
  const [todaySport, setTodaySport] = useState("all");
  const [todayBucket, setTodayBucket] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [betsPack, setBetsPack] = useState({ bets: [], summary: null, ok: true, d1: "unknown" });
  const [betsError, setBetsError] = useState("");
  const [betsLoading, setBetsLoading] = useState(false);
  const [betsLastAttemptAt, setBetsLastAttemptAt] = useState("");
  const [track, setTrack] = useState(null);
  const [trackError, setTrackError] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackLastSuccessAt, setTrackLastSuccessAt] = useState("");
  const [trackLastAttemptAt, setTrackLastAttemptAt] = useState("");
  const [trackStale, setTrackStale] = useState(false);
  const [pipelineState, setPipelineState] = useState("DEGRADED");
  const [trackFilters, setTrackFilters] = useState({
    sport: "all",
    days: "season",
    year: "2026",
    model: "ensemble",
    checkpoint: "LATEST",
    version: "all",
    type: "perGame",
    team: "",
    includeAnomalies: "0",
  });
  const [sysTab, setSysTab] = useState("overall");
  const [cfbWeekShift, setCfbWeekShift] = useState(0);
  const boardRequestId = useRef(0);
  const todayRequestId = useRef(0);
  const trackRequestId = useRef(0);

  const refresh = useCallback(async (signal) => {
    const requestId = ++boardRequestId.current;
    setLoading(true);
    setError("");
    setBoardLastAttemptAt(new Date().toISOString());
    try {
      const slateParams = new URLSearchParams({ sport, _t: String(Date.now()) });
      if (sport === "cfb") slateParams.set("weekShift", String(cfbWeekShift));
      const [res, trackRes] = await Promise.all([
        fetch(`/api/slate?${slateParams.toString()}`, { signal }),
        fetch(`/api/track?sport=${sport}&days=2&_t=${Date.now()}`, { signal }).catch(() => null),
      ]);
      const data = await responseJson(res, sport.toUpperCase());
      if (signal?.aborted || requestId !== boardRequestId.current) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      let finals = [];
      if (trackRes?.ok) {
        const t = await responseJson(trackRes, "Tracking");
        finals = t.finals || [];
      }
      const nextLearn = gradeOpenBets(loadState(), [...(data.games || []), ...finals]);
      setLearn(nextLearn);
      const withRecs = withRecommendations(data, nextLearn.weights);
      captureSlate(withRecs);
      if (requestId !== boardRequestId.current) return;
      setSlate(withRecs);
      setUpdated(new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago" }));
      setBoardLastSuccessAt(new Date().toISOString());
      setBoardStale(false);
    } catch (err) {
      if (err?.name === "AbortError" || requestId !== boardRequestId.current) return;
      setError(String(err.message || err));
      setBoardStale(Boolean(slate));
    } finally {
      if (!signal?.aborted && requestId === boardRequestId.current) setLoading(false);
    }
  }, [sport, cfbWeekShift]);

  useEffect(() => {
    if (sport !== "cfb" && cfbWeekShift !== 0) setCfbWeekShift(0);
  }, [sport, cfbWeekShift]);

  const refreshTrack = useCallback(async (signal) => {
    const requestId = ++trackRequestId.current;
    setTrackLoading(true);
    setTrackError("");
    setTrackLastAttemptAt(new Date().toISOString());
    try {
      const q = new URLSearchParams({
        sport: trackFilters.sport,
        days: trackFilters.days,
        checkpoint: trackFilters.checkpoint,
        version: trackFilters.version,
        model: trackFilters.model,
        type: trackFilters.type,
        includeAnomalies: trackFilters.includeAnomalies || "0",
        _t: String(Date.now()),
      });
      if (trackFilters.year) q.set("year", trackFilters.year);
      if (trackFilters.team) q.set("team", trackFilters.team);
      const res = await fetch(`/api/track?${q}`, { signal });
      const data = await responseJson(res, "Tracking");
      if (signal?.aborted || requestId !== trackRequestId.current) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data?.health?.state === "UNAVAILABLE") {
        throw new Error(`SYS unavailable: ${(data?.health?.failures || []).map((f) => `${f.name}=${f.detail || "failed"}`).join(" · ") || "authoritative data unavailable"}`);
      }
      setTrack(data);
      setTrackLastSuccessAt(new Date().toISOString());
      setTrackStale(false);
      const nextLearn = data.finals?.length ? gradeOpenBets(loadState(), data.finals) : loadState();
      if (data.finals?.length) setLearn(nextLearn);
    } catch (err) {
      if (err?.name === "AbortError" || requestId !== trackRequestId.current) return;
      setTrackError(String(err.message || err));
      setTrackStale(Boolean(track));
    } finally {
      if (!signal?.aborted && requestId === trackRequestId.current) setTrackLoading(false);
    }
  }, [trackFilters]);

  const refreshToday = useCallback(async (signal) => {
    const requestId = ++todayRequestId.current;
    setTodayLoading(true);
    setTodayError("");
    setTodayLastAttemptAt(new Date().toISOString());
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(new Error("timeout")), 20_000);
    if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
    try {
      const res = await fetch(`/api/today?date=${todayDate}&sport=${todaySport}&_t=${Date.now()}`, { signal: ac.signal });
      const data = await responseJson(res, "Today");
      if (signal?.aborted || ac.signal.aborted || requestId !== todayRequestId.current) return;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data?.health?.state === "UNAVAILABLE") {
        throw new Error(`TODAY unavailable: ${(data?.health?.failures || []).map((f) => `${f.name}=${f.detail || "failed"}`).join(" · ") || "authoritative data unavailable"}`);
      }
      setTodayBoard(mergeTodayQaFixtures(data));
      setTodayLastSuccessAt(new Date().toISOString());
      setTodayStale(false);
    } catch (err) {
      if (err?.name === "AbortError" || requestId !== todayRequestId.current) return;
      const msg = String(err.message || err);
      setTodayError(msg.includes("aborted") ? "Today feed timed out. Retry or continue with last known board." : msg);
      setTodayStale(Boolean(todayBoard));
      // Opt-in visual QA: still surface fixture props when the live feed is unavailable.
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("boardQa") === "1") {
        setTodayBoard(
          mergeTodayQaFixtures({
            date: todayDate,
            games: [],
            health: { state: "DEGRADED" },
          }),
        );
      }
    } finally {
      clearTimeout(timeout);
      if (!signal?.aborted && requestId === todayRequestId.current) setTodayLoading(false);
    }
  }, [todayDate, todaySport]);

  const refreshBets = useCallback(async (signal) => {
    setBetsLoading(true);
    setBetsError("");
    setBetsLastAttemptAt(new Date().toISOString());
    try {
      const res = await fetch(`/api/bets?_t=${Date.now()}`, { signal });
      const data = await responseJson(res, "Bets");
      if (signal?.aborted) return;
      if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.state === "UNAVAILABLE") {
        throw new Error(`Bets unavailable: ${(data?.d1Status?.failures || []).map((f) => `${f.name}=${f.detail || "failed"}`).join(" · ") || data?.d1 || "authoritative data unavailable"}`);
      }
      setBetsPack({
        bets: data.bets || [],
        summary: data.summary,
        population: data.population || null,
        ok: data.ok !== false,
        d1: data.d1 || "unknown",
        state: data.state || null,
        d1Status: data.d1Status || null,
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setBetsError(String(err?.message || err));
    } finally {
      if (!signal?.aborted) setBetsLoading(false);
    }
  }, []);

  useEffect(() => {
    writeUrlState({ tab, date: todayDate, sport, route, sportFilter });
  }, [tab, todayDate, sport, route, sportFilter]);

  const onRouteChange = useCallback((nextRoute) => {
    setRoute(nextRoute);
    const legacy = routeToLegacy(nextRoute, sportFilter);
    setTab(legacy.tab);
    if (legacy.tab === "board") setSport(legacy.sport);
    if (nextRoute === "today" && sportFilter && sportFilter !== "all") {
      setTodaySport(sportFilter);
    }
  }, [sportFilter]);

  const onSportFilterChange = useCallback((nextFilter) => {
    setSportFilter(nextFilter);
    setTodaySport(nextFilter);
    if (route === "markets" && nextFilter !== "all") {
      setSport(nextFilter);
      setTab("board");
    }
  }, [route]);

  useEffect(() => {
    const routeTitles = {
      today: "TODAY",
      markets: "MARKETS",
      "player-props": "PLAYER PROPS",
      bets: "MY BETS",
      performance: "PERFORMANCE",
      research: "RESEARCH",
      system: "SYSTEM",
    };
    const part =
      routeTitles[route] ||
      (tab === "board"
        ? String(SPORTS[sport]?.label || sport).toUpperCase()
        : tab === "today"
          ? "TODAY"
          : tab === "sys"
            ? "SYSTEM"
            : "MY BETS");
    document.title = `FBIS · ${part}`;
  }, [route, tab, sport]);

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
    if (tab !== "bets" && tab !== "today") return undefined;
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

  useEffect(() => {
    const ac = new AbortController();
    const refreshHealth = async () => {
      try {
        const res = await fetch(`/api/health?_t=${Date.now()}`, { signal: ac.signal });
        const data = await responseJson(res, "Health");
        if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
        setPipelineState(data.state || "DEGRADED");
      } catch {
        setPipelineState("DEGRADED");
      }
    };
    refreshHealth();
    const id = setInterval(refreshHealth, 60_000);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, []);

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
  const todayState = deriveViewState({
    apiState: todayBoard?.health?.state || null,
    error: todayError,
    stale: todayStale,
    hasData: Boolean(todayBoard),
  });
  const betsState = deriveViewState({
    apiState: betsPack?.state || null,
    error: betsError,
    stale: false,
    hasData: Array.isArray(betsPack?.bets),
  });
  const sysState = deriveViewState({
    apiState: track?.health?.state || null,
    error: trackError,
    stale: trackStale,
    hasData: Boolean(track),
  });
  const boardState = deriveViewState({
    apiState: null,
    error,
    stale: boardStale,
    hasData: Boolean(slate),
  });
  const globalState = deriveGlobalState({
    activeTab: tab,
    pipelineState,
    todayState,
    betsState,
    sysState,
    boardState,
  });
  const health = badgeTone(globalState);
  const healthLabel = badgeLabel(globalState);

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

  const shellFreshness =
    route === "markets" || tab === "board"
      ? boardStale
        ? "STALE"
        : slate
          ? "CURRENT"
          : loading
            ? "LOADING"
            : error
              ? "UNAVAILABLE"
              : "CURRENT"
      : todayStale
        ? "STALE"
        : todayBoard
          ? "CURRENT"
          : todayLoading
            ? "LOADING"
            : todayError
              ? "UNAVAILABLE"
              : "CURRENT";

  return (
    <>
      <AppShell
        route={route}
        sportFilter={sportFilter}
        freshnessLabel="MARKET DATA"
        freshnessState={shellFreshness}
        healthLabel={healthLabel}
        healthTone={health}
        onRouteChange={onRouteChange}
        onSportFilterChange={onSportFilterChange}
        onRefresh={() =>
          route === "system" || tab === "sys"
            ? refreshTrack()
            : route === "bets" || tab === "bets"
              ? refreshBets()
              : route === "markets" || tab === "board"
                ? refresh()
                : refreshToday()
        }
        refreshDisabled={
          route === "system" || tab === "sys"
            ? trackLoading
            : route === "markets" || tab === "board"
              ? loading
              : todayLoading || betsLoading
        }
        refreshLabel={
          route === "system" || tab === "sys"
            ? trackLoading
              ? "↻ …"
              : "↻ Reload"
            : loading || todayLoading || betsLoading
              ? "↻ …"
              : "↻ Refresh"
        }
      >
        {tab === "board" || route === "markets" ? (
          <Ticker items={slate?.ticker || []} logged={loggedOpen} />
        ) : null}

        {route === "player-props" ? (
          <PlayerPropsBoard
            board={todayBoard}
            sportFilter={sportFilter === "all" ? todaySport : sportFilter}
            date={todayDate}
            loading={todayLoading}
            error={todayError}
            onRetry={refreshToday}
          />
        ) : route === "performance" ? (
          <FeaturePlaceholder
            title="Performance"
            status="PHASE 7"
            body="Model vs qualified vs executed populations stay separate. This page will surface units, ROI, CLV, and drawdown without bankroll dollars."
          />
        ) : route === "publish" ? (
          <PublishView
            board={todayBoard}
            sportFilter={sportFilter}
            date={todayDate}
            loading={todayLoading}
            error={todayError}
          />
        ) : route === "research" ? (
          <div className="canonical-research-stack">
            <ModelLabView sportFilter={sportFilter} />
            <MispricesView sportFilter={sportFilter} />
            <DataHealthView />
          </div>
        ) : tab === "sys" || route === "system" ? (
          <>
            <DataHealthView />
            <TrackView
              report={track}
              error={trackError}
              loading={trackLoading}
              stale={trackStale}
              lastSuccessAt={trackLastSuccessAt}
              attemptAt={trackLastAttemptAt}
              state={sysState}
              filters={{ ...trackFilters, tab: sysTab }}
              onFilters={(patch) => {
                if (patch.tab) setSysTab(patch.tab);
                const rest = { ...patch };
                delete rest.tab;
                if (Object.keys(rest).length) setTrackFilters((prev) => ({ ...prev, ...rest }));
              }}
              onRefresh={refreshTrack}
            />
          </>
        ) : tab === "today" || route === "today" ? (
          <TodayView
            board={todayBoard}
            error={todayError}
            loading={todayLoading}
            stale={todayStale}
            lastSuccessAt={todayLastSuccessAt}
            attemptAt={todayLastAttemptAt}
            state={todayState}
            date={todayDate}
            onDate={setTodayDate}
            sportFilter={sportFilter === "all" ? todaySport : sportFilter}
            onSportFilter={(next) => {
              setTodaySport(next);
              setSportFilter(next);
            }}
            bucket={todayBucket}
            onBucket={setTodayBucket}
            onRetry={refreshToday}
            onImport={() => setImportOpen(true)}
          />
        ) : tab === "bets" || route === "bets" ? (
          <MyBetsView
            bets={betsPack.bets}
            summary={betsPack.summary}
            population={betsPack.population}
            sourceOk={betsPack.ok}
            sourceD1={betsPack.d1}
            sourceStatus={betsPack.d1Status}
            loading={betsLoading}
            error={betsError}
            attemptAt={betsLastAttemptAt}
            state={betsState}
            onImport={() => setImportOpen(true)}
            onRefresh={refreshBets}
          />
        ) : (
          <div className="main-content">
            {error && (
              <div className="panel">
                <div className="error">{error}</div>
              </div>
            )}

            <Panel
              title={`${String(SPORTS[sport]?.label || sport).toUpperCase()} Intelligence Board`}
              stamp={updated}
              extra={
                <span className="last-updated">
                  {slate?.counts?.games ?? 0} games
                  {slate?.counts?.live ? ` · ${slate.counts.live} live` : ""}
                </span>
              }
            >
              <BoardGrid
                sport={sport}
                games={mergeBoardQaFixtures(slate?.games || [])}
                onLog={onLog}
                logged={loggedOpen}
                detailMapper={slateDetailGame}
                slateMeta={
                  sport === "cfb"
                    ? `Week ${slate?.week?.number || "—"} · ${slate?.week?.range?.since || "—"} to ${slate?.week?.range?.until || "—"} CT`
                    : null
                }
                weekControls={
                  sport === "cfb" ? (
                    <div className="slate-toolbar slate-toolbar-inline">
                      <button type="button" className="header-btn" onClick={() => setCfbWeekShift((n) => n - 1)}>
                        Previous Week
                      </button>
                      <button type="button" className="header-btn" onClick={() => setCfbWeekShift(0)}>
                        Current Week
                      </button>
                      <button type="button" className="header-btn" onClick={() => setCfbWeekShift((n) => n + 1)}>
                        Next Week
                      </button>
                    </div>
                  ) : null
                }
                notice={
                  slate?.parlay?.pinGames === 0 &&
                  (slate?.parlay?.games > 0 ||
                    /soft|sharp|rundown|credit/i.test(String(slate?.parlay?.source || ""))) ? (
                    <div className="slate-notice">
                      Reference (Pinnacle) feed is credit-limited. Soft DK/FD two-ways are the provisional operational
                      consensus for lean/qualified tickets until a reference quote returns — shop carefully.
                    </div>
                  ) : null
                }
              />
            </Panel>

            <Panel title="Featured Plays" stamp={updated}>
              <div className="table-scroll">
                <RecTable games={recGames} onLog={onLog} logged={loggedOpen} />
              </div>
            </Panel>

            {leanGames.length > 0 || executedSportBets.length > 0 ? (
              <div className="compact-bottom">
                {leanGames.length ? (
                  <Panel title="Leans">
                    <div className="table-scroll">
                      <LeanTable games={leanGames} />
                    </div>
                  </Panel>
                ) : null}
                <Panel title="My Bets" extra={<span className="last-updated">{executedSportBets.length} imported</span>}>
                  <div className="today-controls" style={{ marginBottom: 10 }}>
                    <button className="header-btn header-btn-refresh" onClick={() => setImportOpen(true)}>
                      IMPORT BET SLIP
                    </button>
                  </div>
                  <div className="table-scroll">
                    <ExecutedBetsTable bets={executedSportBets} />
                  </div>
                </Panel>
              </div>
            ) : (
              <Panel title="My Bets" extra={<span className="last-updated">0 imported</span>}>
                <div className="today-controls" style={{ marginBottom: 10 }}>
                  <button className="header-btn header-btn-refresh" onClick={() => setImportOpen(true)}>
                    IMPORT BET SLIP
                  </button>
                </div>
                <div className="table-scroll">
                  <ExecutedBetsTable bets={executedSportBets} />
                </div>
              </Panel>
            )}

            <details className="board-ops panel">
              <summary className="panel-title">Board ops & diagnostics</summary>
              <div className="panel-body board-ops-body">
                <div>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Board attempt: {boardLastAttemptAt ? fmtStamp(boardLastAttemptAt) : "—"} · Last success:{" "}
                    {boardLastSuccessAt ? fmtStamp(boardLastSuccessAt) : "—"}
                    {boardStale ? " · Showing stale board snapshot." : ""}
                  </p>
                  <div className="status-grid">
                    <Stat label="Slate" value={slate?.counts?.games ?? "—"} />
                    <Stat label="Live" value={slate?.counts?.live ?? "—"} />
                    <Stat label="Open bets" value={executedStats.open} />
                    <Stat label="Record" value={executedStats.record || "—"} />
                    <Stat
                      label="P/L"
                      value={
                        executedStats.profit == null
                          ? "—"
                          : `${executedStats.profit >= 0 ? "+" : ""}$${executedStats.profit.toFixed(2)}`
                      }
                    />
                    <Stat label="Model" value={slate?.modelVersion || "FBIS-v1.4"} />
                    <Stat label="Market / Heritage" value={bookLabel(slate)} />
                    <Stat label="Pal" value={palLabel(slate)} />
                    <Stat label="Parlay" value={parlayLabel(slate)} />
                  </div>
                </div>
                <SportReadinessPanel sport={sport} slate={slate} />
                <LearningPanel learn={learn} />
                <div className="compact-stacked">
                  <PlCurve curve={stats.curve} />
                  <p>
                    Projection accuracy lives on SYS. Logged-rec win rate{" "}
                    <b className={stats.winPct >= 0.52 ? "text-green" : "text-blue"}>
                      {stats.winPct == null ? "—" : fmtPct(stats.winPct)}
                    </b>
                    {stats.settled ? ` on ${stats.settled} settled tickets.` : " — no settled strategy tickets yet."}
                  </p>
                  <div className="status-grid" style={{ marginTop: 10 }}>
                    <Stat
                      label="Avg CLV"
                      value={stats.clv == null ? "—" : `${stats.clv >= 0 ? "+" : ""}${stats.clv.toFixed(2)}`}
                    />
                  </div>
                  <Alerts error={error} recs={recGames.length} open={stats.open} />
                </div>
                <div className="glossary-grid">
                  {sharedGlossary().map((x) => (
                    <G key={x.title} title={x.title} body={x.body} />
                  ))}
                  {glossaryBySport(sport).map((x) => (
                    <G key={x.title} title={x.title} body={x.body} />
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </AppShell>

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

function sharedGlossary() {
  return [
    { title: "Loop", body: "Forecast independently, compare to no-vig benchmark, require edge and expected ROI, log, freeze, grade, and diagnose error." },
    { title: "Heritage", body: "Execution ledger only. Imported operator bets remain separate from model recommendations and separate from strategy simulation populations." },
    { title: "Reference market", body: "Pinnacle is an optional research/reference benchmark for fair/no-vig studies. It is not the operational market and not your executed Heritage price." },
    { title: "Qualification gates", body: "A projection is not a bet. Qualification requires complete market evidence and positive expected ROI thresholds." },
    { title: "CLV", body: "CLV is entry no-vig vs close no-vig for the same side and contract; independent of win/loss." },
  ];
}

function glossaryBySport(sport) {
  if (sport === "mlb") {
    return [
      { title: "Savant + Ballpark Pal", body: "MLB diagnostics include Savant run environment and Ballpark Pal matchup context. These are analytics sources, not execution venues." },
      { title: "Pitchers / Lineups / Park", body: "Starter context, lineup-official status, weather, and park factors are MLB-only readiness signals." },
      { title: "FG + F5 + Props coverage", body: "Full-game and F5 markets are tracked separately. Player-prop qualification requires contract + model alignment." },
    ];
  }
  if (sport === "cfb") {
    return [
      { title: "CFB weekly readiness", body: "Readiness tracks CFBD schedule/team IDs, power priors, EPA, returning production, QB continuity/transfer, coaching continuity, and market coverage." },
      { title: "Evidence completeness", body: "Games can be complete, partial, or blocked. Qualification only occurs when configured evidence contracts are met." },
      { title: "Blocked reasons", body: "A blocked game lists exact missing evidence (inputs, market pairs, or quality constraints)." },
    ];
  }
  if (sport === "nfl") {
    return [
      { title: "NFL model status", body: "If only market-implied diagnostics are available, the page must not imply independent FBIS projections." },
      { title: "Weekly operational inputs", body: "QB/starter status, injuries, travel/rest, weather, and market readiness are surfaced as diagnostics." },
    ];
  }
  if (sport === "nba" || sport === "cbb") {
    if (sport === "nba") {
      return [
        { title: "NBA readiness", body: "Schedule, injury availability, rest/back-to-back, projected lineup continuity, and market coverage are shown per slate." },
      ];
    }
    return [
      { title: "CBB readiness", body: "CBBD/Torvik/rating freshness, continuity signals, and market coverage determine whether diagnostics are complete, partial, or blocked." },
    ];
  }
  return [];
}

function SportReadinessPanel({ sport, slate }) {
  const rows = (slate?.games || []).filter((g) => g.sport === sport);
  const complete = rows.filter((g) => !g.projectionUnavailable && !g.marketUnresolved && !g.marketUnavailable).length;
  const partial = rows.filter((g) => !g.projectionUnavailable && (g.marketUnresolved || g.marketUnavailable)).length;
  const blocked = rows.filter((g) => Boolean(g.qualificationBlocked || (g.cfb && !g.cfb.bettingAllowed))).length;
  const qualified = rows.filter((g) => Boolean(g.rec)).length;
  const reasons = {};
  for (const g of rows) {
    const reason = g.blockReason || g.noPlayReason || (g.marketUnavailable ? "market unavailable" : null);
    if (!reason) continue;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return (
    <>
      <div className="status-grid">
        <Stat label="State" value={rows.length ? "DEGRADED" : "UNAVAILABLE"} />
        <Stat label="Last successful collection" value={slate?.generatedAt ? fmtStamp(slate.generatedAt) : "—"} />
        <Stat label="Games discovered" value={rows.length} />
        <Stat label="Evidence complete" value={complete} />
        <Stat label="Evidence partial" value={partial} />
        <Stat label="Blocked" value={blocked} />
        <Stat label="Qualified" value={qualified} />
      </div>
      <p className="muted" style={{ marginTop: 8 }}>Blocking reasons: {Object.keys(reasons).length ? Object.entries(reasons).map(([k, v]) => `${k} (${v})`).join(" · ") : "none reported"}.</p>
      {sport === "cfb" ? <p className="muted">CFB board scope: week {slate?.week?.number || "—"} ({slate?.week?.range?.since || "—"} to {slate?.week?.range?.until || "—"} CT).</p> : null}
    </>
  );
}

function Panel({ title, stamp, extra, children }) {
  const isBoard = /Slate|Intelligence Board|Bets|Featured|Leans|Qualified|leans/i.test(title);
  return (
    <section className={isBoard ? "panel panel-board" : "panel"}>
      <div className="panel-header">
        <h2>{title}</h2>
        {extra || (stamp ? <span className="last-updated">{stamp} CT</span> : null)}
      </div>
      <div className="panel-body" style={isBoard ? { padding: 0 } : undefined}>
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
            {g.awayLogo && <TeamLogo team={{ logo: g.awayLogo, name: g.awayName || g.away, abbr: g.away }} size={28} />}
            {g.away}
            <span className="score-accent">{g.awayScore ?? ""}</span>
            <span className="muted">@</span>
            <span className="score-accent">{g.homeScore ?? ""}</span>
            {g.home}
            {g.homeLogo && <TeamLogo team={{ logo: g.homeLogo, name: g.homeName || g.home, abbr: g.home }} size={28} />}
            <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>[{g.status}]</span>
          </div>
        )) : <span className="ticker-empty">NO LIVE GAMES</span>}
      </div>
    </div>
  );
}

function Team({ t, size = 52 }) {
  return <TeamIdentity team={t} size={size} />;
}

function OddsTile({ line, price, hot = false }) {
  if (line == null && price == null) {
    return (
      <div className="odds-tile">
        <span className="odds-empty">—</span>
      </div>
    );
  }
  return (
    <div className={`odds-tile${hot ? " odds-hot" : ""}`}>
      {line != null ? <span className="odds-line">{line}</span> : null}
      <span className="odds-price">{price == null ? "—" : fmtAmerican(price)}</span>
    </div>
  );
}

function fmtSpreadLine(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

function slateSpread(game) {
  return game.odds?.pinSpread ?? game.odds?.spread ?? null;
}

function slateTotal(game) {
  return game.odds?.pinTotal ?? game.odds?.total ?? null;
}

function slateMl(game, side) {
  if (side === "home") {
    return game.odds?.pinHomeMl ?? game.odds?.homeMl ?? null;
  }
  return game.odds?.pinAwayMl ?? game.odds?.awayMl ?? null;
}

function slateSpreadPrice(game, side) {
  if (side === "home") {
    return (
      game.odds?.pinSpreadHomePrice ??
      game.odds?.heritageSpreadHomePrice ??
      game.odds?.softSpreadHomePrice ??
      game.odds?.spreadPrice ??
      null
    );
  }
  return (
    game.odds?.pinSpreadAwayPrice ??
    game.odds?.heritageSpreadAwayPrice ??
    game.odds?.softSpreadAwayPrice ??
    null
  );
}

function slateTotalPrice(game, side) {
  if (side === "over") {
    return (
      game.odds?.pinOverPrice ??
      game.odds?.heritageOverPrice ??
      game.odds?.softOverPrice ??
      game.odds?.totalPrice ??
      null
    );
  }
  return (
    game.odds?.pinUnderPrice ??
    game.odds?.heritageUnderPrice ??
    game.odds?.softUnderPrice ??
    null
  );
}

function oddsBookLabel(game) {
  if (game.odds?.heritageListed) return "Heritage";
  if (game.odds?.softPresent || game.odds?.softSource) return "Consensus";
  if (game.odds?.pinPresent) return "Reference";
  if (game.odds?.heritageListed) return "Heritage";
  const soft = String(game.odds?.softSource || "").toLowerCase();
  if (soft.includes("sharp")) return "DK/FD";
  if (soft.includes("rundown") || soft.includes("therundown")) return "Soft";
  if (soft === "espn") return "ESPN";
  if (soft) return soft;
  if (game.odds?.homeMl != null || game.odds?.spread != null) return "Board";
  return null;
}

function playHot(game, market, side) {
  const ticket = game.rec || game.lean;
  if (!ticket) return false;
  if (String(ticket.market || "").toUpperCase() !== market) return false;
  return String(ticket.side || "").toUpperCase() === side;
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
  const columns = 7 + (mlb ? 1 : 0);
  return (
    <table className="fbis-table slate-board">
      <thead>
        <tr>
          <th className="kick-col">Time</th>
          <th className="matchup-col">Matchup</th>
          {mlb ? <th>SP</th> : null}
          <th className="odds-col">Spread</th>
          <th className="odds-col">Total</th>
          <th className="odds-col">Moneyline</th>
          <th>FBIS</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const spread = slateSpread(g);
          const total = slateTotal(g);
          const blocked = Boolean(g.cfb && !g.cfb.bettingAllowed);
          return (
          <Fragment key={g.id}>
          <tr>
            <td className="kick-col">
              <div>{g.status.live || g.status.completed ? g.status.detail : kickoff(g.start)}</div>
              {g.status.live && <span className="live-dot">● LIVE</span>}
              {g.weatherImpact?.applied && g.weather?.temperature != null ? (
                <div className="muted" style={{ fontSize: 10 }}>{g.weather.temperature}°F</div>
              ) : g.weather?.indoor ? (
                <div className="muted" style={{ fontSize: 10 }}>Indoor</div>
              ) : null}
            </td>
            <td>
              <div className="team-block team-block-lg">
                <Team t={g.away} size={52} />
                <Team t={g.home} size={52} />
                <button className="game-expand" onClick={() => toggle(g.id)} aria-expanded={open.has(g.id)}>
                  {open.has(g.id) ? "Hide details" : "Details"}
                </button>
              </div>
            </td>
            {mlb ? (
              <td className="sp-cell">
                <div>{g.awaySp?.last || g.awaySp?.name || "TBD"}</div>
                <div>{g.homeSp?.last || g.homeSp?.name || "TBD"}</div>
              </td>
            ) : null}
            <td className="odds-col">
              <div className="odds-stack">
                <OddsTile
                  line={fmtSpreadLine(spread == null ? null : -spread)}
                  price={slateSpreadPrice(g, "away")}
                  hot={!blocked && playHot(g, "SPREAD", "AWAY")}
                />
                <OddsTile
                  line={fmtSpreadLine(spread)}
                  price={slateSpreadPrice(g, "home")}
                  hot={!blocked && playHot(g, "SPREAD", "HOME")}
                />
                {oddsBookLabel(g) ? <div className="odds-book muted">{oddsBookLabel(g)}</div> : null}
              </div>
            </td>
            <td className="odds-col">
              <div className="odds-stack">
                <OddsTile
                  line={total == null ? null : `O ${total}`}
                  price={slateTotalPrice(g, "over")}
                  hot={!blocked && playHot(g, "TOTAL", "OVER")}
                />
                <OddsTile
                  line={total == null ? null : `U ${total}`}
                  price={slateTotalPrice(g, "under")}
                  hot={!blocked && playHot(g, "TOTAL", "UNDER")}
                />
              </div>
            </td>
            <td className="odds-col">
              <div className="odds-stack">
                <OddsTile price={slateMl(g, "away")} hot={!blocked && playHot(g, "ML", "AWAY")} />
                <OddsTile price={slateMl(g, "home")} hot={!blocked && playHot(g, "ML", "HOME")} />
              </div>
            </td>
            <td>
              <div className="slate-signal">
                <div className="proj-mini" title={(g.model?.recipe?.steps || []).join("\n")}>
                  <SlateProj game={g} />
                </div>
                {blocked ? (
                  <span className="muted">{g.cfb.blockReason || "Blocked"}</span>
                ) : g.rec ? (
                  <>
                    <span className={`tier-badge tier-${g.rec.tag}`}>{g.rec.tag}</span>
                    <b>{g.rec.pick}</b>
                    <span className={edgeClass(g.rec.edge)}>{g.rec.edge >= 0 ? "+" : ""}{fmtNum(g.rec.edge, 2)}</span>
                  </>
                ) : g.lean ? (
                  <>
                    <span className="tier-badge tier-LEAN">LEAN</span>
                    <span className="muted">{g.lean.pick}</span>
                  </>
                ) : (
                  <span className="muted">No edge</span>
                )}
              </div>
            </td>
            <td>
              <button className="log-btn" disabled={!g.rec || blocked || logged.has(g.id) || g.status.completed} onClick={() => onLog(g)}>
                {logged.has(g.id) ? "LOGGED" : "LOG"}
              </button>
            </td>
          </tr>
          {open.has(g.id) ? <tr className="game-detail-row"><td colSpan={columns}><GameDetails g={slateDetailGame(g)} /></td></tr> : null}
          </Fragment>
          );
        })}
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
          <th>Ref vig</th>
          <th>Fair</th>
          <th>Expected ROI</th>
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
              {g.lean.pauseReason || g.lean.reason || (g.lean.ev == null
                ? "No complete reference pair / expected ROI unavailable"
                : (g.lean.evPct ?? g.lean.ev * 100) < 3
                  ? `Expected ROI ${fmtNum((g.lean.evPct ?? g.lean.ev * 100), 1)}% below +3% gate`
                  : "Candidate did not clear every qualification gate")}
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
          <th>Expected ROI</th>
          <th>Reference</th>
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
  if (home == null && away == null) return g.odds?.pinPresent === false ? "Reference missing" : "Ref → Her";
  return `${fmtAmerican(away)} / ${fmtAmerican(home)}`;
}

function SlateProj({ game }) {
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") {
    return (
      <>
        <div className="proj-blocked">PROJECTION BLOCKED</div>
        <div className="muted">Team-specific inputs missing</div>
      </>
    );
  }
  const proj = resolveBoardProjection(game);
  if (!proj.available) {
    const a = proj.marketBenchmark?.away ?? game.marketProjAway ?? game.model?.marketProjAway;
    const h = proj.marketBenchmark?.home ?? game.marketProjHome ?? game.model?.marketProjHome;
    return (
      <>
        <div className="muted">FBIS projection unavailable</div>
        {a != null && <div className="proj-implied">REFERENCE MARKET-IMPLIED {fmtNum(a)} – {fmtNum(h)}</div>}
      </>
    );
  }
  return (
    <>
      <div>{fmtNum(proj.away)} – {fmtNum(proj.home)}</div>
      <div className="muted">
        {proj.headlineLabel ||
          game.model?.recipe?.engine ||
          (game.bpp?.homeRuns != null ? "Pal" : game.savant?.source || "")}
      </div>
      {game.cfb?.projectionState && <div className="proj-state muted">{game.cfb.projectionState}</div>}
      {(game.sport === "cfb" || game.sport === "cbb") && (
        <ChallengerSelect game={game} championHome={proj.home} championAway={proj.away} />
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
      <div className="muted">{nv != null ? `${fmtPct(nv)} nv` : "Ref hold"}</div>
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
  if (p.pinGames > 0 && p.heritageInFeed) return "Ref + Her";
  if (p.pinGames > 0) return "Ref → Her";
  const src = String(p.source || "");
  if (/sharpapi/i.test(src)) return "Soft DK/FD";
  if (/therundown|rundown/i.test(src)) return "Soft backup";
  if (/credit|exhausted/i.test(src)) return "Ref out · soft";
  return "Ref → Her";
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
  if (!bets.length) return <div className="empty">No imported bets for this sport.</div>;
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
