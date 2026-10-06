#!/usr/bin/env node
import fs from "node:fs/promises";

const sql=process.argv.slice(2).join(" ").trim();
if(!sql)throw new Error("usage: node scripts/d1-query-json.mjs <sql>");
const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw new Error("missing Cloudflare credentials");
const wrangler=await fs.readFile("wrangler.toml","utf8");
const dbId=process.env.CLOUDFLARE_D1_DATABASE_ID||wrangler.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!dbId)throw new Error("D1 database_id unavailable");
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`;
const attempts=Math.max(1,Math.min(12,Number(process.env.D1_QUERY_ATTEMPTS||10)));
let last=null;
for(let attempt=1;attempt<=attempts;attempt++){
  try{
    const r=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({sql})});
    const body=await r.json().catch(()=>null);
    const ok=r.ok&&body?.success===true&&Array.isArray(body?.result)&&body.result.every(x=>x?.success!==false);
    if(ok){process.stdout.write(JSON.stringify(body.result));process.exit(0)}
    last=new Error(`D1 HTTP ${r.status}: ${JSON.stringify(body)?.slice(0,900)}`);
  }catch(e){last=e}
  const delay=Math.min(90,attempt*10);
  process.stderr.write(`D1 query attempt ${attempt}/${attempts} failed; retry in ${delay}s: ${last?.message||last}\n`);
  await new Promise(r=>setTimeout(r,delay*1000));
}
throw last||new Error("D1 query failed");
