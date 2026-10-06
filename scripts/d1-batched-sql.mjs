#!/usr/bin/env node
import fs from "node:fs/promises";

const sqlFile=process.argv[2];
if(!sqlFile)throw new Error("usage: node scripts/d1-batched-sql.mjs <sql-file>");
const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw new Error("missing Cloudflare credentials");
const wrangler=await fs.readFile("wrangler.toml","utf8");
const dbId=process.env.CLOUDFLARE_D1_DATABASE_ID||wrangler.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!dbId)throw new Error("D1 database_id unavailable");
const batchSize=Math.max(1,Math.min(200,Number(process.env.D1_SQL_BATCH_STATEMENTS||60)));
const attempts=Math.max(1,Math.min(12,Number(process.env.D1_SQL_ATTEMPTS||8)));
const raw=await fs.readFile(sqlFile,"utf8");

function statements(text){
  const out=[];let cur="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];cur+=ch;
    if(ch==="'"){
      if(quoted&&text[i+1]==="'"){cur+=text[++i];continue}
      quoted=!quoted;continue;
    }
    if(ch===";"&&!quoted){
      if(cur.trim())out.push(cur.trim());
      cur="";
    }
  }
  if(cur.trim())out.push(cur.trim());
  return out;
}
const stmts=statements(raw);
if(!stmts.length){console.log(JSON.stringify({ok:true,file:sqlFile,statements:0,batches:0}));process.exit(0)}
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`;
let batches=0;
for(let offset=0;offset<stmts.length;offset+=batchSize){
  const batch=stmts.slice(offset,offset+batchSize).join("\n");
  let ok=false,last=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const r=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({sql:batch})});
      const body=await r.json().catch(()=>null);
      const resultOk=r.ok&&body?.success===true&&(!Array.isArray(body?.result)||body.result.every(x=>x?.success!==false));
      if(resultOk){ok=true;break}
      last=new Error(`D1 HTTP ${r.status}: ${JSON.stringify(body)?.slice(0,900)}`);
    }catch(e){last=e}
    const delay=Math.min(120,attempt*15);
    process.stderr.write(`D1 batch ${batches+1} attempt ${attempt}/${attempts} failed; retry in ${delay}s: ${last?.message||last}\n`);
    await new Promise(r=>setTimeout(r,delay*1000));
  }
  if(!ok)throw last||new Error(`D1 batch ${batches+1} failed`);
  batches++;
  process.stderr.write(`D1 batch ${batches} applied (${Math.min(offset+batchSize,stmts.length)}/${stmts.length} statements)\n`);
  if(offset+batchSize<stmts.length)await new Promise(r=>setTimeout(r,1000));
}
console.log(JSON.stringify({ok:true,file:sqlFile,statements:stmts.length,batches,batchSize}));
