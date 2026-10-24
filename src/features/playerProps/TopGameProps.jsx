import { useEffect, useState } from "react";
import { topThreeGamePlayerProps } from "./topGamePlayerProps.js";
import { joinIndependentPropModels } from "../../../functions/lib/propResearchData.js";
import FBISPlayerPropCard from "./FBISPlayerPropCard.jsx";
import "./topGameProps.css";

const fmt = (v, decimals = 1) => v == null || v === "" || !Number.isFinite(Number(v))
  ? "—" : Number(v).toFixed(decimals).replace(/\.0$/, "");
const fmtPrice = (v) => v == null || v === "" || !Number.isFinite(Number(v))
  ? "—" : Number(v) > 0 ? "+".concat(Math.round(Number(v))) : String(Math.round(Number(v)));

function isPrizePicksRow(row = {}) {
  const book = String(row.book || row.source || "").toLowerCase();
  return book.includes("prizepicks") || book === "prizepicks_apify";
}

/** All FBIS sports use the same premium prop card as Player Props / Board. */
const STYLE_CARD_SPORTS = new Set([
  "nfl", "mlb", "nba", "nhl", "cfb", "cbb", "wnba", "soccer", "npb", "kbo", "tennis",
]);

export default function TopGameProps({ game }) {
  const durable = Boolean(game?.durableFallback);
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownState, setDrilldownState] = useState("idle");
  const [exchangeProps, setExchangeProps] = useState([]);
  const date = game?.durableFallback?.boardDate;
  const sport = String(game?.sport || "").toLowerCase();
  const gameId = String(game?.id || "");
  const useStyleCards = STYLE_CARD_SPORTS.has(sport);

  useEffect(() => {
    if (!durable || !date || !sport || !gameId || typeof fetch !== "function") {
      setDrilldown(null);
      setDrilldownState("idle");
      return undefined;
    }
    const controller = new AbortController();
    setDrilldownState("loading");
    setDrilldown(null);
    const query = new URLSearchParams({ date, sport });
    fetch(`/api/today?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("FOCUSED_FEED_HTTP_" + response.status);
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const hit = (data.games || []).find((g) => String(g.id) === gameId &&
          String(g.sport || "").toLowerCase() === sport && !g.durableFallback);
        if (!hit) throw Error("NO_VERIFIED_PLAYER_FEATURES");
        setDrilldown(hit);
        setDrilldownState("complete");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDrilldownState(String(error?.message || error));
      });
    return () => controller.abort();
  }, [durable, date, sport, gameId]);

  // Reuse the Player Props board's exact event/player/stat model join.
  // Do not associate contracts by player names, approximate thresholds, or
  // provider fixture IDs; unmatched exchange rows cannot acquire projections.
  useEffect(() => {
    setExchangeProps([]);
    if (!gameId || !sport || !game?.start || typeof fetch !== "function") return undefined;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(game.start));
    const controller = new AbortController();
    const read = async path => {
      const response = await fetch(path, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || "EXCHANGE_PROP_UNAVAILABLE");
      return data.rows || [];
    };
    const query = new URLSearchParams({ sport, date });
    Promise.all([
      read(`/api/exchange-player-props?${query}`),
      read(`/api/prop-projections?${query}`),
    ]).then(([contracts, models]) => {
      if (controller.signal.aborted) return;
      const joined = joinIndependentPropModels(
        contracts.filter(p => p.canonicalEventId === gameId && p.identityVerified === true &&
          ["Kalshi", "Polymarket"].includes(p.provider) && p.line != null),
        models.filter(p => p.canonicalEventId === gameId && p.independent === true),
      );
      setExchangeProps(joined.filter(p => p.provider && p.fbis_projection != null)
        .map(p => ({
          ...p,
          canonicalEventId: p.canonicalEventId, canonicalPlayerId: p.canonicalPlayerId,
          playerName: p.player_name, team: p.team, marketCanonical: p.canonical_market,
          line: p.line, fbisProjection: p.fbis_projection, fbisSigma: p.sigma,
          book: p.provider, provider: p.provider, contractId: p.contractId,
          modelIndependent: true, modelVersion: p.modelVersion,
          start_time: p.start_time, opponent: p.opponent,
        })));
    }).catch(() => { if (!controller.signal.aborted) setExchangeProps([]); });
    return () => controller.abort();
  }, [gameId, sport, game?.start]);

  const focusedGame = drilldown || game;
  const exchangeGame = exchangeProps.length
    ? { ...focusedGame, playerMarkets: exchangeProps, playerProjectionRows: [] }
    : null;
  const exchangeRows = exchangeGame ? topThreeGamePlayerProps(exchangeGame) : [];
  const rows = exchangeRows.length ? exchangeRows : topThreeGamePlayerProps(focusedGame);
  const projected = rows.filter((r) => r.fbisProjection != null);
  // Retain genuine paired lines and model probabilities so the chart can show
  // the threshold and the prop direction. Never promote legacy PrizePicks rows.
  const styleCardRows = useStyleCards
    ? projected.filter(r => !isPrizePicksRow(r)).slice(0, 3)
    : [];
  const rankedHitCount = styleCardRows.filter(r => r.line != null &&
    Number.isFinite(Number(r.probabilityOver)) &&
    Number.isFinite(Number(r.probabilityUnder)) &&
    r.probabilityOver != null && r.probabilityUnder != null).length;

  return (
    <section className="top-game-props exchange-props-panel pp-premium-page" aria-label="Top three game player props">
      <div className="top-game-props-heading">
        <h3>TOP 3 PLAYER PROPS</h3>
        <span>
          {useStyleCards
            ? rankedHitCount ? "Ranked by modeled hit probability · last 5" : "FBIS projections · last 5 (no verified hit ranking)"
            : "FBIS model context"}
        </span>
      </div>

      {styleCardRows.length ? (
        <div className="pp-card-grid pp-premium-grid exchange-prop-grid top-game-props-grid top-game-pp-cards">
          {styleCardRows.map((p, i) => (
            <FBISPlayerPropCard
              key={`${p.gameId}:${p.playerName}:${p.marketCanonical}:${p.line}:${i}`}
              row={p}
              sport={sport}
              rank={i + 1}
            />
          ))}
        </div>
      ) : rows.length ? (
        <div className="top-game-props-grid">
          {rows.map((p, i) => (
            <article className="top-game-prop" key={`${p.gameId}:${p.playerName}:${p.marketCanonical}:${i}`}>
              <div className="top-game-prop-order">
                <span>#{i + 1}</span>
                <span>
                  {p.displayStatus === "PROJECTION_ONLY"
                    ? "MODEL ONLY"
                    : p.displayStatus === "RESEARCH_HOLD"
                      ? "MODEL"
                      : "MODEL"}
                </span>
              </div>
              <strong className="top-game-prop-player">{p.playerName}</strong>
              <span className="top-game-prop-detail">{[p.team, p.marketLabel].filter(Boolean).join(" · ")}</span>
              <div className="top-game-prop-metrics">
                <div><small>FBIS PROJ</small><strong>{fmt(p.fbisProjection)}</strong></div>
                <div><small>MARKET LINE</small><strong>{fmt(p.line)}</strong></div>
                <div>
                  <small>DIFFERENCE</small>
                  <strong>{p.line == null ? "—" : fmt(Number(p.fbisProjection) - Number(p.line))}</strong>
                </div>
              </div>
              <div className="top-game-prop-foot">
                {p.line != null && p.book
                  ? <span>{p.book}</span>
                  : <span>{p.line == null ? "No paired market line" : "Source not verified for execution"}</span>}
                {p.line != null
                  ? <span>Over {fmtPrice(p.overOdds)} / Under {fmtPrice(p.underOdds)}</span>
                  : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="top-game-props-empty" role="status">
          {durable && drilldownState === "loading"
            ? "Loading game-specific player projections from the focused sport feed…"
            : durable && drilldownState !== "complete"
              ? "Game-specific player projections unavailable. No player prop is inferred from stored scores."
              : useStyleCards
                ? "No game-matched FBIS projections are available for this matchup yet."
                : "No game-matched, independent FBIS player projections available for this matchup."}
        </p>
      )}

    </section>
  );
}
