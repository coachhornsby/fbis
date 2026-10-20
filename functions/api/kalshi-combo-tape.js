// Read-only sampled Combo Tape. Never call upstream from visitor requests.
export async function onRequestGet({env}){
 const root="player-props/kalshi/v1/";
 const read=async k=>{try{const x=await env?.ARCHIVE?.get?.(root+k);return x?await x.json():null}catch{return null}};
 const [snap,status]=await Promise.all([read("combo-tape.json"),read("combo-tape-status.json")]);
 const rows=Array.isArray(snap?.records)?snap.records.filter(r=>r?.canAuthorizeWager===false).slice(0,200):[];
 return Response.json({ok:true,provider:"Kalshi",mode:"SAMPLED_PUBLIC_COMBO_TRADES",
  coverage:"BOUNDED_ROUND_ROBIN_NOT_COMPLETE_LIVE_TAPE",capturedAt:snap?.capturedAt||null,
  state:status?.status||"NOT_OBSERVED",lastAttemptAt:status?.attemptedAt||null,
  lastErrorCode:status?.code||null,records:rows,canQualify:false,canAuthorizeWager:false},{
   headers:{"cache-control":"public, max-age=20","x-robots-tag":"noindex"}});
}
export async function onRequestPost(){return Response.json({ok:false,code:"READ_ONLY"},{status:405})}
