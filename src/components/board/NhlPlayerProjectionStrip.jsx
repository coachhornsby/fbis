import { selectNhlCardProps } from "../../lib/nhlCardProps.js";
import "./nhlPlayerProjectionStrip.css";

const display = n => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(1);

/** Added BELOW the original premium NHL card; never changes its top presentation. */
export default function NhlPlayerProjectionStrip({game}) {
  const live=Boolean(game?.live || game?.status?.state==="in" || game?.status?.type?.state==="in");
  const final=Boolean(game?.final || game?.status?.completed);
  const props=selectNhlCardProps(game,{live,final});
  return <section className="nhl-original-props" aria-label="Independent NHL player projections">
    <header><strong>PLAYER PROJECTIONS</strong><small>NHL-PLAYER-PRO-v2 · RESEARCH ONLY</small></header>
    {props.length ? <div className="nhl-original-props-grid">{props.map(row=><div className="nhl-original-prop" key={row.player+":"+row.market}>
      <span><strong>{row.player}</strong><small>{row.team} · {row.market==="shots_on_goal"?"SHOTS ON GOAL":row.market==="points"?"POINTS":row.market.replaceAll("_"," ").toUpperCase()}</small></span>
      <b>{display(row.projection)}</b>
    </div>)}</div> : <p>{live||final?"No verified frozen pregame player projections":"No verified matchup-bound player projections yet"}</p>}
  </section>;
}
