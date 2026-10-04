import { useEffect, useMemo, useState } from "react";

function num(v, digits = 1) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits).replace(/\.0$/, "");
}

function marketLabel(market) {
  const labels = {
    receiving_yards: "Rec Yards",
    passing_attempts: "Pass Attempts",
    completions: "Pass Completions",
  };
  return labels[market] || String(market || "").replaceAll("_", " ");
}

function statusClass(result) {
  const r = String(result || "OPEN").toUpperCase();
  if (r === "WON") return " won";
  if (r === "LOST") return " lost";
  if (r === "PUSH" || r === "ADJUSTED") return " push";
  return "";
}

export default function TrackedPropCards({ sportFilter = "all" }) {
  const [pack, setPack] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/player-prop-learning?_t=${Date.now()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
        return body;
      })
      .then((body) => {
        if (!cancelled) {
          setPack(body);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const cards = useMemo(() => {
    const filter = String(sportFilter || "all").toLowerCase();
    return (pack?.cards || []).filter((card) => filter === "all" || String(card.sport || "").toLowerCase() === filter);
  }, [pack, sportFilter]);

  if (!cards.length && !error) return null;

  return (
    <section className="tracked-props" aria-label="Tracked player prop cards">
      <div className="tracked-props-heading">
        <div>
          <span className="tracked-props-kicker">LIVE LEDGER</span>
          <h2>Tracked Prop Cards</h2>
        </div>
        {pack?.summary ? (
          <div className="tracked-props-score">
            <span>{pack.summary.gradedLegs || 0} graded</span>
            <strong>{pack.summary.hitRate == null ? "—" : `${Math.round(pack.summary.hitRate * 100)}%`} hit</strong>
          </div>
        ) : null}
      </div>
      {error ? <div className="error">Prop ledger: {error}</div> : null}
      <div className="tracked-props-grid">
        {cards.map((card) => (
          <article key={card.card_id} className={`tracked-prop-card${statusClass(card.result)}`}>
            <div className="tracked-prop-card-head">
              <div>
                <span className="tracked-prop-book">{card.book}</span>
                <strong>{card.entry_type}</strong>
              </div>
              <div className="tracked-prop-money">
                <span>${num(card.risk, 2)} risk</span>
                <strong>→ ${num(card.to_win, 2)}</strong>
              </div>
            </div>
            <div className="tracked-prop-id">{card.card_id} · {String(card.result || card.status || "OPEN").toUpperCase()}</div>
            <div className="tracked-prop-legs">
              {(card.legs || []).map((leg) => {
                const actual = leg.actual == null ? leg.live_actual : leg.actual;
                const actualLabel = leg.actual == null ? "live" : "final";
                return (
                  <div key={leg.leg_id} className={`tracked-prop-leg${statusClass(leg.result)}`}>
                    <div className="tracked-prop-leg-main">
                      <strong>{leg.player_name}</strong>
                      <span>{leg.team} · {leg.matchup}</span>
                    </div>
                    <div className="tracked-prop-pick">
                      <strong>{leg.side} {num(leg.entry_line)}</strong>
                      <span>{marketLabel(leg.market)}</span>
                    </div>
                    <div className="tracked-prop-model">
                      <span>FBIS {num(leg.fbis_projection)}</span>
                      <strong className={Number(leg.projection_edge || 0) >= 0 ? "up" : "down"}>
                        Δ {Number(leg.projection_edge || 0) >= 0 ? "+" : ""}{num(leg.projection_edge)}
                      </strong>
                    </div>
                    <div className="tracked-prop-actual">
                      <span>{actualLabel}</span>
                      <strong>{actual == null ? "—" : num(actual)}</strong>
                    </div>
                    {leg.actual != null ? (
                      <div className="tracked-prop-error">
                        <span>proj err</span>
                        <strong>{num(leg.projection_error)}</strong>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      {pack?.summary?.gradedLegs ? (
        <div className="tracked-props-learning">
          MAE {num(pack.summary.mae)} · Bias {num(pack.summary.bias)} · {pack.summary.wins || 0}/{pack.summary.decisions || 0} decisions
        </div>
      ) : (
        <div className="tracked-props-learning">Official results populate automatically after games go final. Projection errors remain blank until settlement.</div>
      )}
    </section>
  );
}
