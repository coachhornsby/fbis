import {tennisClassification} from '../../lib/tennisTourView.js';
import SportGlyph from './SportGlyph.jsx';
export default function TourCardFrame({game,children}){
 const c=tennisClassification(game);
 return <div className={`tour-card-wrap tour-${c.tour||'unknown'}`}><div className="tour-card-kicker"><SportGlyph sport={c.tour||'atp'}/><strong>{c.label}</strong><span>{c.level}</span><small>{c.format}</small></div>{children}{['away','home'].some(side=>game[side]?.portrait)?<details className="tour-photo-credits"><summary>Photo credits</summary>{['away','home'].map(side=>{const team=game[side],p=team?.portrait;return p?<p key={side}>{team.fullName||team.name} · {p.credit||'Approved player portrait'} {p.sourceUrl?<a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>:null} {p.licenseUrl?<a href={p.licenseUrl} target="_blank" rel="noopener noreferrer">License</a>:null}</p>:null;})}</details>:null}</div>;
}
