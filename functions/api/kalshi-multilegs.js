// Read-only public research snapshot. Never requests Kalshi from a Board visitor.
const root="player-props/kalshi/v1/";
export async function onRequestGet({env}){
 const json=(value,status=200)=>Response.json(value,{status,headers:{"cache-control":"public, max-age=20","x-robots-tag":"noindex"}});
 if(!env?.ARCHIVE?.get)return json({ok:false,code:"ARCHIVE_MISSING"},503);
 const load=async k=>{try{const x=await env.ARCHIVE.get(root+k);return x?await x.json():null}catch{return null}};
 const [snap,receipt]=await Promise.all([load("multi-snapshot.json"),load("multi-status.json")]);
 const now=Date.now(),age=Date.parse(snap?.capturedAt||"");
 const fresh=Number.isFinite(age)&&age<=now&&now-age<=2*3600000;
 const records=snap?.paginationComplete===true&&Array.isArray(snap.records)&&fresh?snap.records.slice(0,500):[];
 return json({ok:true,provider:"Kalshi",mode:"MVE_PUBLIC_RESEARCH",snapshotStatus:!snap?"NOT_CAPTURED":!fresh?"STALE":"COMPLETE",
  lastAttemptAt:receipt?.attemptedAt||null,lastAttemptState:receipt?.status||"NOT_OBSERVED",
  paginationComplete:!!(fresh&&snap?.paginationComplete===true),records,
  rfqQuoteVerified:false,canQualify:false,canAuthorizeWager:false});
}
export async function onRequestPost(){return Response.json({ok:false,code:"READ_ONLY"},{status:405})}
