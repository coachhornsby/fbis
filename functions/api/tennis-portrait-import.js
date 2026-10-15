// Operator-only, *fixed-manifest* Wikimedia Commons import. No arbitrary URL input.
// This route is executed by the one-time GitHub production release step with HARVEST_SECRET.
// Every write requires an exact canonical ID + live Commons license verification.
import { tennisCommonsPortraitCandidate } from "../lib/tennisCommonsPortraitBatch.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}});
const norm=s=>String(s||"").normalize("NFKC").replaceAll("_"," ").trim().toLowerCase();
const canonicalLicense=s=>String(s||"").replace(/^http:/,"https:").replace(/\/?$/,"/");
const hostIs=(value,expected)=>{try{const x=new URL(value);return x.protocol==="https:"&&x.hostname===expected&&!x.username&&!x.password;}catch{return false;}};
const noStore = {cache:"no-store",redirect:"error"};
export async function onRequestPost({request,env}){
  // Never expose image ingestion on a public unauthenticated web route.
  const secret=String(env?.HARVEST_SECRET||"");
  if(secret.length<24||request.headers.get("x-harvest-secret")!==secret)return json({ok:false,reason:"UNAUTHORIZED"},403);
  if(!env?.DB?.prepare||!env?.ARCHIVE?.put)return json({ok:false,reason:"STORAGE_UNAVAILABLE"},503);
  let input;
  try {input=await request.json();} catch {return json({ok:false,reason:"INVALID_BODY"},400);}
  const id=String(input?.playerId||"");
  const candidate=tennisCommonsPortraitCandidate(id);
  if(!candidate)return json({ok:false,reason:"NOT_CURATED"},404);
  try{
    const player=await env.DB.prepare("SELECT fbis_player_id,canonical_name FROM tennis_players WHERE fbis_player_id=?").bind(id).first();
    if(player?.fbis_player_id!==id||norm(player?.canonical_name)!==norm(candidate.playerName))return json({ok:false,reason:"PLAYER_IDENTITY_MISMATCH"},409);
    const existing=await env.DB.prepare("SELECT fbis_player_id,approval_status,source_reference FROM tennis_player_portraits WHERE fbis_player_id=?").bind(id).first();
    if(existing)return json({ok:true,status:"ALREADY_REGISTERED",playerId:id,approval:existing.approval_status});
    let bytes;
    // Alternative verified source transfer: GitHub Actions obtains Commons license
    // metadata and image using its own network, then sends bytes over authenticated
    // HTTPS. The source URL/author/license remain fixed by this curated manifest.
    if(typeof input?.dataBase64==="string"){
      if(input.fileTitle!==candidate.fileTitle||input.licenseUrl!==candidate.licenseUrl)
        return json({ok:false,reason:"SOURCE_MANIFEST_MISMATCH"},409);
      if(!/^[a-f0-9]{64}$/.test(String(input.imageSha256||""))||input.dataBase64.length>7*1024*1024)
        return json({ok:false,reason:"SOURCE_BYTES_INVALID"},422);
      const binary=atob(input.dataBase64);
      bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      const hex=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
      if(hex!==input.imageSha256)return json({ok:false,reason:"IMAGE_CHECKSUM_MISMATCH"},422);
    }else{
      // Legacy live-check path remains for manual operator use where Commons
      // API is reachable from Cloudflare; no arbitrary URL is accepted.
      const api=new URL("https://commons.wikimedia.org/w/api.php");
      for(const [k,v] of Object.entries({action:"query",format:"json",formatversion:"2",prop:"imageinfo",iiprop:"url|mime|size|extmetadata",iiurlwidth:"720",titles:"File:"+candidate.fileTitle}))api.searchParams.set(k,v);
      const metadataResponse=await fetch(api.href,{...noStore,headers:{"accept":"application/json","user-agent":"FBIS-personal-portrait-import/1.0 (licensed Commons media)"}});
      if(!metadataResponse.ok)return json({ok:false,reason:"COMMONS_METADATA_UNAVAILABLE",http:metadataResponse.status},502);
      const metadata=await metadataResponse.json();
      const item=metadata?.query?.pages?.[0]||{}, info=item?.imageinfo?.[0]||{}, license=info.extmetadata||{};
      if(item.missing||norm(item.title)!==norm("File:"+candidate.fileTitle))return json({ok:false,reason:"COMMONS_FILE_MISMATCH"},409);
      const liveShort=String(license.LicenseShortName?.value||"").trim().toUpperCase().replace(/\\s+/g," ");
      const expectedShort=candidate.license.toUpperCase();
      const licenseUrl=canonicalLicense(license.LicenseUrl?.value||"");
      if(liveShort!==expectedShort&&!(expectedShort==="CC0 1.0"&&liveShort==="CC0"))return json({ok:false,reason:"COMMONS_LICENSE_MISMATCH",license:liveShort},409);
      if(licenseUrl!==canonicalLicense(candidate.licenseUrl))return json({ok:false,reason:"COMMONS_LICENSE_URL_MISMATCH"},409);
      const artist=String(license.Artist?.value||"");
      if(candidate.author&&!artist.toLowerCase().includes(candidate.author.toLowerCase()))return json({ok:false,reason:"COMMONS_AUTHOR_MISMATCH"},409);
      const thumbnail=info.thumburl||info.url;
      if(!hostIs(thumbnail,"upload.wikimedia.org")||!new URL(thumbnail).pathname.startsWith("/wikipedia/commons/"))return json({ok:false,reason:"COMMONS_IMAGE_HOST_REJECTED"},409);
      if(info.mime!=="image/jpeg")return json({ok:false,reason:"SOURCE_MIME_NOT_JPEG"},409);
      const photoResponse=await fetch(thumbnail,{...noStore,headers:{accept:"image/jpeg"}});
      if(!photoResponse.ok)return json({ok:false,reason:"COMMONS_IMAGE_UNAVAILABLE",http:photoResponse.status},502);
      const reportedLength=Number(photoResponse.headers.get("content-length")||"0");
      if(reportedLength>5*1024*1024)return json({ok:false,reason:"IMAGE_TOO_LARGE"},413);
      bytes=new Uint8Array(await photoResponse.arrayBuffer());
    }
    const signature=new Uint8Array(bytes);
    if(bytes.byteLength<300||bytes.byteLength>5*1024*1024||signature[0]!==0xff||signature[1]!==0xd8||signature[2]!==0xff)
      return json({ok:false,reason:"NOT_VALID_JPEG"},422);
    const key=`tennis/portraits/${id}/commons-curated-20261015.jpg`;
    const credit=`Photo: ${candidate.author} · ${candidate.license} · resized for FBIS`;
    await env.ARCHIVE.put(key,bytes,{httpMetadata:{contentType:"image/jpeg"},customMetadata:{source:"WIKIMEDIA_COMMONS",license:candidate.license,playerId:id}});
    const now=new Date().toISOString();
    const write=await env.DB.prepare(`INSERT INTO tennis_player_portraits
      (fbis_player_id,asset_key,content_type,source_name,source_reference,attribution_text,display_scope,approval_status,public_display_allowed,rights_evidence_ref,approved_at,expires_at,reviewed_by)
      VALUES (?,?,?,'WIKIMEDIA_COMMONS',?,?,'PUBLIC_WEB','APPROVED',1,?, ?,NULL,'FBIS_CURATED_COMMONS_BATCH_20261015')
      ON CONFLICT(fbis_player_id) DO NOTHING`).bind(id,key,"image/jpeg",candidate.sourceUrl,credit,candidate.licenseUrl,now).run();
    if(write?.meta?.changes!==1)return json({ok:false,reason:"DATABASE_INSERT_NOT_CONFIRMED"},503);
    return json({ok:true,status:"IMPORTED",playerId:id,player:player.canonical_name,bytes:bytes.byteLength,license:candidate.license,source:candidate.sourceUrl});
  }catch(e){return json({ok:false,reason:"IMPORT_FAILED",detail:String(e?.message||e).slice(0,160)},503);}
}
