import {useMemo,useState} from "react";
import "./myBetsIntelligence.css";
const money=v=>(v<0?"−":"+")+"$"+Math.abs(v).toFixed(2);
const pct=v=>Number.isFinite(v)?(v*100).toFixed(1)+"%":"—";
const num=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
export const betFamily=b=>{const m=String(b.market||"").toUpperCase();const book=String(b.executionBook||"").toLowerCase();const multiMarketPlayerCombo=m.includes("MARKET COMBO")&&["PASSING YARDS","RUSHING YARDS","RECEIVING YARDS","TOUCHDOWN","STRIKEOUT"].some(stat=>m.includes(stat));return m.includes("PLAYER_PROP")||m.includes("PLAYER PROP")||m.includes("PLAYER STAT")||m.includes("PLAYER PERFORMANCE")||multiMarketPlayerCombo||book==="prizepicks"?"props":"games";};
const isSettled=b=>["WON","LOST","PUSH"].includes(String(b.result||"").toUpperCase());
function group(rows,fn){const m=new Map();for(const b of rows){const key=String(fn(b)||"Unknown");if(!m.has(key))m.set(key,{key,n:0,staked:0,profit:0,wins:0,losses:0});const x=m.get(key);x.n++;if(isSettled(b)){x.staked+=num(b.riskAmount)??0;x.profit+=num(b.profit)??0;}if(b.result==="WON")x.wins++;if(b.result==="LOST")x.losses++;}return [...m.values()].sort((a,b)=>b.n-a.n);}
function Bars({items,mode="profit"}){const list=items.slice(0,8);const max=Math.max(1,...list.map(x=>Math.abs(mode==="roi"?(x.staked?100*x.profit/x.staked:0):mode==="n"?x.n:x.profit)));return <div className="mbi-bars">{list.map(x=>{const value=mode==="roi"?(x.staked?100*x.profit/x.staked:0):mode==="n"?x.n:x.profit;return <div className="mbi-bar" key={x.key}><div className="mbi-bar-head"><span title={x.key}>{x.key}</span><b>{mode==="roi"?value.toFixed(1)+"%":mode==="n"?x.n:money(value)}</b></div><div className="mbi-bar-track"><i className={value<0?"negative":""} style={{width:Math.max(1,100*Math.abs(value)/max)+"%"}}/></div><small>{x.n} tickets · {x.wins}W–{x.losses}L</small></div>})}{!list.length&&<p>No eligible records for this view.</p>}</div>}

