import {useState} from "react";
import "./kalshiSeriesExplorer.css";

/** R2 research directory, not a market-price or model-authority surface. */
export default function KalshiSeriesExplorer(){
 const [query,setQuery]=useState("");
 const [data,setData]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 async function load(term=query,offset=0){
  setQuery(term);setLoading(true);setError("");
  try{
   const p=new URLSearchParams({q:term,limit:"40",offset:String(offset)});
   const r=await fetch("/api/kalshi-series-catalog?"+p.toString(),{cache:"no-store"});
   const d=await r.json();
   if(!r.ok||!d?.ok)throw Error(d?.code||"CATALOG_UNAVAILABLE");
   setData(d);
  }catch(e){
   setError(e.message==="KALSHI_SERIES_CATALOG_NOT_READY"
     ?"Sports series catalog is awaiting its next signed discovery run."
     :"Kalshi series catalog is unavailable ("+(e.message||"UNKNOWN")+").");
  }finally{setLoading(false);}
 }
 return <section className="kalshi-catalog" aria-label="Kalshi Sports series discovery">
  <header>
   <div><span className="kalshi-catalog-label">KALSHI · SPORTS COVERAGE RESEARCH</span>
    <h3>Explore Available Market Series</h3>
    <p>Discover Kalshi's actual sports contract families before mapping them into FBIS. This is a provider catalog, not an executable betting board.</p></div>
   <span className="kalshi-catalog-research">RESEARCH ONLY</span>
  </header>
  <form onSubmit={e=>{e.preventDefault();load(query,0);}} className="kalshi-catalog-form">
   <label htmlFor="kalshi-series-search">Search by ticker, league, title or tag</label>
   <div><input id="kalshi-series-search" value={query} onChange={e=>setQuery(e.target.value)}
    placeholder="NFL, NBA, hockey, soccer, tennis…" maxLength={60}/>
    <button type="submit" disabled={loading}>{loading?"Searching…":"Search series"}</button></div>
  </form>
  <div className="kalshi-catalog-shortcuts">
   {["NFL","CFB","NBA","MLB","Hockey","Soccer","Tennis","Player"].map(x=>
    <button key={x} type="button" disabled={loading} onClick={()=>load(x,0)}>{x}</button>)}
   <button type="button" disabled={loading} onClick={()=>load("",0)}>All series</button>
  </div>
  {error&&<p className="kalshi-catalog-alert" role="status">{error}</p>}
  {data&&<>
   <div className="kalshi-catalog-counts">
    <span><strong>{data.totalMatches.toLocaleString()}</strong> matching series</span>
    <span><strong>{data.storedSeries?.toLocaleString()??"—"}</strong> catalogued</span>
    <span><strong>{data.truncated?"Partial":"Retained"}</strong> catalog storage</span>
   </div>
   <div className="kalshi-catalog-table">
    <table><thead><tr><th>Series ticker</th><th>Contract family</th><th>Provider tags</th><th>FBIS status</th></tr></thead>
    <tbody>{data.records.map(s=><tr key={s.ticker}>
      <td><strong>{s.ticker}</strong></td><td>{s.title||"Untitled"}</td>
      <td>{[...new Set([s.category,...s.tags].filter(Boolean))].slice(0,5).join(" · ")||"—"}</td>
      <td>Unmapped · Research</td>
    </tr>)}
    {!data.records.length&&<tr><td colSpan="4">No matches in the currently captured Sports catalog.</td></tr>}</tbody></table>
   </div>
   <div className="kalshi-catalog-footer">
    <span>Showing {data.records.length?data.offset+1:0}–{data.offset+data.records.length} of {data.totalMatches}. Discovery does not verify active contracts, settlement, player identities or pricing.</span>
    <div><button type="button" disabled={loading||data.offset===0} onClick={()=>load(data.query,Math.max(0,data.offset-40))}>Previous</button>
     <button type="button" disabled={loading||data.nextOffset==null} onClick={()=>load(data.query,data.nextOffset)}>Next</button></div>
   </div>
  </>}
 </section>;
}
