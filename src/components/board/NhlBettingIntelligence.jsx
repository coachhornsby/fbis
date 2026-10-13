import TeamLogo from "../TeamLogo.jsx";
import { buildNhlBettingIntelligence } from "../../lib/nhlBettingIntelligence.js";
import { teamHex } from "../../lib/matchupTeamBrand.js";
import "./nhlBettingIntelligence.css";

const NA="N/A";
const pct=v=>v==null?NA:`${(v*100).toFixed(1)}%`;
const cents=v=>v==null?NA:`${(v*100).toFixed(1).replace(/\.0$/,"")}¢`;
const pp=v=>v==null?NA:`${v>0?"+":""}${(v*100).toFixed(1)} pp`;
const number=v=>v==null?NA:String(v);
function Stat({label,value,kind=""}){
  return <div className={`nhl-bi-stat ${kind}`}>
    <span>{label}</span><strong>{value}</strong>
  </div>;
}
/** The approved middle-panel redesign. No market data is synthesized at render time. */
export default function NhlBettingIntelligence({game,vm}){
  const b=buildNhlBettingIntelligence(game,vm);
  if(!b)return null;
  const action=b.action||{},poly=b.poly||{};
  const validModel=b.modelProbability!=null;
  const hasReference=b.pinnedProbability!=null;
  const hasBook=poly.bid!=null||poly.ask!=null;
  return <section className="nhl-bi" aria-label="NHL betting intelligence research" style={{
    "--nhl-bi-team": teamHex(b.team?.color||b.team?.primaryColor||b.team?.primary_color)||"#b7213d"
  }}>
    <header className="nhl-bi-head"><strong>▥ BETTING INTELLIGENCE</strong><span>RESEARCH ONLY</span></header>
    <div className="nhl-bi-lead">
      {validModel ? <TeamLogo team={b.team} size={45} className="nhl-bi-team-logo" />:null}
      <div><small>{b.headline}</small><strong>{validModel?`${b.abbr} MONEYLINE`:NA}</strong>
        <span>{validModel?"Independent model · Not a qualified bet":"No source-verified model probability"}</span>
      </div>
    </div>
    <div className="nhl-bi-probabilities">
      <Stat label={`FBIS ${b.abbr} WIN %`} value={pct(b.modelProbability)} kind="fbis" />
      <Stat label="PINNODDS FAIR" value={pct(b.pinnedProbability)} kind="sharp" />
      <Stat label="POLYMARKET ASK" value={cents(poly.ask)} kind="exchange" />
    </div>
    {b.gap!=null||b.polyGap!=null?<div className="nhl-bi-differences">
      {b.gap!=null?<span>FBIS vs PinnOdds: <b>{pp(b.gap)}</b></span>:null}
      {b.polyGap!=null?<span>FBIS vs Polymarket: <b>{pp(b.polyGap)}</b></span>:null}
    </div>:null}
    {poly.display!=null&&poly.ask==null?<p className="nhl-bi-caption">Polymarket display reference: {cents(poly.display)} · Not an executable ask</p>:null}
    {action.available?
      <div className="nhl-bi-module">
        <div className="nhl-bi-module-head"><strong>⚡ ACTION SIGNAL</strong><small>{action.marketMatched?"Same-market split":"Market-family unverified"}</small></div>
        <div className="nhl-bi-action-grid">
          <div><span>Tickets · {b.abbr}</span><strong>{action.tickets==null?NA:`${Math.round(action.tickets)}%`}</strong>
            {action.tickets!=null?<i className="nhl-bi-track"><i style={{width:`${action.tickets}%`}}/></i>:null}</div>
          <div><span>Money · {b.abbr}</span><strong>{action.money==null?NA:`${Math.round(action.money)}%`}</strong>
            {action.money!=null?<i className="nhl-bi-track"><i style={{width:`${action.money}%`}}/></i>:null}</div>
          <div><span>Line move</span><strong>{action.movement||NA}</strong></div>
        </div>
        {action.divergence!=null?<small className="nhl-bi-caption">Money minus tickets: {pp(action.divergence/100)} · Sentiment only, not proof of sharp action</small>:null}
      </div>:
      <div className="nhl-bi-empty"><strong>ACTION</strong><span>{NA}</span></div>}
    {hasBook?
      <div className="nhl-bi-module nhl-bi-poly">
        <div className="nhl-bi-module-head"><strong>◇ POLYMARKET BOOK</strong><small>Observed BBO · no guaranteed fill</small></div>
        <div className="nhl-bi-book-grid">
          <Stat label="BEST BID" value={cents(poly.bid)} />
          <Stat label="BEST ASK" value={cents(poly.ask)} />
          <Stat label="DEPTH" value={number(poly.depth)} />
          <Stat label="SPREAD" value={cents(poly.spread)} />
        </div>
        {!poly.comparable?<small className="nhl-bi-caption">Settlement equivalence: {NA} · No executable-value calculation</small>:null}
      </div>:
      <div className="nhl-bi-empty"><strong>POLYMARKET BOOK</strong><span>{NA}</span></div>}
    <footer className="nhl-bi-status">
      <strong>BET STATUS: RESEARCH ONLY</strong>
      <small>{b.limitations[0]||"No betting authority; independent prospective qualification required"}</small>
    </footer>
  </section>;
}
