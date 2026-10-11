import { useEffect, useState } from "react";
import { topThreeGamePlayerProps } from "./topGamePlayerProps.js";
import "./topGameProps.css";

const fmt = (v, decimals=1) => v == null || v === "" || !Number.isFinite(Number(v))
  ? "—" : Number(v).toFixed(decimals).replace(/\.0$/,"");
const fmtPrice = (v) => v == null || v === "" || !Number.isFinite(Number(v))
  ? "—" : Number(v)>0?"+".concat(Math.round(Number(v))):String(Math.round(Number(v)));

export default function TopGameProps({game}) {
  const durable=Boolean(game?.durableFallback);
  const [drilldown,setDrilldown]=useState(null);
  const [drilldownState,setDrilldownState]=useState("idle");
  // This component is mounted only in expanded details. When the all-sports
  // board uses the fast read-only schedule, fetch a single sport on demand,
  // never all eleven, and never grant authority to a recovered game.
  const date=game?.durableFallback?.boardDate;
  const sport=String(game?.sport||"").toLowerCase();
  const gameId=String(game?.id||"");
  useEffect(()=>{
    if(!durable||!date||!sport||!gameId||typeof fetch!=="function"){
      setDrilldown(null);
      setDrilldownState("idle");
      return undefined;
    }
    const controller=new AbortController();
    setDrilldownState("loading");
    setDrilldown(null);
    const query=new URLSearchParams({date,sport});
    fetch(`/api/today?${query.toString()}`,{signal:controller.signal})
      .then(async(response)=>{
        if(!response.ok)throw Error("FOCUSED_FEED_HTTP_"+response.status);
        return response.json();
      })
      .then(data=>{
        if(controller.signal.aborted)return;
        const hit=(data.games||[]).find(g=>String(g.id)===gameId &&
          String(g.sport||"").toLowerCase()===sport && !g.durableFallback);
        if(!hit)throw Error("NO_VERIFIED_PLAYER_FEATURES");
        setDrilldown(hit);
        setDrilldownState("complete");
      })
      .catch(error=>{
        if(controller.signal.aborted)return;
        setDrilldownState(String(error?.message||error));
      });
    return ()=>controller.abort();
  },[durable,date,sport,gameId]);
  const rows=topThreeGamePlayerProps(drilldown||game);
  return (
    <section className="top-game-props" aria-label="Top three game player props">
      <div className="top-game-props-heading">
        <h3>TOP 3 PLAYER PROPS</h3>
        <span>FBIS model context · not betting picks</span>
      </div>
      {rows.length ? (
        <div className="top-game-props-grid">
          {rows.map((p,i)=>(
            <article className="top-game-prop" key={`${p.gameId}:${p.playerName}:${p.marketCanonical}:${i}`}>
              <div className="top-game-prop-order"><span>#{i+1}</span><span>{p.displayStatus==="PROJECTION_ONLY"?"MODEL ONLY":p.displayStatus==="RESEARCH_HOLD"?"RESEARCH HOLD":"RESEARCH"}</span></div>
              <strong className="top-game-prop-player">{p.playerName}</strong>
              <span className="top-game-prop-detail">{[p.team,p.marketLabel].filter(Boolean).join(" · ")}</span>
              <div className="top-game-prop-metrics">
                <div><small>FBIS PROJ</small><strong>{fmt(p.fbisProjection)}</strong></div>
                <div><small>MARKET LINE</small><strong>{fmt(p.line)}</strong></div>
                <div><small>DIFFERENCE</small><strong>{p.line==null?"—":fmt(Number(p.fbisProjection)-Number(p.line))}</strong></div>
              </div>
              <div className="top-game-prop-foot">
                {p.line!=null&&p.book?<span>{p.book}</span>:<span>{p.line==null?"No paired market line":"Source not verified for execution"}</span>}
                {p.line!=null?<span>Over {fmtPrice(p.overOdds)} / Under {fmtPrice(p.underOdds)}</span>:null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="top-game-props-empty" role="status">
          {durable && drilldownState==="loading"
            ? "Loading game-specific player projections from the focused sport feed…"
            : durable && drilldownState!=="complete"
              ? "Game-specific player projections unavailable. No player prop is inferred from stored scores."
              : "No game-matched, independent FBIS player projections available for this matchup."}
        </p>
      )}
      <p className="top-game-props-disclaimer">Research display only. Missing prices, lines and probabilities are not estimated. No automatic wager qualification.</p>
    </section>
  );
}