function Curve({rows}) {
 const ordered=[...rows]
  .filter(b=>isSettled(b)&&num(b.profit)!=null&&b.date)
  .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
 let total=0;
 const points=[0,...ordered.map(b=>total+=num(b.profit))];
 const low=Math.min(0,...points),high=Math.max(0,...points),span=Math.max(1,high-low);
 const left=88,right=616,top=25,bottom=212;
 const x=i=>left+(right-left)*(i/Math.max(points.length-1,1));
 const y=v=>bottom-(bottom-top)*(v-low)/span;
 const coords=points.map((v,i)=>[x(i),y(v)]);
 const line=coords.map(([px,py],i)=>(i?'L':'M')+px.toFixed(1)+' '+py.toFixed(1)).join(' ');
 const area=line+' L '+x(points.length-1)+' '+bottom+' L '+left+' '+bottom+' Z';
 const ticks=[...new Set([low,(low+high)/2,high].map(v=>Number(v.toFixed(2))))];
 const end=coords.at(-1);
 const trendPositive=total>=0;
 return <>
  <div className="mbi-curve">
   <svg role="img" aria-label={`Realized cumulative profit chart for ${ordered.length} settled wagers, ending at ${money(total)}`} viewBox="0 0 640 244" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="mbi-profit-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={trendPositive?"#68e3a5":"#ff9a9c"} stopOpacity=".32"/><stop offset="100%" stopColor={trendPositive?"#68e3a5":"#ff9a9c"} stopOpacity=".01"/></linearGradient></defs>
    {ticks.map((v,i)=><g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#76889a" strokeDasharray="5 7" opacity=".54"/><text x={left-12} y={y(v)+5} fill="#edf2f7" fontSize="15" textAnchor="end">{money(v)}</text></g>)}
    {low<0&&high>0?<line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#e6edf3" strokeWidth="1.5" opacity=".65"/>:null}
    {ordered.length>0?<><path d={area} fill="url(#mbi-profit-area)"/><path d={line} fill="none" stroke={trendPositive?"#71edaf":"#ff9fa4"} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round"/><circle cx={end[0]} cy={end[1]} r="7" fill={trendPositive?"#71edaf":"#ff9fa4"} stroke="#091625" strokeWidth="3"/></>:null}
    <text x={left} y="239" fill="#edf2f7" fontSize="15">First wager</text>
    <text x={right} y="239" fill="#edf2f7" fontSize="15" textAnchor="end">Latest settled</text>
   </svg>
  </div>
  <div className="mbi-curve-facts" aria-label="Profit chart summary">
   <span>Peak <b>{money(high)}</b></span>
   <span>Low <b>{money(low)}</b></span>
   <span>Current <b className={trendPositive?"is-profit":"is-loss"}>{money(total)}</b></span>
  </div>
  <p className="mbi-meta">{ordered.length} settled wagers with verified P/L · By wager date, not bankroll deposits</p>
 </>;
}
export default function MyBetsIntelligence({bets=[],unavailable=false,onShowLedger,projectionScorecard=null}) {
 const [period,setPeriod]=useState("all"); const [sport,setSport]=useState("all");const [metric,setMetric]=useState("profit");const [family,setFamily]=useState("games");
 const cutoff=period==="30"?Date.now()-30*86400000:period==="90"?Date.now()-90*86400000:null;
 const rows=useMemo(()=>bets.filter(b=>(family==="combined"||betFamily(b)===family)&&(sport==="all"||b.sport===sport)&&(!cutoff||Date.parse(b.date)>=cutoff)),[bets,sport,cutoff,family]);
 const settled=rows.filter(isSettled),graded=rows.filter(b=>b.result==="WON"||b.result==="LOST");
 const risk=settled.reduce((a,b)=>a+(num(b.riskAmount)||0),0),profit=settled.reduce((a,b)=>a+(num(b.profit)||0),0);
 const wins=graded.filter(b=>b.result==="WON").length;
 const unresolved=rows.filter(b=>!["WON","LOST","PUSH","VOID"].includes(String(b.result||"").toUpperCase()));
 const books=group(rows,b=>b.executionBook),sports=group(rows,b=>String(b.sport||"unknown").toUpperCase()),markets=group(rows,b=>b.market),why=group(rows,b=>b.recommendationStatus||"UNATTRIBUTED"),who=group(rows,b=>b.selectedTeam||b.playerName||b.homeTeam||b.awayTeam||"Unspecified");
 const models=projectionScorecard?.models||[];
 return <section className="mbi-dashboard" aria-label="FBIS betting performance intelligence">
  <div className="mbi-top"><div><span className="mbi-overline">PERFORMANCE INTELLIGENCE</span><h2>Where the numbers lead</h2><p>Game lines and player props have independent records and returns.</p></div><div className="mbi-controls"><label>Period<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">All available</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label>Sport<select value={sport} onChange={e=>setSport(e.target.value)}><option value="all">All sports</option>{[...new Set(bets.map(b=>b.sport).filter(Boolean))].sort().map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label></div></div>
  <nav className="mbi-family-nav" aria-label="Wager type">{[["games","Game lines"],["props","Player props"],["combined","Combined — all wagers"]].map(([key,label])=><button type="button" key={key} className={family===key?"active":""} aria-pressed={family===key} onClick={()=>setFamily(key)}>{label}</button>)}</nav>
  {unavailable?<div role="status" className="mbi-warning">Source unavailable. Performance cannot be verified.</div>:<>
  <div className="mbi-context"><b>{family==="games"?"GAME LINES":family==="props"?"PLAYER PROPS":"ALL WAGERS"}</b><span>{family==="combined"?"Combined portfolio includes both categories; do not interpret this as game-line performance.":"All KPIs and charts below are scoped to this wager category."}</span></div>
  <div className="mbi-kpis">{[["NET P/L",money(profit),settled.length+" settled tickets"],["RETURN ON STAKE",risk>0?pct(profit/risk):"—","$"+risk.toFixed(2)+" settled risk"],["WIN RATE",graded.length?pct(wins/graded.length):"—",wins+"W / "+(graded.length-wins)+"L"],["TICKET VOLUME",String(rows.length),unresolved.length+" unresolved"]].map(([l,v,d])=><div className="mbi-kpi" key={l}><small>{l}</small><strong className={l==="NET P/L"?(profit<0?"is-loss":"is-profit"):""}>{v}</strong><span>{d}</span></div>)}</div>
  {unresolved.length>0&&<div className="mbi-warning"><b>{unresolved.length} unresolved wager{unresolved.length!==1?"s":""} require reconciliation.</b> Completed events cannot be assumed settled without market-specific grading. <button type="button" onClick={onShowLedger}>Review tickets →</button></div>}
  <div className="mbi-chart-grid"><article className="mbi-card mbi-wide"><header><h3>Realized profit trajectory</h3><span>Chronological · Settled only</span></header><Curve rows={settled}/></article><article className="mbi-card"><header><h3>Return by sport</h3><span>Realized wagers</span></header><Bars items={sports} mode={metric}/></article></div>
  <div className="mbi-section-title"><h3>How · Where · What · Why · Who</h3><div className="mbi-switch"><button className={metric==="profit"?"active":""} onClick={()=>setMetric("profit")}>Profit</button><button className={metric==="roi"?"active":""} onClick={()=>setMetric("roi")}>ROI</button><button className={metric==="n"?"active":""} onClick={()=>setMetric("n")}>Volume</button></div></div>
  <div className="mbi-insights">{[["HOW","Markets & construction",markets],["WHERE","Sportsbooks",books],["WHAT","Sports",sports],["WHY","Recorded attribution",why],["WHO","Selections / players",who]].map(([tag,title,items])=><article className="mbi-card" key={tag}><header><span className="mbi-tag">{tag}</span><h3>{title}</h3></header><Bars items={items} mode={metric}/></article>)}</div>
  <article className="mbi-card mbi-models"><header><div><span className="mbi-tag">FBIS MODEL INTELLIGENCE</span><h3>Independent projection accuracy</h3></div><span>{projectionScorecard?.asOf?"Tracker reference · "+projectionScorecard.asOf:"Awaiting validated model-scorecard feed"}</span></header>
  {models.length?<div className="mbi-model-grid">{models.map(m=><div className="mbi-model" key={m.sport}><small>{m.sport} · {m.graded} graded forecast rows</small><strong>{pct(m.correct/m.graded)}</strong><span>Winner accuracy · {m.correct} correct</span><span>Total MAE {num(m.totalMae)==null?"—":num(m.totalMae).toFixed(2)} · Margin MAE {num(m.marginMae)==null?"—":num(m.marginMae).toFixed(2)}</span></div>)}</div>:<p>Model results require a separate audited projection ledger. Wager results must not be substituted for model accuracy.</p>}
  <p className="mbi-meta">Projection-row accuracy is not a return on wagers. Repeated snapshots and market qualification have different denominators; never treat these figures as ATS profitability.</p></article>
  </>}
 </section>;
}