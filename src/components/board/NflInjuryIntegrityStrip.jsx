import {nflInjuryScoreIntegrity} from "../../lib/nflInjuryScoreIntegrity.js";

/**
 * The existing NFL score is NOT recalculated from this warning.
 * Read-only source transparency: an OUT QB1 does not imply a quantified edge.
 */
export default function NflInjuryIntegrityStrip({game}){
  const evidence=nflInjuryScoreIntegrity(game);
  if(!evidence||!evidence.critical)return null;
  return (
    <aside aria-label="NFL confirmed QB injury not applied to displayed score"
      role="status" style={{margin:"0.7rem 0",padding:"0.75rem",border:"1px solid currentColor",borderRadius:9}}>
      <strong>⚠ CONFIRMED QB OUT · RESEARCH SCORE NOT INJURY-ADJUSTED</strong>
      {evidence.confirmedQbOut.map(p=>(
        <div key={p.team+":"+p.name} style={{fontSize:".9rem",marginTop:5}}>
          <strong>{p.team} · {p.name} · {p.status}</strong>
          {p.injury?" ("+p.injury+")":""}
          {p.replacement?.name?" · available QB depth: "+p.replacement.name:""}
          {p.observedAt?" · FBIS observed "+new Date(p.observedAt).toLocaleString("en-US",{
            timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" CT":""}
        </div>
      ))}
      <p style={{fontSize:".82rem",margin:"6px 0 0"}}>
        Injury state is ingested, but the displayed NFL-PRO-v1.2 score does not consume persistent
        player status. A separate QB-personnel SHADOW may evaluate this state at its next valid
        point-in-time checkpoint; it has no production or wager authority.
        {" "}<a href="https://www.nfl.com/injuries/" target="_blank" rel="noreferrer">
          NFL official injury report
        </a>
      </p>
    </aside>
  );
}
