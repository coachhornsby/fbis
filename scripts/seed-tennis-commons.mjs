#!/usr/bin/env node
// One-time operator-approved Commons media seed. Runs in GitHub Actions (not
// public browser); validates source-side metadata, then transfers verified JPEG
// bytes to FBIS through the HARVEST_SECRET-gated upload route.
import { createHash } from "node:crypto";
import { TENNIS_COMMONS_PORTRAIT_BATCH } from "../functions/lib/tennisCommonsPortraitBatch.js";

const secret=process.env.HARVEST_SECRET;
const endpoint="https://fbis-myz.pages.dev/api/tennis-portrait-import";
if(!secret||secret.length<24)throw new Error("HARVEST_SECRET unavailable; refusing image upload");
const normalized=s=>String(s||"").replaceAll("_"," ").normalize("NFKC").trim().toLowerCase();
const licenseUrl=s=>String(s||"").replace(/^http:/,"https:").replace(/\/?$/,"/");
const validHost=(link,hostnames)=>{try{const u=new URL(link);return u.protocol==="https:"&&hostnames.includes(u.hostname)&&!u.username&&!u.password;}catch{return false;}};
const fetchWithTimeout=async(url,opts={})=>{
  let response;
  for(let attempt=0;attempt<4;attempt++){
    response=await fetch(url,{...opts,signal:AbortSignal.timeout(25000)});
    if(response.status!==429||attempt===3)return response;
    await new Promise(resolve=>setTimeout(resolve,2200*(attempt+1)));
  }
  return response;
};
const results=[];

for(const c of TENNIS_COMMONS_PORTRAIT_BATCH){
  try{
    // Existing rights-approved R2 portraits need no repeat Wikimedia API fetch.
    // The authenticated importer is idempotent, but upstream queries are rate-limited.
    const existingUrl=new URL("https://fbis-myz.pages.dev/api/tennis-portrait");
    existingUrl.searchParams.set("id",c.playerId);
    const live=await fetchWithTimeout(existingUrl.href,{method:"GET"});
    const isAlreadyApproved=live.ok&&String(live.headers.get("content-type")||"").startsWith("image/jpeg");
    await live.body?.cancel();
    if(isAlreadyApproved){
      console.log(JSON.stringify({playerId:c.playerId,player:c.playerName,status:"ALREADY_REGISTERED",source:"LIVE_APPROVED_PORTRAIT"}));
      results.push({playerId:c.playerId,status:"ALREADY_REGISTERED"});
      continue;
    }
    await new Promise(resolve=>setTimeout(resolve,1000)); // spare Wikimedia upstream quota
    const api=new URL("https://commons.wikimedia.org/w/api.php");
    for(const [key,value] of Object.entries({action:"query",format:"json",formatversion:"2",prop:"imageinfo",iiprop:"url|mime|size|extmetadata",iiurlwidth:"720",titles:"File:"+c.fileTitle}))api.searchParams.set(key,value);
    const response=await fetchWithTimeout(api.href,{headers:{"user-agent":"FBIS-Tennis-CC-portrait-import/1.0 (GitHub coachhornsby/fbis; rights-verified image user)","accept":"application/json"}});
    if(!response.ok)throw Error("COMMONS_METADATA_HTTP_"+response.status);
    const data=await response.json();
    const page=data?.query?.pages?.[0]||{},info=page.imageinfo?.[0]||{},license=info.extmetadata||{};
    if(page.missing||normalized(page.title)!==normalized("File:"+c.fileTitle))throw Error("SOURCE_FILE_MISMATCH");
    const actualShort=String(license.LicenseShortName?.value||"").trim().toUpperCase().replace(/\s+/g," ");
    if(actualShort!==c.license.toUpperCase()&&!(c.license==="CC0 1.0"&&actualShort==="CC0"))throw Error("SOURCE_LICENSE_MISMATCH:"+actualShort);
    const verifiedLicense=licenseUrl(license.LicenseUrl?.value);
    const expectedLicense=licenseUrl(c.licenseUrl);
    const cc0Deed=c.license==="CC0 1.0"&&verifiedLicense==="https://creativecommons.org/publicdomain/zero/1.0/deed.en/";
    if(verifiedLicense!==expectedLicense&&!cc0Deed)throw Error("SOURCE_LICENSE_URL_MISMATCH");
    if(!String(license.Artist?.value||"").toLowerCase().includes(c.author.toLowerCase()))throw Error("SOURCE_ARTIST_MISMATCH");
    if(info.mime!=="image/jpeg")throw Error("SOURCE_NOT_JPEG");
    const thumbnail=info.thumburl||info.url;
    if(!validHost(thumbnail,["upload.wikimedia.org","thumb.wikimedia.org"])||!new URL(thumbnail).pathname.startsWith("/wikipedia/commons/"))throw Error("IMAGE_URL_NOT_TRUSTED");
    const pic=await fetchWithTimeout(thumbnail,{headers:{"user-agent":"FBIS-Tennis-CC-portrait-import/1.0 (GitHub coachhornsby/fbis)"}});
    if(!pic.ok)throw Error("IMAGE_HTTP_"+pic.status);
    const bytes=Buffer.from(await pic.arrayBuffer());
    if(bytes.length<300||bytes.length>5*1024*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error("IMAGE_SIGNATURE_INVALID");
    const upload=await fetchWithTimeout(endpoint,{method:"POST",headers:{"x-harvest-secret":secret,"content-type":"application/json"},body:JSON.stringify({
      playerId:c.playerId,fileTitle:c.fileTitle,licenseUrl:c.licenseUrl,
      imageSha256:createHash("sha256").update(bytes).digest("hex"),dataBase64:bytes.toString("base64")
    })});
    const result=await upload.json().catch(()=>({reason:"INVALID_IMPORT_RESPONSE"}));
    const status=result.status||result.reason||"UNKNOWN";
    console.log(JSON.stringify({playerId:c.playerId,player:c.playerName,http:upload.status,status,bytes:bytes.length,detail:result.detail||undefined}));
    results.push({playerId:c.playerId,http:upload.status,status});
  }catch(e){
    const message=String(e?.message||e).slice(0,170);
    console.log(JSON.stringify({playerId:c.playerId,player:c.playerName,status:"SOURCE_OR_TRANSFER_FAILED",reason:message}));
    results.push({playerId:c.playerId,status:"SOURCE_OR_TRANSFER_FAILED",reason:message});
  }
}
const counts={
  imported:results.filter(x=>x.status==="IMPORTED").length,
  already:results.filter(x=>x.status==="ALREADY_REGISTERED").length,
  rejected:results.filter(x=>x.status!=="IMPORTED"&&x.status!=="ALREADY_REGISTERED").length,
  total:results.length
};
console.log("TENNIS_COMMONS_SEED_SUMMARY "+JSON.stringify(counts));
if(counts.rejected>0)console.log("Rejected images remain silhouettes. Do not report manifest length as deployed coverage.");
