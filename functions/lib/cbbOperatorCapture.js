// One manually authorized capture. No schedule, model mutation or wager authority.
import {reserveCfbdRequest,completeCfbdRequest,cfbdRequestHash} from './cfbCfbdAcquisition.js';
import {recordApiUsage} from './collegeStore.js';
const encoder=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=async text=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
export const CAPTURE_REQUESTS=Object.freeze([
 ['cbbd','directory','https://api.collegebasketballdata.com/teams/directory?season=2027'],
 ['cbbd','roster','https://api.collegebasketballdata.com/teams/roster?season=2027'],
 ['cbbd','adjusted-current','https://api.collegebasketballdata.com/ratings/adjusted?season=2027'],
 ['cbbd','team-leaderboard','https://api.collegebasketballdata.com/stats/team/leaderboard?season=2027'],
 ['cbbd','game-teams-current','https://api.collegebasketballdata.com/games/teams?season=2027&startDateRange=2026-10-01T00:00:00Z&endDateRange=2026-11-02T23:59:59Z'],
 ['cbbd','adjusted-prior','https://api.collegebasketballdata.com/ratings/adjusted?season=2026'],
 ...['ratings','four-factors','pointdist','height','misc-stats','archive','teams'].map(e=>['kenpom',e,`https://kenpom.com/api.php?endpoint=${e}&y=2027${e==='archive'?'&preseason=true':''}`])
]);
const oldHashes=new Set(['38ccc7a77a83e4c026c1b05f7dfaae60175615cbb55a910b4356406ba79cd69c','b207f98dfb7e591d281c3f6af968f7601787219846e78e9d9badf11abd552fa7','2e48434689f4ae1b2740f50dad09c8e7be802af65596d14087197a8e48fe227e','66d959c4135839b9613c31ac76f843ff30fc662e1bb817ab56bf90cfe5a03fde','c3376124994ec07b888ed9b416ee3a811580fdd63498173fe417ee34b6915c42','9fcec5554c4a9d6f4d30c6bb112771a0959064b5e81101518d30fb937b5f5472']);
async function permit(env,url){
 const p=await reserveCfbdRequest({...env,cbbdCacheOnly:false,cbbdNetworkAuthorized:true},url);
 if(p.allowed)return p;
 const {hash:h,endpoint}=await cfbdRequestHash(url);
 if(!oldHashes.has(h))return p;
 // Reuse an already budgeted, explicitly identified, never-attempted reservation.
 // Atomic claim prevents a second isolate from consuming the same permit.
 const claim=await env.DB.prepare(`UPDATE cfb_cfbd_acquisition_receipts SET request_status='operator_claimed'
 WHERE request_day='2026-11-01' AND request_hash=? AND endpoint=? AND request_status='reserved' AND http_status IS NULL AND finished_at IS NULL
 AND (SELECT blocked_until_ms FROM cfb_cfbd_acquisition_control WHERE id=1)<=?
 AND (SELECT COALESCE(last_remaining,0) FROM cfb_cfbd_acquisition_control WHERE id=1)>100`).bind(h,endpoint,Date.now()).run();
 return Number(claim.meta?.changes)===1?{allowed:true,day:'2026-11-01',hash:h,endpoint}:p;
}
async function boundedRead(response,secrets){
 const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_BODY');
 let bytes=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8*1024*1024){await reader.cancel();throw Error('BYTE_LIMIT');}parts.push(value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
 const text=new TextDecoder().decode(all);if(secrets.some(s=>s&&text.includes(s)))throw Error('SECRET_IN_RESPONSE');
 const payload=JSON.parse(text);if(!Array.isArray(payload))throw Error('EXPECTED_ARRAY');
 const zipped=new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let i=0;i<zipped.length;i+=8192)binary+=String.fromCharCode(...zipped.subarray(i,i+8192));
 return {bytes,rows:payload.length,sha256:await hash(text),gzipB64:btoa(binary)};
}
export async function captureCbbProviders(request,env){
 const raw=env.FBIS_CBB_OPERATOR_LEASE;if(!raw)return new Response('Capture disabled',{status:410});
 let lease;try{lease=JSON.parse(raw);}catch{return new Response('Capture disabled',{status:410});}
 if(!lease.id||!Number.isFinite(Date.parse(lease.expiresAt))||Date.parse(lease.expiresAt)<=Date.now())return new Response('Capture expired',{status:410});
 if(request.method==='GET')return new Response('<!doctype html><meta name="referrer" content="no-referrer"><title>FBIS CBB operator capture</title><h1>FBIS CBB operator capture</h1><p>One capture; 13 requests maximum. Collection schedules remain paused.</p><form method="post"><label>One-time operator permit <input name="permit" type="password" autocomplete="off" required></label><button>Capture CBB inputs</button></form>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(Number(request.headers.get('content-length')||0)>1024)return new Response('Too large',{status:413});
 const body=await request.text();if(body.length>1024)return new Response('Too large',{status:413});
 const token=new URLSearchParams(body).get('permit');if(!token||await hash(token)!==lease.tokenSha256)return new Response('Unauthorized',{status:403});
 if(!env.DB?.prepare||!env.CBB_DB?.prepare)return new Response('Required storage unavailable',{status:503});
 const claim=await env.CBB_DB.prepare("INSERT OR IGNORE INTO cbb_provider_capture_runs (run_id,started_at,status) VALUES (?,?,'running')").bind(lease.id,new Date().toISOString()).run();
 if(Number(claim.meta?.changes)!==1)return new Response('This capture permit was already consumed',{status:409});
 const keys={cbbd:env.CBBD_API_KEY||env.CFBD_API_KEY,kenpom:env.KENPOM_API_KEY},secrets=Object.values(keys).filter(Boolean),records=[];let attempts=0,stopCbbd=false,stopKenpom=false;
 for(const [provider,name,url]of CAPTURE_REQUESTS){
  if(Date.parse(lease.expiresAt)<=Date.now())break;
  if(!keys[provider]||(provider==='cbbd'?stopCbbd:stopKenpom)){records.push({provider,name,status:0,reason:keys[provider]?'PROVIDER_STOPPED':'KEY_MISSING',networkAttempted:false});continue;}
  let auth=null;if(provider==='cbbd'){auth=await permit(env,url);if(!auth.allowed){records.push({provider,name,status:0,reason:auth.reason,networkAttempted:false});continue;}}
  let status=0,response=null,captured=null,error=null;const observedAt=new Date().toISOString();
  try{attempts++;response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${keys[provider]}`,Accept:'application/json','User-Agent':'FBIS-CBB/3.0'}});status=response.status;
   if(response.ok)captured=await boundedRead(response,secrets);else await response.body?.cancel();
  }catch(e){error=String(e?.message||e).slice(0,100);if(secrets.some(s=>error.includes(s)))error='REDACTED_PROVIDER_ERROR';}
  if(provider==='cbbd'){
   await completeCfbdRequest(env,auth,status,response);
   await recordApiUsage(env,{source:'cbbd',endpoint:new URL(url).pathname,capturedAt:observedAt,httpStatus:status,quotaCost:1,ok:Boolean(captured),recordsReturned:captured?.rows||0,cacheHit:false});
   const rem=response?.headers.get('X-CallLimit-Remaining');if(!/^\d+$/.test(rem||'')||Number(rem)<=106||[401,402,403,429].includes(status)||status===0)stopCbbd=true;
  }else if([401,402,403,429].includes(status)||status===0)stopKenpom=true;
  const meta={provider,name,url,status,observedAt,networkAttempted:true,remaining:response?.headers.get('X-CallLimit-Remaining')||null,error,rows:captured?.rows||0,bytes:captured?.bytes||0,sha256:captured?.sha256||null};
  await env.CBB_DB.prepare('INSERT INTO cbb_provider_input_snapshots (run_id,source_key,metadata_json,payload_gzip_b64) VALUES (?,?,?,?)').bind(lease.id,provider+':'+name,JSON.stringify(meta),captured?.gzipB64||null).run();records.push(meta);
 }
 const summary={runId:lease.id,attempts,records,projectionReady:false,automaticCollectorsPaused:true};
 await env.CBB_DB.prepare("UPDATE cbb_provider_capture_runs SET status='finished',summary_json=? WHERE run_id=?").bind(JSON.stringify(summary),lease.id).run();
 return Response.json(summary,{headers:{'Cache-Control':'no-store'}});
}
