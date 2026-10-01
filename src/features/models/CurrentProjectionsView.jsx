import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";

const CORE = ["cfb","nfl","nhl"];
function shift(date,days){ const [y,m,d]=String(date).split("-").map(Number); const x=new Date(Date.UTC(y,m-1,d)); x.setUTCDate(x.getUTCDate()+days); return x.toISOString().slice(0,10); }
function datesFor(sport,date){ if(sport==="cfb") return [date,shift(date,1),shift(date,2)]; if(sport==="nfl") return [date,shift(date,1),shift(date,2),shift(date,3)]; return [date]; }
function score(v){ return v==null?"—":Number(v).toFixed(1); }
function kickoff(iso){ if(!iso)return "—"; return new Date(iso).toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }

export default function CurrentProjectionsView({date,sportFilter="all"}){
  const sports=useMemo(()=>CORE.includes(sportFilter)?[sportFilter]:CORE,[sportFilter]);
  const [state,setState]=useState({loading:true,error:"",rows:[]});

  useEffect(()=>{
    let cancelled=false;
    setState({loading:true,error:"",rows:[]});
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
        }catch(e){ return {ok:false,sport:job.sport,date:job.date,error:String(e?.message||e),games:[]}; }
      }));
      if(cancelled)return;
      const seen=new Set(),rows=[];
      for(const pack of settled) for(const g of pack.games){
        const key=pack.sport+":"+String(g.id);
        if(seen.has(key))continue; seen.add(key);
        rows.push({...g,sport:pack.sport,slateDate:pack.date});
      }
      rows.sort((a,b)=>String(a.start||"").localeCompare(String(b.start||"")));
      const failures=settled.filter(x=>!x.ok);
      setState({loading:false,error:failures.length===settled.length?failures.map(x=>x.sport+" "+x.date+": "+x.error).join(" · "):"",rows});
    })();
    return()=>{cancelled=true};
  },[date,sports]);

  const grouped=useMemo(()=>sports.map(s=>({sport:s,rows:state.rows.filter(r=>r.sport===s)})),[sports,state.rows]);

  return <section className="panel panel-board">
    <div className="panel-header">
      <div>
        <h2>CURRENT FBIS PROJECTIONS</h2>
        <div className="muted">Direct projection feed · independent model output · CT</div>
      </div>
      <span className="last-updated">{state.loading?"Loading…":state.rows.length+" games"}</span>
    </div>
    <div className="panel-body">
      {state.error?<div className="error">{state.error}</div>:null}
      {grouped.map(group=><div key={group.sport} style={{marginBottom:18}}>
        <div className="canonical-section-heading">
          <h3>{group.sport.toUpperCase()} · {group.rows.length}</h3>
        </div>
        {!group.rows.length&&!state.loading?<div className="empty">No projection rows in the current window.</div>:null}
        <div className="current-projection-grid">
          {group.rows.map(g=>{
            const p=g.projection||{}, m=g.market||{}, unavailable=p.home==null||p.away==null;
            return <article className="current-projection-card" key={group.sport+":"+g.id}>
              <div className="current-projection-card-head">
                <span>{kickoff(g.start)}</span>
                <span className={"canonical-chip "+(unavailable?"":"canonical-chip-ok")}>{unavailable?"UNAVAILABLE":String(g.model?.maturity||p.maturity||"PROJECTION")}</span>
              </div>
              <div className="current-projection-matchup">
                <div><TeamLogo team={g.away} size={34}/><b>{g.away?.abbr||g.away?.name||"AWAY"}</b><strong>{score(p.away)}</strong></div>
                <div><TeamLogo team={g.home} size={34}/><b>{g.home?.abbr||g.home?.name||"HOME"}</b><strong>{score(p.home)}</strong></div>
              </div>
              <div className="current-projection-meta">
                <span>FBIS TOTAL <b>{score(p.total)}</b></span>
                <span>MARKET <b>{m.spread==null?"—":m.spread}</b></span>
                <span>TOTAL <b>{m.total==null?"—":m.total}</b></span>
              </div>
              <div className="muted small">{g.model?.engine||g.model?.name||"FBIS"} · Q{g.quality?.score??"—"}</div>
            </article>;
          })}
        </div>
      </div>)}
    </div>
  </section>;
}
