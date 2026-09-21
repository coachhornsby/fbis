import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtPct, fmtSigned, formatMarketPeriod, formatClv } from "./lib/format.js";
import { TicketMatchup } from "./components/TeamLogo.jsx";
import useIsCompact from "./hooks/useIsCompact.js";
import { badgeLabel, valueOrUnavailable } from "./lib/healthState.js";
import PopulationDescriptor from "./components/PopulationDescriptor.jsx";

const RESULT_FILTERS = [
  ["all", "All results"],
  ["OPEN", "OPEN"],
  ["WON", "WON"],
  ["LOST", "LOST"],
  ["PUSH", "PUSH"],
  ["VOID", "VOID"],
];
const ATTR_FILTERS = [
  ["all", "All attribution"],
  ["OPERATOR_ONLY", "OPERATOR ONLY"],
  ["QUALIFIED", "QUALIFIED"],
  ["CONVICTION", "CONVICTION"],
  ["LEAN", "LEAN"],
  ["RECOMMENDED", "RECOMMENDED"],
  ["NO_FREEZE", "NO FREEZE"],
  ["UNMATCHED", "UNMATCHED"],
];

export default function MyBetsView({
  onImport,
  bets: external,
  summary: externalSummary,
  population: externalPopulation,
  sourceOk = true,
  sourceD1 = "unknown",
  sourceStatus = null,
  loading,
  error,
  onRefresh,
  state,
  attemptAt,
}) {
  const [pack, setPack] = useState({ bets: external || [], summary: externalSummary || null, population: externalPopulation || null });
  const [result, setResult] = useState("all");
  const [attr, setAttr] = useState("all");
  const [sport, setSport] = useState("all");
  const [manualScores, setManualScores] = useState({});
  const [manualSaving, setManualSaving] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const compact = useIsCompact(760);

  useEffect(() => {
    if (external) {
      setPack({ bets: external, summary: externalSummary, population: externalPopulation || null });
      return undefined;
    }
    const ac = new AbortController();
    fetch(`/api/bets?_t=${Date.now()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setPack({ bets: d.bets || [], summary: d.summary, population: d.population || null }))
      .catch(() => {});
    return () => ac.abort();
  }, [external, externalSummary, externalPopulation]);

  const bets = pack.bets || [];
  const shown = useMemo(() => {
    return bets.filter((b) => {
      if (sport !== "all" && b.sport !== sport) return false;
      if (result !== "all" && (b.result || "OPEN") !== result) return false;
      if (attr !== "all" && (b.recommendationStatus || "") !== attr) return false;
      return true;
    }).sort((a, b) => {
      const dateOrder = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateOrder) return dateOrder;
      const timeOrder = String(b.executedAt || b.importedAt || "").localeCompare(String(a.executedAt || a.importedAt || ""));
      if (timeOrder) return timeOrder;
      return String(a.externalTicketId || "").localeCompare(String(b.externalTicketId || ""));
    });
  }, [bets, sport, result, attr]);
  const summary = pack.summary || emptySummary();
  const unavailable = Boolean(state === "UNAVAILABLE" || error || sourceOk === false || String(sourceD1 || "").toLowerCase() === "error");
  const stat = (v, fallback = "—") => valueOrUnavailable(unavailable, v, fallback);

  const setScore = (id, field, value) => setManualScores((prev) => ({
    ...prev,
    [id]: { ...(prev[id] || {}), [field]: value },
  }));

  async function saveFinal(b) {
    const scores = manualScores[b.id] || {};
    if (String(b.market || "").toUpperCase() === "PLAYER_PROP") {
      const actual = scores.propActual;
      if (String(actual ?? "").trim() === "" || !Number.isFinite(Number(actual)) || Number(actual) < 0) {
        setManualMessage("Enter the player's non-negative actual statistic.");
        return;
      }
      setManualSaving(b.id);
      setManualMessage("");
      try {
        const res = await fetch("/api/bets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "grade-player-prop", id: b.id, actual: Number(actual) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
        setManualMessage(`Player prop graded ${body.result} from an actual value of ${body.actual}.`);
        setManualScores((prev) => { const next = { ...prev }; delete next[b.id]; return next; });
        if (onRefresh) await onRefresh();
        else {
          const fresh = await fetch(`/api/bets?_t=${Date.now()}`).then((r) => r.json());
          setPack({ bets: fresh.bets || [], summary: fresh.summary, population: fresh.population || null });
        }
      } catch (err) {
        setManualMessage(`Could not grade player prop: ${String(err?.message || err)}`);
      } finally {
        setManualSaving("");
      }
      return;
    }
    const required = [scores.away, scores.home];
    const isF5 = String(b.period || b.market || "").toUpperCase().includes("F5");
    if (required.some((v) => String(v ?? "").trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0)) {
      setManualMessage("Enter both non-negative final scores.");
      return;
    }
    if (isF5 && [scores.f5Away, scores.f5Home].some((v) => String(v ?? "").trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0)) {
      setManualMessage("F5 bets also require both first-five-inning scores.");
      return;
    }
    setManualSaving(b.id);
    setManualMessage("");
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "manual-final",
          sport: b.sport,
          date: b.date,
          gameId: b.gameId,
          start: b.start,
          homeName: b.homeTeam || b.homeIdentity?.name || "",
          awayName: b.awayTeam || b.awayIdentity?.name || "",
          homeAbbr: b.homeIdentity?.abbr || "",
          awayAbbr: b.awayIdentity?.abbr || "",
          homeScore: Number(scores.home),
          awayScore: Number(scores.away),
          ...(isF5 ? { f5HomeScore: Number(scores.f5Home), f5AwayScore: Number(scores.f5Away) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
      setManualMessage(`Final saved. ${body.betsGraded || 0} open bet${body.betsGraded === 1 ? "" : "s"} settled.`);
      setManualScores((prev) => {
        const next = { ...prev };
        delete next[b.id];
        return next;
      });
      if (onRefresh) await onRefresh();
      else {
        const fresh = await fetch(`/api/bets?_t=${Date.now()}`).then((r) => r.json());
        setPack({ bets: fresh.bets || [], summary: fresh.summary, population: fresh.population || null });
      }
    } catch (err) {
      setManualMessage(`Could not save final: ${String(err?.message || err)}`);
    } finally {
      setManualSaving("");
    }
  }

  return (
    <div className="main-content">
      {error && <div className="panel"><div className="error">{error}</div></div>}
      <section className="panel">
        <div className="panel-header">
          <h2>MY BETS · Unified execution ledger</h2>
          <span className="last-updated">{loading ? "Loading…" : `${badgeLabel(state || "DEGRADED")} · ${unavailable ? "Unavailable" : `${summary.bets || 0} imported`}`}</span>
        </div>
        <div className="panel-body">
          <p className="muted">
            Executed wagers are tracked across sportsbooks, exchanges, pick'em platforms, promotions, and reconciled historical records. Financial tracking is separate from calibration eligibility.
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Population: canonical D1 execution ledger. Calibration uses only records explicitly marked eligible with an immutable pregame model lock.
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            {attemptAt ? `Current attempt ${fmtTs(attemptAt)}. ` : ""}
            D1 binding: {sourceStatus?.binding || "unknown"} · read: {sourceStatus?.read || "unknown"} · write: {sourceStatus?.write || "unknown"}
          </p>
          <div className="today-controls" style={{ marginTop: 10 }}>
            <button className="header-btn header-btn-refresh" onClick={onImport}>IMPORT BET SLIP</button>
            {onRefresh && <button className="header-btn" onClick={onRefresh}>Reload</button>}
          </div>
          <div className="status-grid" style={{ marginTop: 12 }}>
            <Stat label="Bets" value={stat(summary.bets, 0)} />
            <Stat label="Open" value={stat(summary.open, 0)} />
            <Stat label="Settled" value={stat(summary.settled, 0)} />
            <Stat label="Record" value={stat(summary.record || "—")} />
            <Stat label="Push / Void" value={stat(`${summary.pushes ?? 0} / ${summary.voids ?? 0}`)} />
            <Stat label="Risk" value={stat(summary.risk == null ? "—" : `$${Number(summary.risk).toFixed(2)}`)} />
            <Stat label="Profit" value={stat(summary.profit == null ? "—" : fmtSigned(summary.profit, 2))} />
            <Stat label="ROI" value={stat(summary.roi == null ? "—" : fmtPct(summary.roi))} />
            <Stat label="CLV N" value={stat(summary.validClvN, 0)} />
            <Stat label="Avg CLV" value={stat(summary.avgClv == null ? "—" : fmtSigned(summary.avgClv, 3))} />
          </div>
          <p className="muted" style={{ marginTop: 8 }}>{unavailable ? "Bets data unavailable right now. Retry after data source recovers." : (summary.message || (summary.settled ? null : "No settled Heritage bets yet."))}</p>
          <PopulationDescriptor descriptor={pack.population || null} title="Bets population descriptor" />
          <div className="filter-row" style={{ marginTop: 10 }}>
            <button className={sport === "all" ? "chip active" : "chip"} onClick={() => setSport("all")}>All sports</button>
            {["mlb", "nfl", "cfb", "nba", "cbb"].map((id) => (
              <button key={id} className={sport === id ? "chip active" : "chip"} onClick={() => setSport(id)}>{id.toUpperCase()}</button>
            ))}
          </div>
          <div className="filter-row">
            {RESULT_FILTERS.map(([id, label]) => (
              <button key={id} className={result === id ? "chip active" : "chip"} onClick={() => setResult(id)}>{label}</button>
            ))}
          </div>
          {manualMessage ? <p className={manualMessage.startsWith("Could not") ? "error" : "muted"} style={{ marginTop: 10 }}>{manualMessage}</p> : null}
          <div className="filter-row">
            {ATTR_FILTERS.map(([id, label]) => (
              <button key={id} className={attr === id ? "chip active" : "chip"} onClick={() => setAttr(id)}>{label}</button>
            ))}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-body" style={{ padding: 0 }}>
          {!shown.length ? (
            <div className="empty">No imported bets in this filter.</div>
          ) : compact ? (
            <div className="mobile-card-list">
              {shown.map((b) => (
                <article key={b.id} className="mobile-card">
                  <div className="mobile-card-head">
                    <b>{b.externalTicketId}</b>
                    <span className={b.result === "WON" ? "text-green" : b.result === "LOST" ? "text-red" : "muted"}>{b.result || "OPEN"}</span>
                  </div>
                  <div className="muted">{b.date}</div>
                  <div style={{ marginTop: 6 }}>
                    <TicketMatchup
                      awayIdentity={b.awayIdentity}
                      homeIdentity={b.homeIdentity}
                      awayTeam={b.awayTeam}
                      homeTeam={b.homeTeam}
                      matchupText={b.matchupText}
                    />
                  </div>
                  <div className="mobile-kv-grid" style={{ marginTop: 8 }}>
                    <div><small>Book</small><b>{b.executionBook || "—"}</b></div>
                    <div><small>Market</small><b>{formatMarketPeriod(b.market, b.period)}</b></div>
                    <div><small>Side</small><b>{betSelectionLabel(b)}</b></div>
                    <div><small>Price</small><b>{fmtAmerican(b.executionPrice)}</b></div>
                    <div><small>Risk</small><b>${Number(b.riskAmount || 0).toFixed(2)}</b></div>
                    <div><small>P/L</small><b>{b.profit == null ? "—" : fmtSigned(b.profit, 2)}</b></div>
                    <div><small>CLV</small><b>{formatClv(b.clv, b.clvStatus)}</b></div>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    {b.attributionLabel || "OPERATOR BET · NOT ATTRIBUTED TO FBIS"} · {b.matchStatus}
                  </div>
                  {(b.result || "OPEN") === "OPEN" ? (
                    <ManualScoreEditor bet={b} scores={manualScores[b.id] || {}} setScore={setScore} saveFinal={saveFinal} saving={manualSaving === b.id} />
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="table-scroll">
            <table className="fbis-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Matchup</th>
                  <th>Book</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Risk</th>
                  <th>Result</th>
                  <th>P/L</th>
                  <th>Attribution</th>
                  <th>CLV</th>
                  <th>Enter final score</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className={b.result === "WON" ? "won-row" : b.result === "LOST" ? "lost-row" : ""}>
                    <td>
                      <div>{b.externalTicketId}</div>
                      <div className="muted">{b.date}</div>
                    </td>
                    <td>
                      <TicketMatchup
                        awayIdentity={b.awayIdentity}
                        homeIdentity={b.homeIdentity}
                        awayTeam={b.awayTeam}
                        homeTeam={b.homeTeam}
                        matchupText={b.matchupText}
                      />
                    </td>
                    <td className="nowrap">{b.executionBook || "—"}</td>
                    <td className="nowrap">{formatMarketPeriod(b.market, b.period)}</td>
                    <td>{betSelectionLabel(b)}</td>
                    <td>{fmtAmerican(b.executionPrice)}</td>
                    <td>${Number(b.riskAmount || 0).toFixed(2)}</td>
                    <td className={b.result === "WON" ? "text-green" : b.result === "LOST" ? "text-red" : "muted"}>{b.result || "OPEN"}</td>
                    <td>{b.profit == null ? "—" : fmtSigned(b.profit, 2)}</td>
                    <td>
                      <div>{b.attributionLabel || "OPERATOR BET · NOT ATTRIBUTED TO FBIS"}</div>
                      <div className="muted">{b.matchStatus}</div>
                    </td>
                    <td>
                      {formatClv(b.clv, b.clvStatus)}
                      {b.clvStatus && b.clvStatus !== "unavailable" ? <div className="muted">{b.clvStatus}</div> : null}
                      {b.trackerMetadata?.calibrationEligibility ? <div className="muted">{b.trackerMetadata.calibrationEligibility}</div> : null}
                    </td>
                    <td>
                      {(b.result || "OPEN") === "OPEN" ? (
                        <ManualScoreEditor bet={b} scores={manualScores[b.id] || {}} setScore={setScore} saveFinal={saveFinal} saving={manualSaving === b.id} />
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ManualScoreEditor({ bet, scores, setScore, saveFinal, saving }) {
  const away = bet.awayIdentity?.abbr || bet.awayTeam || "Away";
  const home = bet.homeIdentity?.abbr || bet.homeTeam || "Home";
  const isF5 = String(bet.period || bet.market || "").toUpperCase().includes("F5");
  const isPlayerProp = String(bet.market || "").toUpperCase() === "PLAYER_PROP";
  const input = (field, label) => (
    <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
      <span className="muted">{label}</span>
      <input
        aria-label={label}
        value={scores[field] || ""}
        onChange={(e) => setScore(bet.id, field, e.target.value)}
        inputMode="numeric"
        min="0"
        type="number"
        style={{ width: 72, background: "var(--navy)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 7px", fontSize: 12 }}
      />
    </label>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
      {isPlayerProp ? input("propActual", `${bet.playerName || bet.selectedTeam || "Player"} actual ${propStatLabel(bet)}`) : input("away", `${away} final`)}
      {isPlayerProp ? null : input("home", `${home} final`)}
      {!isPlayerProp && isF5 ? input("f5Away", `${away} F5`) : null}
      {!isPlayerProp && isF5 ? input("f5Home", `${home} F5`) : null}
      <button className="header-btn header-btn-refresh" onClick={() => saveFinal(bet)} disabled={saving} style={{ padding: "7px 9px", fontSize: 11 }}>
        {saving ? "Saving…" : isPlayerProp ? "Grade prop" : "Save final"}
      </button>
    </div>
  );
}

function propStatLabel(bet) {
  if (String(bet.propType || "").toUpperCase() === "PITCHER_STRIKEOUTS") return "strikeouts";
  return "stat";
}

function betSelectionLabel(bet) {
  const market = String(bet.market || "").toUpperCase();
  if (market === "PLAYER_PROP") {
    const player = bet.playerName || bet.selectedTeam || "Player";
    const side = String(bet.selectedSide || "").toUpperCase();
    const direction = side === "UNDER" ? "Under" : side === "OVER" ? "Over" : side || "—";
    const line = bet.executionLine != null ? ` ${bet.executionLine}` : "";
    return `${player} ${direction}${line} ${propStatLabel(bet)}`;
  }
  return `${bet.selectedTeam || bet.selectedSide || "—"}${bet.executionLine != null ? ` ${bet.executionLine}` : ""}`;
}

function emptySummary() {
  return { bets: 0, open: 0, settled: 0, record: null, risk: null, profit: null, roi: null, validClvN: 0, avgClv: null, message: "No imported Heritage bets yet." };
}

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function fmtTs(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
