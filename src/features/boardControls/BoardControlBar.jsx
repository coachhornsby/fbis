import SportGlyph from './SportGlyph.jsx';
const SPORTS=[['all','All'],['nfl','NFL'],['cfb','CFB'],['nba','NBA'],['cbb','CBB'],['mlb','MLB'],['nhl','NHL'],['atp','ATP'],['wta','WTA']];
const FILTERS=[['all','All'],['scheduled','Pregame'],['live','Live'],['final','Final'],['qualified','Qualified'],['leans','Leans']];
export default function BoardControlBar({date,onDate,onToday,onShift,selected,onSelect,counts,bucket,onBucket,loading,stale,error,lastSuccessAt,onRefresh,onImport,onCopy,canCopy,copyStatus,children}){
 const at=lastSuccessAt?new Date(lastSuccessAt):null;
 const updated=at&&Number.isFinite(+at)?at.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}):null;
 const label=loading?'Refreshing':stale||error?(updated?'Cached · refresh failed':'Load failed'):updated?`Updated ${updated}`:'Awaiting data';
 const displayDate=new Date(`${date}T12:00:00Z`);
 return <section className="fbis-board-controls" aria-label="Board controls">
  <div className="bc-heading"><div><h2>FBIS BOARD</h2><p>{Number.isFinite(+displayDate)?displayDate.toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'long',day:'numeric',year:'numeric'}):date}<span> · {counts.all??0} games</span></p></div>
   <button className={`bc-refresh ${stale||error?'is-stale':''}`} onClick={onRefresh} disabled={loading} aria-label={`Refresh board. ${label}`}><span className={loading?'is-spinning':''} aria-hidden="true">↻</span><small>{label}</small></button>
  </div>
  <div className="bc-date-actions"><div className="bc-date"><button onClick={()=>onShift(-1)} aria-label="Previous day">‹</button><label><span className="sr-only">Board date in Central time</span><input aria-label="Board date in Central time" type="date" value={date} onChange={e=>onDate(e.target.value)}/></label><button onClick={()=>onShift(1)} aria-label="Next day">›</button><button onClick={onToday}>Today</button></div>
   <details className="bc-actions"><summary>Actions <span aria-hidden="true">⌄</span></summary><div className="bc-action-menu">
    {onImport?<button onClick={onImport}>Import Bet Slip</button>:null}<button onClick={onCopy} disabled={!canCopy}>Copy ChatGPT Review</button><button onClick={onRefresh} disabled={loading}>Retry Failed Load</button>
    <details className="bc-operator"><summary>Operator Pipeline Health</summary>{children}</details>
   </div></details>
  </div>
  {copyStatus?<p className="bc-copy-status" role="status">{copyStatus}</p>:null}
  <nav className="bc-sports" aria-label="Board sports and tours">{SPORTS.map(([id,label])=><button key={id} onClick={()=>onSelect(id)} className={selected===id?'is-selected':''} aria-pressed={selected===id} aria-label={`${id==='all'?'All Sports':label}${counts[id]!=null?` · ${counts[id]} games`:''}`}><SportGlyph sport={id}/><span>{label}</span>{counts[id]!=null?<small>{counts[id]}</small>:null}</button>)}</nav>
  <div className="bc-filters" role="group" aria-label="Game status">{FILTERS.map(([id,label])=><button key={id} onClick={()=>onBucket(id)} aria-pressed={bucket===id} className={bucket===id?'is-selected':''}>{label}</button>)}</div>
 </section>;
}
