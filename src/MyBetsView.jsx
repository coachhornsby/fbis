import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtPct, fmtSigned, formatMarketPeriod, formatClv } from "./lib/format.js";
import { TicketMatchup } from "./components/TeamLogo.jsx";
import { badgeLabel, valueOrUnavailable } from "./lib/healthState.js";
import PopulationDescriptor from "./components/PopulationDescriptor.jsx";
import "./myBets.css";
import { parseComboTicket } from "./lib/comboTicket.js";
import MyBetsIntelligence, {betFamily} from "./MyBetsIntelligence.jsx";
import projectionScorecard from "./data/fbisProjectionScorecard.js";

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
  const [ledgerFamily,setLedgerFamily]=useState("combined");
  const [book, setBook] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [query, setQuery] = useState("");
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [showLedger, setShowLedger] = useState(true);
  const [manualScores, setManualScores] = useState({});
  const [manualSaving, setManualSaving] = useState("");
  const [manualMessage, setManualMessage] = useState("");

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
      if (ledgerFamily !== "combined" && betFamily(b) !== ledgerFamily) return false;
      if (sport !== "all" && String(b.sport || "").toLowerCase() !== sport) return false;
      if (book !== "all" && String(b.executionBook || "").toLowerCase() !== book) return false;
      if (query.trim() && ![b.awayTeam,b.homeTeam,b.matchupText,b.selectedTeam,b.selectedSide,b.playerName,b.executionBook,b.externalTicketId,b.market,b.id].filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase())) return false;
      if (result !== "all" && (b.result || "OPEN") !== result) return false;
      if (attr !== "all" && (b.recommendationStatus || "") !== attr) return false;
      return true;
    }).sort((a, b) => {
      if (sortOrder === "profit") return Number(b.profit ?? -Infinity) - Number(a.profit ?? -Infinity) || String(b.date || "").localeCompare(String(a.date || ""));
      if (sortOrder === "loss") return Number(a.profit ?? Infinity) - Number(b.profit ?? Infinity) || String(b.date || "").localeCompare(String(a.date || ""));
      if (sortOrder === "risk") return Number(b.riskAmount || 0) - Number(a.riskAmount || 0) || String(b.date || "").localeCompare(String(a.date || ""));
      const direction = sortOrder === "oldest" ? -1 : 1;
      const dateOrder = direction * String(b.date || "").localeCompare(String(a.date || ""));
      if (dateOrder) return dateOrder;
      const timeOrder = direction * String(b.executedAt || b.importedAt || "").localeCompare(String(a.executedAt || a.importedAt || ""));
      if (timeOrder) return timeOrder;
      return String(a.externalTicketId || "").localeCompare(String(b.externalTicketId || ""));
    });
  }, [bets, sport, book, result, attr, query, ledgerFamily, sortOrder]);
  const filtersActive = ledgerFamily !== "combined" || sport !== "all" || book !== "all" || result !== "all" || attr !== "all" || Boolean(query.trim()) || sortOrder !== "newest";
  const resetHistoryFilters = () => { setLedgerFamily("combined"); setSport("all"); setBook("all"); setResult("all"); setAttr("all"); setQuery(""); setSortOrder("newest"); };
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
    <div className="main-content bets-dashboard">
      <MyBetsIntelligence bets={bets} unavailable={unavailable} projectionScorecard={projectionScorecard} onShowLedger={()=>setShowLedger(true)}/>
      {error && <div className="panel"><div className="error">{error}</div></div>}
      <section className="panel">
        <div className="panel-header">
          <h2>My Bets <span className="bets-title-sub">Execution & performance</span></h2>
          <span className="last-updated">{loading ? "Loading…" : `${badgeLabel(state || "DEGRADED")} · ${unavailable ? "Unavailable" : `${summary.bets || 0} imported`}`}</span>
        </div>
        <div className="panel-body">
          <details className="bets-source-details"><summary>Data source & calibration details</summary>
            <p>Executed wagers remain separate from model calibration eligibility. Calibration requires a verified, immutable pregame model lock.</p>
            <p>{attemptAt ? `Current attempt ${fmtTs(attemptAt)}. ` : ""}D1 binding: {sourceStatus?.binding || "unknown"} · read: {sourceStatus?.read || "unknown"} · write: {sourceStatus?.write || "unknown"}</p>
            <PopulationDescriptor descriptor={pack.population || null} title="Bets population descriptor" />
          </details>
          <div className="today-controls" style={{ marginTop: 10 }}>
            <button className="header-btn header-btn-refresh" onClick={onImport}>IMPORT BET SLIP</button>
            {onRefresh && <button className="header-btn" onClick={onRefresh}>Reload</button>}
          </div>
          <details className="bets-source-details"><summary>Legacy ledger counters and reconciliation totals</summary>
          <div className="status-grid bets-stat-grid" style={{ marginTop: 12 }}>
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
          </details>
          <p className="muted" style={{ marginTop: 8 }}>{unavailable ? "Bets data unavailable right now. Retry after data source recovers." : (summary.message || (summary.settled ? null : "No settled Heritage bets yet."))}</p>
          <div className="bets-filter-heading">
            <div><h3>Wager history</h3><span>{shown.length} of {bets.length} wagers · all categories included by default</span></div>
            <button type="button" className="bets-history-toggle" aria-controls="wager-history-table" aria-expanded={showLedger} onClick={() => setShowLedger((v) => !v)}>
              {showLedger ? "▾ Collapse wager table" : "▸ Expand wager table"} <span>({shown.length})</span>
            </button>
          </div>
          <div className="bets-history-toolbar" aria-label="Wager history filters">
            <label>Category
              <select value={ledgerFamily} onChange={(e) => setLedgerFamily(e.target.value)}>
                <option value="combined">All wagers</option>
                <option value="games">Game lines</option>
                <option value="props">Player props / combos</option>
              </select>
            </label>
            <label>Sport
              <select value={sport} onChange={(e) => setSport(e.target.value)}>
                <option value="all">All sports</option>
                {[...new Set(bets.map((b) => String(b.sport || "").toLowerCase()).filter(Boolean))].sort().map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
              </select>
            </label>
            <label>Sportsbook
              <select value={book} onChange={(e) => setBook(e.target.value)}>
                <option value="all">All books</option>
                {[...new Set(bets.map((b) => String(b.executionBook || "").trim()).filter(Boolean))].sort().map((name) => <option key={name} value={name.toLowerCase()}>{name}</option>)}
              </select>
            </label>
            <label>Result
              <select value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="all">All results</option>
                {["WON","LOST","OPEN","PUSH","VOID","MANUAL_REVIEW"].map((id) => <option key={id} value={id}>{id === "MANUAL_REVIEW" ? "Needs review" : id}</option>)}
              </select>
            </label>
            <label>Sort
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="profit">Highest profit</option>
                <option value="loss">Largest loss</option>
                <option value="risk">Largest stake</option>
              </select>
            </label>
            <label className="bets-search">Search wagers
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Team, player, ticket, book…" />
            </label>
            {filtersActive ? <button type="button" className="bets-clear-filters" onClick={resetHistoryFilters}>Reset filters · Show all</button> : null}
          </div>
          {manualMessage ? <p className={manualMessage.startsWith("Could not") ? "error" : "muted"} style={{ marginTop: 10 }}>{manualMessage}</p> : null}
          <button type="button" className="bets-advanced-toggle" aria-expanded={advancedFilters} onClick={()=>setAdvancedFilters(v=>!v)}>{advancedFilters?"Hide advanced filters":"Advanced filters"} · {result==="all"&&attr==="all"?"None applied":"Active"} ▾</button>
          {advancedFilters&&<div className="bets-advanced-panel">
          <div className="filter-row">
            {ATTR_FILTERS.map(([id, label]) => (
              <button key={id} className={attr === id ? "chip active" : "chip"} onClick={() => setAttr(id)}>{label}</button>
            ))}
          </div></div>}
        </div>
      </section>
      {showLedger && <section id="wager-history-table" className="panel bets-ledger-panel" aria-label="Full wager history">
        <div className="panel-body" style={{ padding: 0 }}>
          {!shown.length ? (
            <div className="empty">{bets.length ? "No wagers match the current filters. Select Reset filters · Show all." : loading ? "Loading wager history…" : unavailable ? "Wager data is unavailable. Try Reload." : "No wagers have been loaded from the ledger."}</div>
          ) : (
            <div className="table-scroll bets-table-scroll">
            <table className="fbis-table bets-ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sport</th>
                  <th>Matchup</th>
                  <th>Book</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Risk</th>
                  <th>Result</th>
                  <th>P/L</th>
                  <th>Final / Actual</th>
                  <th>Attribution</th>
                  <th>CLV</th>
                  <th>Enter final score</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => {
                  const combo = parseComboTicket(b);
                  return (
                  <tr key={b.id} className={b.result === "WON" ? "won-row" : b.result === "LOST" ? "lost-row" : ""}>
                    <td className="nowrap">{b.date || "—"}</td>
                    <td className="nowrap">{String(b.sport || "—").toUpperCase()}</td>
                    <td>
                      {combo && !(b.awayTeam && b.homeTeam) ? (
                        <ComboParticipants bet={b} combo={combo} />
                      ) : !combo && String(b.market || "").toUpperCase() === "PLAYER_PROP" ? (
                        <PlayerPropParticipants bet={b} compact />
                      ) : String(b.sport || "").toLowerCase() === "tennis" && !combo ? (
                        <TennisParticipants bet={b} compact />
                      ) : (
                        <TicketMatchup
                          awayIdentity={b.awayIdentity}
                          homeIdentity={b.homeIdentity}
                          awayTeam={b.awayTeam}
                          homeTeam={b.homeTeam}
                          matchupText={b.matchupText}
                          sport={b.sport}
                        />
                      )}
                    </td>
                    <td className="nowrap">{b.executionBook || "—"}</td>
                    <td className="nowrap">{formatMarketPeriod(b.market, b.period)}</td>
                    <td className={combo ? "bets-combo-cell" : undefined}>{combo ? <ComboSelection bet={b} combo={combo} /> : betSelectionLabel(b)}</td>
                    <td>{fmtAmerican(b.executionPrice)}</td>
                    <td className="nowrap">{b.riskAmount == null ? "—" : `${Number(b.riskAmount).toFixed(2)}`}</td>
                    <td className={b.result === "WON" ? "text-green" : b.result === "LOST" ? "text-red" : "muted"}>
                      {b.result || "OPEN"}
                    </td>
                    <td className="nowrap">{b.profit == null ? "—" : fmtSigned(b.profit, 2)}</td>
                    <td>{actualOutcome(b)}</td>
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
                );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </section>}
    </div>
  );
}


const PLAYER_IMAGE_CACHE = new Map();

function propPlayerNames(bet) {
  const raw = String(bet?.playerName || bet?.selectedTeam || bet?.selectedSide || "");
  return raw.split("/").map((part) => {
    const clean = part.trim();
    const match = clean.match(/^(.+?)\s+(?:(?:M|L|O|U|Over|Under)\s*)?-?\d+(?:\.\d+)?\b/i);
    return (match?.[1] || "").trim();
  }).filter(Boolean).slice(0, 8);
}

function PlayerHeadshot({ name, sport, size = 36 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name, sport]);
  const src = name
    ? `/api/player-image?mode=image&v=3&name=${encodeURIComponent(name)}&sport=${encodeURIComponent(sport || "")}`
    : null;
  return src && !failed ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{width:size,height:size,borderRadius:"50%",objectFit:"contain",objectPosition:"center center",background:"rgba(255,255,255,.08)",padding:2,boxSizing:"border-box"}}
    />
  ) : (
    <span className="team-logo-fallback team-logo-plate" style={{width:size,height:size,fontSize:Math.max(9,size*.28)}}>
      {String(name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
    </span>
  );
}


function TennisParticipants({ bet, compact = false }) {
  let a = String(bet?.awayTeam || "").trim();
  let b = String(bet?.homeTeam || "").trim();
  if ((!a || !b) && bet?.matchupText) {
    const parts = String(bet.matchupText).split(/\s+(?:@|vs\.?|v)\s+/i);
    if (parts.length === 2) {
      a = a || parts[0].trim();
      b = b || parts[1].trim();
    }
  }
  const names = [a,b].filter(Boolean);
  if (!names.length) return <div className="muted">{bet?.matchupText || "Tennis"}</div>;
  return (
    <div style={{display:"grid",gap:6}}>
      {names.map((name) => (
        <div key={name} style={{display:"flex",alignItems:"center",gap:9}}>
          <PlayerHeadshot name={name} sport="tennis" size={compact ? 32 : 44} />
          <span style={{fontWeight:700}}>{name}</span>
        </div>
      ))}
    </div>
  );
}

function PlayerPropParticipants({ bet, compact = false }) {
  const names = propPlayerNames(bet);
  if (!names.length) return <div className="muted">{bet.matchupText || "Player prop"}</div>;
  return (
    <div style={{display:"grid",gap:6}}>
      {names.map((name) => (
        <div key={name} style={{display:"flex",alignItems:"center",gap:9}}>
          <PlayerHeadshot name={name} sport={bet.sport} size={compact ? 32 : 44} />
          <span style={{fontWeight:700}}>{name}</span>
        </div>
      ))}
    </div>
  );
}


function ComboParticipants({ bet, combo }) {
  const names=[...new Set(combo.legs.map(leg=>leg.player).filter(Boolean))].slice(0,3);
  return (
    <div className="bets-combo-participants">
      <span className="bets-combo-participants-label">{String(bet.sport || "Sports").toUpperCase()} · MULTI-SELECTION</span>
      {names.length ? names.map(name=>(
        <div className="bets-combo-participant" key={name}>
          <PlayerHeadshot name={name} sport={bet.sport} size={38} />
          <strong>{name}</strong>
        </div>
      )) : <span className="bets-combo-participants-fallback">{bet.matchupText || combo.description}</span>}
    </div>
  );
}

function ComboSelection({ bet, combo }) {
  return (
    <div className="bets-combo-play" aria-label={combo.title+" selections"}>
      <div className="bets-combo-topline">
        <span className="bets-combo-title">{combo.title}</span>
        <span className="bets-combo-sport">{String(bet.sport || "SPORT").toUpperCase()}</span>
      </div>
      <div className="bets-combo-legs">
        {combo.legs.map((leg,i)=>(
          <div className="bets-combo-leg" key={i}>
            <span className="bets-combo-leg-num" aria-label={"Selection "+(i+1)}>{i+1}</span>
            {leg.player ? <PlayerHeadshot name={leg.player} sport={bet.sport} size={38} /> : null}
            <div className="bets-combo-leg-text">
              {leg.player ? <strong className="bets-combo-leg-player">{leg.player}</strong> : <strong className="bets-combo-leg-raw">{leg.text}</strong>}
              {leg.selection ? <span className="bets-combo-leg-stat">{leg.selection}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualScoreEditor({ bet, scores, setScore, saveFinal, saving }) {
  const away = bet.awayIdentity?.abbr || bet.awayTeam || "Away";
  const home = bet.homeIdentity?.abbr || bet.homeTeam || "Home";
  const isF5 = String(bet.period || bet.market || "").toUpperCase().includes("F5");
  const isPlayerProp = String(bet.market || "").toUpperCase() === "PLAYER_PROP";
  const input = (field, label) => (
    <label className="bets-score-entry" style={{ display: "grid", gap: 7 }}>
      <span className="muted">{label}</span>
      <input
        aria-label={label}
        value={scores[field] || ""}
        onChange={(e) => setScore(bet.id, field, e.target.value)}
        inputMode="numeric"
        min="0"
        type="number"
        style={{ width: 96 }}
      />
    </label>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
      {isPlayerProp ? input("propActual", `${bet.playerName || bet.selectedTeam || "Player"} actual ${propStatLabel(bet)}`) : input("away", `${away} final`)}
      {isPlayerProp ? null : input("home", `${home} final`)}
      {!isPlayerProp && isF5 ? input("f5Away", `${away} F5`) : null}
      {!isPlayerProp && isF5 ? input("f5Home", `${home} F5`) : null}
      <button className="header-btn header-btn-refresh" onClick={() => saveFinal(bet)} disabled={saving} style={{ padding: "11px 15px" }}>
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
  const base = String(bet.selectedTeam || bet.selectedSide || "—").trim();
  if (bet.executionLine == null) return base;
  const line = String(bet.executionLine);
  const signed = line.startsWith("-") || line.startsWith("+") ? line : `[+-]?${line}`;
  const normalizedBase = base.replace(/\s+/g, " ");
  if (new RegExp(`(?:^|\\s)${signed.replace(".", "\\.")}$`).test(normalizedBase)) return base;
  return `${base} ${line}`;
}

function actualOutcome(bet) {
  if (String(bet.market || "").toUpperCase() === "PLAYER_PROP" && bet.propActual != null) {
    return `${bet.propActual} ${propStatLabel(bet)}`;
  }
  if (bet.finalAwayScore != null && bet.finalHomeScore != null) {
    const away = bet.awayIdentity?.abbr || bet.awayTeam || "Away";
    const home = bet.homeIdentity?.abbr || bet.homeTeam || "Home";
    const final = `${away} ${bet.finalAwayScore} – ${home} ${bet.finalHomeScore}`;
    if (bet.f5AwayScore != null && bet.f5HomeScore != null) return `${final} · F5 ${bet.f5AwayScore}-${bet.f5HomeScore}`;
    return final;
  }
  return "—";
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
