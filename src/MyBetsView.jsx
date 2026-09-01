import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtPct, fmtSigned, formatMarketPeriod, formatClv } from "./lib/format.js";
import { TicketMatchup } from "./components/TeamLogo.jsx";

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

export default function MyBetsView({ onImport, bets: external, summary: externalSummary, sourceOk = true, sourceD1 = "connected", loading, error, onRefresh }) {
  const [pack, setPack] = useState({ bets: external || [], summary: externalSummary || null });
  const [result, setResult] = useState("all");
  const [attr, setAttr] = useState("all");
  const [sport, setSport] = useState("all");

  useEffect(() => {
    if (external) {
      setPack({ bets: external, summary: externalSummary });
      return undefined;
    }
    const ac = new AbortController();
    fetch(`/api/bets?_t=${Date.now()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setPack({ bets: d.bets || [], summary: d.summary }))
      .catch(() => {});
    return () => ac.abort();
  }, [external, externalSummary]);

  const bets = pack.bets || [];
  const shown = useMemo(() => {
    return bets.filter((b) => {
      if (sport !== "all" && b.sport !== sport) return false;
      if (result !== "all" && (b.result || "OPEN") !== result) return false;
      if (attr !== "all" && (b.recommendationStatus || "") !== attr) return false;
      return true;
    });
  }, [bets, sport, result, attr]);
  const summary = pack.summary || emptySummary();
  const unavailable = Boolean(error || sourceOk === false || String(sourceD1 || "").toLowerCase() !== "connected");
  const stat = (v, fallback = "—") => (unavailable ? "Unavailable" : (v ?? fallback));

  return (
    <div className="main-content">
      {error && <div className="panel"><div className="error">{error}</div></div>}
      <section className="panel">
        <div className="panel-header">
          <h2>MY BETS · Heritage executed</h2>
          <span className="last-updated">{loading ? "Loading…" : unavailable ? "Unavailable" : `${summary.bets || 0} imported`}</span>
        </div>
        <div className="panel-body">
          <p className="muted">
            Imported Heritage slips are a separate dataset from forecasts, FBIS recommendations, qualified strategy tickets, and the unrecovered 7–0 CONVICTION cohort.
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Population: imported Heritage execution ledger only (not forecast accuracy and not strategy simulation results).
          </p>
          <div className="today-controls" style={{ marginTop: 10 }}>
            <button className="header-btn header-btn-refresh" onClick={onImport}>IMPORT HERITAGE BET SLIP</button>
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
            <div className="empty">No imported Heritage bets in this filter.</div>
          ) : (
            <div className="table-scroll">
            <table className="fbis-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Matchup</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Risk</th>
                  <th>Result</th>
                  <th>P/L</th>
                  <th>Attribution</th>
                  <th>CLV</th>
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
                    <td className="nowrap">{formatMarketPeriod(b.market, b.period)}</td>
                    <td>{b.selectedTeam || b.selectedSide || "—"}{b.executionLine != null ? ` ${b.executionLine}` : ""}</td>
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
