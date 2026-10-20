import { useEffect, useMemo, useState } from "react";
import { ExchangePlayerPropCard } from "../playerProps/PrizePicksMarketPanel.jsx";

import "../playerProps/playerProps.css";
import "./topPlayerProps.css";

function chicagoDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default function TopPlayerProps({
  sportFilter = "all",
  limit = 5,
  /** Legacy domain rows kept for caller compatibility. */
  rows: _legacyRows = [],
}) {
  const [state, setState] = useState({ loading: true, rows: [], error: "" });
  const [expanded,setExpanded]=useState(null);
  const sport = String(sportFilter || "all").toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const date = chicagoDate();
    const q = new URLSearchParams({ date, mode: "sport", sport: sport === "all" ? "all" : sport });
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetch("/api/exchange-player-props?" + q.toString(), { credentials: "same-origin" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) throw new Error(body?.error || ("HTTP " + res.status));
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setState({
          loading: false,
          rows: Array.isArray(body.rows) ? body.rows : [],
          error: "",
          freshness: body.freshness || null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, rows: [], error: String(err?.message || err) });
      });
    return () => { cancelled = true; };
  }, [sport]);

  const top = useMemo(
    () => state.rows.filter(r=>sport==="all"||r.sport===sport).slice(0,limit),
    [state.rows, limit, sport]
  );

  const titleSport = sport === "all" ? "ALL SPORTS" : sport.toUpperCase();

  return (
    <section className="panel today-section top-pp-board" aria-labelledby="today-top-props">
      <div className="panel-header">
        <div>
          <h2 id="today-top-props">Exchange player props</h2>
          <p className="top-pp-subtitle">
            {titleSport} · Kalshi and Polymarket · projection research, not trade authorization
          </p>
        </div>
        <span className="last-updated">
          {state.loading ? "Loading…" : top.length ? `${top.length} shown` : "None"}
        </span>
      </div>
      <div className="panel-body">
        {state.error ? (
          <p className="today-empty error-text">Exchange props unavailable: {state.error}</p>
        ) : null}
        {!state.loading && !state.error && !top.length ? (
          <p className="today-empty">
            No verified exchange contracts with matching FBIS projections for {titleSport} yet.
          </p>
        ) : null}
        {top.length ? (
          <div className="pp-card-grid pp-premium-grid top-pp-card-grid" aria-label="Exchange player-prop research cards">
            {top.map((row, i) => (
              <ExchangePlayerPropCard key={[row.venue,row.sourceMarketId,row.contractSide].join("|")} group={{primary:row,variants:[row]}} expanded={expanded===i} onToggleExpand={()=>setExpanded(expanded===i?null:i)} />
            ))}
          </div>
        ) : state.loading ? (
          <p className="today-empty">Loading exchange player props…</p>
        ) : null}
      </div>
    </section>
  );
}
