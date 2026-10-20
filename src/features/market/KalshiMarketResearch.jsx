import {useState} from "react";
import {classifyKalshiSportContract} from "../../../functions/lib/kalshiContractIdentity.js";
import "./kalshiResearch.css";

const price=v=>Number.isFinite(v)?(v*100).toFixed(1)+"¢":"—";
const moment=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("en-US",{
 timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—";

/** No board or model mutation. Only independently requested Kalshi research. */
export default function KalshiMarketResearch({variant="market",initialSport="nfl"}){
 const [sport,setSport]=useState(["cfb","nfl"].includes(initialSport)?initialSport:"nfl");
 const [data,setData]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 async function check(){
  setLoading(true);setError("");setData(null);
  try{
   const r=await fetch("/api/kalshi-market-shadow?sport="+sport,{cache:"no-store"});
   const d=await r.json();
   if(!r.ok||!d?.ok){
    setError(d?.code==="KALSHI_PUBLIC_RATE_LIMITED"
      ?"Kalshi is rate-limited. The centralized collector will wait before its next request."
      :d?.code==="KALSHI_SNAPSHOT_NOT_READY"
      ?"Collector is deployed; no verified Kalshi market snapshot has been captured yet."
      :d?.code==="KALSHI_SNAPSHOT_STALE"
      ?"The latest Kalshi snapshot is too old to use. Prices are withheld."
      :d?.code==="KALSHI_COLLECTOR_SPORT_NOT_ENABLED"
      ?"This sport is not enabled in the Kalshi collector."
      :"Kalshi research is unavailable ("+(d?.code||"UNKNOWN")+").");
    return;
   }
   setData(d);
  }catch{setError("Kalshi research is temporarily unavailable.");}
  finally{setLoading(false);}
 }
 if(variant==="props")return (
  <section className="kalshi-research kalshi-research--props" aria-label="Kalshi player prop and combo integration">
   <header className="kalshi-research-top"><strong>Kalshi player props &amp; combos</strong><span>DISCOVERY GATE</span></header>
   <p>Kalshi sport-specific player props and correlated combos are awaiting verified player identity, statistic thresholds, settlement terms and fee/liquidity contracts. No lines are being invented or used to grade FBIS picks.</p>
   <div className="kalshi-research-proof">NFL / CFB discovery first · Multivariate RFQ is not a standing fillable quote · No automatic wagering</div>
  </section>
 );
 const records=Array.isArray(data?.records)?data.records:[];
 return (
  <section className="kalshi-research" aria-label="Kalshi shadow market research">
   <header className="kalshi-research-top">
    <div><span className="kalshi-research-kicker">KALSHI / MARKET INTELLIGENCE</span><h3>Kalshi Market Research</h3>
     <p>Provider quote research only. PinnOdds remains the reference; FBIS CORE and card conviction are unchanged.</p></div>
    <span className="kalshi-research-pill">SHADOW · NOT EXECUTABLE</span>
   </header>
   <div className="kalshi-research-actions">
    <label>Sport <select value={sport} onChange={e=>{setSport(e.target.value);setData(null);setError("");}}>
     <option value="nfl">NFL</option><option value="cfb">CFB</option>
    </select></label>
    <button type="button" disabled={loading} onClick={check}>{loading?"Checking…":"Inspect collected markets"}</button>
    <span>{data?"R2 snapshot "+moment(data.capturedAt||data.fetchedAt):"No automatic upstream quote polling from this page"}</span>
   </div>
   {error&&<p className="kalshi-research-alert" role="status">{error}</p>}
   {data&&<>
    <div className="kalshi-research-metrics">
     <span><strong>{records.length}</strong> research contracts</span>
     <span><strong>{data.paginationComplete?"Complete":"Partial"}</strong> collected page</span>
     <span><strong>{data.snapshotAgeSeconds!=null?Math.round(data.snapshotAgeSeconds/60)+"m":"—"}</strong> snapshot age</span>
     <span><strong>0</strong> contracts approved for FBIS wagers</span>
    </div>
    <div className="kalshi-research-scroll"><table><thead><tr>
     <th>Contract</th><th>YES bid</th><th>YES ask</th><th>NO bid</th><th>Ask size</th><th>Contract classification</th>
    </tr></thead><tbody>
     {records.slice(0,24).map(row=><tr key={row.ticker}>
      <td><strong>{row.yesLabel||row.title||row.ticker}</strong><small>{row.ticker}</small></td>
      <td>{price(row.yesBidDollars)}</td><td>{price(row.yesAskDollars)}</td>
      <td>{price(row.noBidDollars)}</td>
      <td>{row.yesAskSize??"—"}</td>
      <td>{classifyKalshiSportContract({ticker:row.ticker,title:row.title,yes_sub_title:row.yesLabel}).family} · Unverified</td>
     </tr>)}
     {!records.length&&<tr><td colSpan="6">No markets captured in this snapshot. This does not imply zero Kalshi markets exist.</td></tr>}
    </tbody></table></div>
    <p className="kalshi-research-disclaimer">Indicative public quotes, not guaranteed fillable offers. Contract/side identity, source quote clock, fees and settlement have not passed the executable-price gate. Do not infer EV from the bid/ask display.</p>
   </>}
  </section>
 );
}
