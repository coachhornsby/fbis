// Same-origin delivery for rights-verified ATP/WTA player images.
// Never scrape ATP/WTA, proxy arbitrary URLs or expose unapproved R2 objects.
import { approvedTennisPortraits, tennisPortraitUrl } from "../lib/tennisPortraits.js";
const unavailable = (status=404) => new Response(null,{status,headers:{
  "cache-control":"no-store","x-content-type-options":"nosniff"
}});
export async function onRequestGet({request,env}) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!tennisPortraitUrl(id)) return unavailable(400);
  if (!env?.DB?.prepare || !env?.ARCHIVE?.get) return unavailable(503);
  const portraits = await approvedTennisPortraits(env.DB,[id]);
  const photo = portraits.get(id);
  if (!photo) return unavailable();
  try {
    const object = await env.ARCHIVE.get(photo.assetKey);
    if (!object?.body || !Number.isFinite(object.size) || object.size <= 0 || object.size > 8*1024*1024) return unavailable();
    const storedType = object.httpMetadata?.contentType || photo.contentType;
    if (storedType !== photo.contentType) return unavailable();
    const maxAge = photo.expiresAt
      ? Math.max(0,Math.min(120,Math.floor((Date.parse(photo.expiresAt)-Date.now())/1000)))
      : 120;
    return new Response(object.body,{status:200,headers:{
      "content-type":photo.contentType,
      "content-length":String(object.size),
      "cache-control":`public, max-age=${maxAge}`,
      "x-content-type-options":"nosniff",
      "cross-origin-resource-policy":"same-origin",
      ...(object.httpEtag ? {"etag":object.httpEtag} : {}),
    }});
  } catch {return unavailable(503);}
}
