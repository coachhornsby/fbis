/** Private operational readback of fully verified retrospective CFB roster R2 data.
 * Not exposed on public team cards, decision pipeline, or model inputs.
 */
import {harvestSecret} from "../lib/auth.js";
import {readVerifiedCfbColdRosterPage} from "../lib/cfbColdRosterArchive.js";
const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
};
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers});
export async function onRequestGet(context) {
  // Header-only. Never accept operator tokens from URLs or browser origins.
  const secret=harvestSecret(context.env);
  const received=context.request.headers?.get("x-harvest-secret");
  if (!secret || received!==secret) return json({ok:false,error:"FORBIDDEN"},403);
  const u=new URL(context.request.url);
  const season=u.searchParams.get("season")||"2004";
  const afterRowid=u.searchParams.get("afterRowid")||"0";
  const limit=u.searchParams.get("limit")||"100";
  if (!/^\d{4}$/.test(season) || season!=="2004" ||
      !/^\d{1,15}$/.test(afterRowid) || !/^\d{1,3}$/.test(limit) ||
      Number(limit)<1 || Number(limit)>100) return json({ok:false,error:"INVALID_ARCHIVE_READ_SCOPE"},400);
  try {
    const loader=context.coldRosterReader||readVerifiedCfbColdRosterPage;
    const result=await loader(context.env,{
      season:Number(season),afterRowid:Number(afterRowid),limit:Number(limit),
    });
    return json({ok:true,...result},200);
  } catch (e) {
    // Never return a partial or unverified archive in place of D1.
    return json({ok:false,error:"ARCHIVE_READBACK_UNAVAILABLE",
      status:"FAIL_CLOSED",readOnly:true},503);
  }
}
export async function onRequestPost(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
