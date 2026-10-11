import {canonicalJson} from './cfbForwardEvidence.js';
import {sha256Hex} from './sha256Hex.js';
const production='b50c724c-903b-4241-8ce1-48d931e7a44c';
export async function appendForwardShadow({db,databaseId,mode,snapshot}){
 if(mode!=='nonproduction'||!databaseId||databaseId===production)throw Error('Forward pilot refuses production');
 if(!Number.isFinite(Date.parse(snapshot.decision_at))||!Number.isFinite(Date.parse(snapshot.event_start_at))||snapshot.can_authorize_wager!==false||snapshot.can_qualify!==false||Date.parse(snapshot.decision_at)>=Date.parse(snapshot.event_start_at))throw Error('Invalid shadow authority or cutoff');
 const {id,...body}=snapshot;
 if(sha256Hex(canonicalJson(body))!==id)throw Error('Snapshot content identity mismatch');
 const raw=canonicalJson(snapshot),hash=sha256Hex(raw);
 await db.prepare('INSERT INTO cfb_forward_snapshots(id,game_id,decision_at,event_start_at,content_hash,body_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,snapshot.game_id,snapshot.decision_at,snapshot.event_start_at,hash,raw).run();
 const existing=await db.prepare('SELECT content_hash,body_json FROM cfb_forward_snapshots WHERE id=?').bind(id).first();
 if(existing?.content_hash!==hash||existing?.body_json!==raw)throw Error('Immutable snapshot conflict');
 return {id,insertedOrVerified:true,canAuthorizeWager:false};
}
