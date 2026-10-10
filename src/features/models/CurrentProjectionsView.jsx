import { useEffect, useMemo, useState } from "react";
import { finiteOrNull } from "../today/formatters.js";
import { hasCurrentProjection as hasProjection } from "../../lib/currentProjectionValues.js";

const CORE = ["cfb","nfl","nhl"];
function shift(date,days){
  const [y,m,d]=String(date).split("-").map(Number);
  const x=new Date(Date.UTC(y,m-1,d));
  x.setUTCDate(x.getUTCDate()+days);
  return x.toISOString().slice(0,10);
}
function datesFor(sport,date){
  if(sport==="cfb") return [date,shift(date,1),shift(date,2)];
  if(sport==="nfl") return [date,shift(date,1),shift(date,2),shift(date,3)];
  return [date];
}
function num(v,digits=0){
  const n=finiteOrNull(v);
  return n==null?"—":n.toFixed(digits);
}
function modelId(game={}){
  return String(game?.model?.engine||game?.model?.name||game?.modelVersion||"FBIS").trim()||"FBIS";
}
function maturity(game={}){
  return String(game?.model?.maturity||game?.projection?.maturity||game?.maturity||"UNKNOWN").toUpperCase();
}
function quality(game={}){
  return finiteOrNull(game?.quality?.score);
}
function hasMarket(game={}){
  const m=game?.market||{};
  return m.spread!=null||m.total!=null||m.moneyline?.home!=null||m.moneyline?.away!=null;
}
function aggregate(rows=[]){
  const byModel=new Map();
  for(const game of rows){
    const key=modelId(game);
    if(!byModel.has(key)) byModel.set(key,{
      id:key,games:0,projected:0,marketReady:0,qualities:[],maturities:new Map(),starts:[],
    });
    const x=byModel.get(key);
    x.games+=1;
    if(hasProjection(game)) x.projected+=1;
    if(hasMarket(game)) x.marketReady+=1;
    const q=quality(game); if(q!=null) x.qualities.push(q);
    const m=maturity(game); x.maturities.set(m,(x.maturities.get(m)||0)+1);
    if(game?.start) x.starts.push(game.start);
  }
  return [...byModel.values()].map(x=>{
    const maturityTop=[...x.maturities.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"UNKNOWN";
    const avgQuality=x.qualities.length?x.qualities.reduce((a,b)=>a+b,0)/x.qualities.length:null;
    const coverage=x.games?x.projected/x.games:0;
    const marketCoverage=x.games?x.marketReady/x.games:0;
    return {
      ...x,
      maturity:maturityTop,
      avgQuality,
      coverage,
      marketCoverage,
      nextStart:x.starts.sort()[0]||null,
      status:coverage===1?"READY":coverage>0?"PARTIAL":"UNAVAILABLE",
    };
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
function fmtStart(iso){
  if(!iso) return "—";
  return new Date(iso).toLocaleString("en-US",{
    timeZone:"America/Chicago",
    weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
  });
}

export default function CurrentProjectionsView({date,sportFilter="all"}){
  const sports=useMemo(()=>CORE.includes(sportFilter)?[sportFilter]:CORE,[sportFilter]);
  const [state,setState]=useState({loading:true,error:"",rows:[],failures:[]});

  useEffect(()=>{
    let cancelled=false;
    setState({loading:true,error:"",rows:[],failures:[]});
    (async()=>{
      const jobs=[];
      for(const sport of sports) for(const d of datesFor(sport,date)) jobs.push({sport,date:d});
      const settled=await Promise.all(jobs.map(async job=>{
        try{
          const q=new URLSearchParams({sport:job.sport,date:job.date,_t:String(Date.now())});
          const res=await fetch("/api/projections?"+q.toString(),{credentials:"same-origin"});
          const body=await res.json().catch(()=>({}));
          if(!res.ok||body?.ok===false) throw new Error(body?.error||("HTTP "+res.status));
          return {ok:true,sport:job.sport,date:job.date,games:Array.isArray(body.games)?body.games:[]};
        }catch(e){
          return {ok:false,sport:job.sport,date:job.date,error:String(e?.message||e),games:[]};
        }
      }));
      if(cancelled) return;
      const seen=new Set(),rows=[];
      for(const pack of settled) for(const g of pack.games){
        const key=pack.sport+":"+String(g.id);
        if(seen.has(key)) continue;
        seen.add(key);
        rows.push({...g,sport:pack.sport,slateDate:pack.date});
      }
      const failures=settled.filter(x=>!x.ok);
      setState({
        loading:false,
        error:failures.length===settled.length
          ? failures.map(x=>x.sport+" "+x.date+": "+x.error).join(" · ")
          :"",
        rows,
        failures,
      });
    })();
    return()=>{cancelled=true};
  },[date,sports]);

  const grouped=useMemo(()=>sports.map(s=>{
    const rows=state.rows.filter(r=>r.sport===s);
    return {sport:s,rows,models:aggregate(rows)};
  }),[sports,state.rows]);

  const totalGames=state.rows.length;
  const projected=state.rows.filter(hasProjection).length;
  const marketReady=state.rows.filter(hasMarket).length;

  return <section className="panel panel-board model-status-page">
    <div className="panel-header">
      <div>
        <div className="shell-placeholder-kicker">MODEL OPERATIONS</div>
        <h2>MODELS</h2>
        <div className="muted">
          Model health, projection coverage, maturity and data readiness. Betting decisions live on Board and Player Props.
        </div>
      </div>
      <span className="last-updated">{state.loading?"Loading…":totalGames+" games observed"}</span>
    </div>

    <div className="panel-body">
      {state.error?<div className="error">{state.error}</div>:null}

      <div className="model-status-summary" aria-label="Model coverage summary">
        <div><span>GAMES OBSERVED</span><strong>{state.loading?"—":totalGames}</strong></div>
        <div><span>PROJECTED</span><strong>{state.loading?"—":projected}</strong></div>
        <div><span>MARKET ATTACHED</span><strong>{state.loading?"—":marketReady}</strong></div>
        <div><span>FEED FAILURES</span><strong>{state.loading?"—":state.failures.length}</strong></div>
      </div>

      {grouped.map(group=><section key={group.sport} className="model-status-sport">
        <div className="canonical-section-heading">
          <h3>{group.sport.toUpperCase()}</h3>
          <span className="muted">{group.rows.length} games · {group.models.length} model{group.models.length===1?"":"s"}</span>
        </div>

        {!group.models.length&&!state.loading
          ? <div className="empty">No model output in the current window.</div>
          : null}

        <div className="model-status-grid">
          {group.models.map(model=><article className="model-status-card" key={group.sport+":"+model.id}>
            <header className="model-status-card-head">
              <div>
                <span className="model-status-sport-label">{group.sport.toUpperCase()}</span>
                <h4>{model.id}</h4>
              </div>
              <span className={"canonical-chip "+(model.status==="READY"?"canonical-chip-ok":"")}>{model.status}</span>
            </header>

            <div className="model-status-metrics">
              <div><span>PROJECTION COVERAGE</span><strong>{model.projected}/{model.games}</strong><small>{num(model.coverage*100)}%</small></div>
              <div><span>MARKET COVERAGE</span><strong>{model.marketReady}/{model.games}</strong><small>{num(model.marketCoverage*100)}%</small></div>
              <div><span>AVG DATA QUALITY</span><strong>{model.avgQuality==null?"—":num(model.avgQuality)}</strong><small>0–100</small></div>
              <div><span>MODEL STATE</span><strong>{model.maturity}</strong><small>governance</small></div>
            </div>

            <footer className="model-status-card-foot">
              <span>Next/current game: {fmtStart(model.nextStart)}</span>
              <span>Operational status only · no bet rating</span>
            </footer>
          </article>)}
        </div>
      </section>)}

      <div className="model-status-note">
        <strong>Decision-surface separation:</strong> game wagers belong on Board; player-prop wagers belong on Player Props; validation and challenger research belong in Model Lab.
      </div>
    </div>
  </section>;
}
