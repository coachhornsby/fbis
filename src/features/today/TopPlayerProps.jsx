import { useEffect, useMemo, useState } from "react";
import PrizePicksStyleCard from "../playerProps/PrizePicksStyleCard.jsx";
import { prizePicksGroupKey, selectTopPrizePicksCards } from "./selectTopPrizePicksCards.js";
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
  const sport = String(sportFilter || "all").toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const date = chicagoDate();
    const q = new URLSearchParams({ date, mode: "sport", sport: sport === "all" ? "all" : sport });
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetch("/api/selective-props?" + q.toString(), { credentials: "same-origin" })
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
    () => selectTopPrizePicksCards(state.rows, { limit, sportFilter: sport }),
    [state.rows, limit, sport]
  );

  const titleSport = sport === "all" ? "ALL SPORTS" : sport.toUpperCase();

  return (
    <section className="panel today-section top-pp-board" aria-labelledby="today-top-props">
      <div className="panel-header">
        <div>
          <h2 id="today-top-props">Top PrizePicks cards</h2>
          <p className="top-pp-subtitle">
            Best {limit} Standard lines · {titleSport} · ranked by FBIS win chance · no Demon/Goblin
          </p>
        </div>
        <span className="last-updated">
          {state.loading ? "Loading…" : top.length ? `${top.length} shown` : "None"}
        </span>
      </div>
      <div className="panel-body">
        {state.error ? (
          <p className="today-empty error-text">PrizePicks cards unavailable: {state.error}</p>
        ) : null}
        {!state.loading && !state.error && !top.length ? (
          <p className="today-empty">
            No Standard PrizePicks lines with FBIS projections for {titleSport} yet.
          </p>
        ) : null}
        {top.length ? (
          <div className="top-pp-card-grid" aria-label="Top five PrizePicks research cards">
            {top.map((row, i) => (
              <PrizePicksStyleCard
                key={row.id || `${prizePicksGroupKey(row)}-${i}`}
                row={row}
                sport={row.sport}
                rank={i + 1}
                compact
              />
            ))}
          </div>
        ) : state.loading ? (
          <p className="today-empty">Loading Standard PrizePicks cards…</p>
        ) : null}
      </div>
    </section>
  );
}
