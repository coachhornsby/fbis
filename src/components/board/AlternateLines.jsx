import React, { useEffect, useState } from "react";
import { rankAlternateLines, selectCompetitiveAlternatives } from "../../lib/alternateLines.js";
import { fbisProjection } from "../../lib/boardDecision.js";
import "./alternateLines.css";

function labelSide(game, row) {
  if (row.marketFamily === "total") return row.side === "over" ? "OVER" : "UNDER";
  const team = game?.[row.side];
  return team?.abbr || team?.name || String(row.side || "").toUpperCase();
}
function fmtAmerican(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Math.round(Number(v));
  return n > 0 ? `+${n}` : String(n);
}
function fmtLine(row) {
  const line = Number(row.line);
  if (!Number.isFinite(line)) return "—";
  if (row.marketFamily === "total") return String(line);
  return `${line > 0 ? "+" : ""}${line}`;
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${(Number(v) * 100).toFixed(0)}%`;
}
function sourceLabel(source = "") {
  if (String(source).startsWith("Polymarket")) return "Polymarket";
  if (String(source) === "PinnOdds") return "PinnOdds";
  return String(source || "Market");
}

export default function AlternateLines({ game }) {
  const [state, setState] = useState({ loading: true, offers: [] });
  useEffect(() => {
    if (!["nfl", "cfb"].includes(game?.sport)) return undefined;
    const control = new AbortController();
    let stopped = false;
    const refresh = async () => {
      try {
        const r = await fetch(
          `/api/market-alternatives?sport=${encodeURIComponent(game.sport)}&eventId=${encodeURIComponent(game.id)}`,
          { signal: control.signal }
        );
        const x = await r.json();
        if (!stopped) {
          setState(r.ok && x.ok
            ? { loading: false, offers: x.offers || [] }
            : { loading: false, offers: [], error: true });
        }
      } catch {
        if (!stopped) setState({ loading: false, offers: [], error: true });
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      control.abort();
    };
  }, [game?.sport, game?.id]);

  if (!["nfl", "cfb"].includes(game?.sport)) return null;

  const ranked = rankAlternateLines(game, fbisProjection(game), state.offers);
  const top = selectCompetitiveAlternatives(ranked, { limit: 3 });

  return (
    <section className="alt-lines" aria-label="Competitive alternate lines">
      <header className="alt-lines-head">
        <div>
          <p className="alt-lines-kicker">RESEARCH ALTS · PINNODDS + POLYMARKET</p>
          <h3>Best competitive alternate lines</h3>
          <p>Next 3 priced lines near the main number that can still hit and keep a positive research return.</p>
        </div>
        <span className="alt-lines-badge">VERIFY</span>
      </header>

      {state.loading ? (
        <p className="alt-lines-empty">Loading competitive alternatives…</p>
      ) : state.error ? (
        <p className="alt-lines-empty">Alternative prices unavailable. Try refreshing.</p>
      ) : !top.length ? (
        <p className="alt-lines-empty">
          No competitive alternate (reasonable win chance + worth the price) is available right now.
        </p>
      ) : (
        <div className="alt-lines-grid">
          {top.map((row, i) => (
            <article
              className={`alt-line-card alt-line-${row.marketFamily} source-${sourceLabel(row.source).toLowerCase()}`}
              key={`${row.source}-${row.marketFamily}-${row.side}-${row.line}-${i}`}
            >
              <div className="alt-line-top">
                <span className="alt-line-rank">#{i + 1}</span>
                <span className="alt-line-source">{sourceLabel(row.source)}</span>
                <span className="alt-line-family">{row.marketFamily === "total" ? "TOTAL" : "SPREAD"}</span>
              </div>
              <div className="alt-line-main">
                <div className="alt-line-pick">
                  <span>{labelSide(game, row)}</span>
                  <strong>{fmtLine(row)}</strong>
                </div>
                <div className="alt-line-price">{fmtAmerican(row.american)}</div>
              </div>
              <div className="alt-line-metrics">
                <div>
                  <span>HIT CHANCE</span>
                  <b>{fmtPct(row.winProbability)}</b>
                </div>
                <div>
                  <span>EST. RETURN</span>
                  <b className={row.estimatedRoi > 0 ? "is-pos" : "is-neg"}>{fmtPct(row.estimatedRoi)}</b>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="alt-lines-note">
        Research only · fees included where known · not a wager authorization. Extreme longshots are filtered out.
      </p>
    </section>
  );
}
