import './mlbPlayerIntelligence.css';
import { useEffect,useState } from 'react';
const labels={runs:'Runs',homeRuns:'Home runs',strikeOuts:'Strikeouts',hits:'Hits',avg:'AVG',obp:'OBP',slg:'SLG',ops:'OPS',plateAppearances:'Plate appearances',rbi:'RBIs',era:'ERA',whip:'WHIP',inningsPitched:'Innings',gamesStarted:'Starts'};
export default function MlbPlayerIntelligence({player,onClose}) {
 const [market,setMarket]=useState(player.position==='P'?'strikeouts':'hits'),[data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');fetch(`/api/mlb-player-intelligence?${new URLSearchParams({playerId:player.id,market})}`,{signal:c.signal}).then(async r=>{const b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'Player unavailable');return b;}).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[player.id,market]);
 return <section className="stp-panel mpi-profile" aria-label="MLB player intelligence"><header className="mpi-heading"><div><span className="mpi-eyebrow">PLAYER STATISTICS</span><h3>{player.name}</h3></div><button className="mpi-close" type="button" onClick={onClose}>Close player</button></header>
 <label>Game statistic <select value={market} onChange={e=>setMarket(e.target.value)}>{[['hits','Hits'],['total_bases','Total bases'],['home_runs','Home runs'],['runs','Runs'],['rbis','RBIs'],['hits_runs_rbis','Hits + runs + RBIs'],['strikeouts','Pitcher strikeouts'],['pitcher_outs','Pitcher outs']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading official player history…</p>:<>
 <p>{data.player.primaryPosition?.name} · Bats {data.player.batSide?.description||'—'} · Throws {data.player.pitchHand?.description||'—'} · {data.player.height} · {data.player.weight} lb</p>
 <p>{data.player.birthDate} · MLB debut {data.player.mlbDebutDate||'—'} · Official ID {player.id}</p>
 <h4>{data.history.historyScope==='POSTSEASON'?'Postseason form':'Regular-season form'} · {data.history.last5?.length||0} appearances</h4>
 <div className="stp-table-scroll"><table><thead><tr><th>Date</th><th>Opponent</th><th>Round</th><th>Value</th><th>Game</th></tr></thead><tbody>{(data.history.last5||[]).map(g=><tr key={g.gameId}><td>{g.date}</td><td>{g.opponent}</td><td>{g.gameTypeLabel}</td><td><strong>{g.value}</strong></td><td><a href={g.sourceUrl} target="_blank" rel="noreferrer">{g.gameId}</a></td></tr>)}</tbody></table></div>
 {!data.history.available?<p>No verified appearances in this scope.</p>:null}
 <h4>Season statistics</h4>{(data.player.stats||[]).map((block,i)=><div key={i}><h5>{block.group?.displayName}</h5><dl className="mpi-metrics">{Object.entries(block.splits?.[0]?.stat||{}).filter(([key])=>Object.hasOwn(labels,key)).map(([k,v])=><div key={k}><dt>{labels[k]}</dt><dd>{String(v)}</dd></div>)}</dl></div>)}
 <p className="stp-muted">Official MLB statistics · Retrieved {new Date(data.sourceFetchedAt).toLocaleString()}</p>
 </>}
 </section>;
}
