#!/usr/bin/env node
// Local files only: no Cloudflare, provider, credential, or publication access.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {auditNflShadow} from './lib/nfl-shadow-evidence.mjs';
const [snapshotPath,evidencePath,gamesPath,seasonText]=process.argv.slice(2);
if(!snapshotPath||!evidencePath||!gamesPath||!/^20\d\d$/.test(seasonText||''))throw Error('Usage: node scripts/nfl-shadow-evidence.mjs SNAPSHOT EVIDENCE SLATE SEASON');
async function boundedRead(path,max){
 const file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const meta=await file.stat();
  if(!meta.isFile())throw Error('INPUT_NOT_REGULAR_FILE');
  if(meta.size>max)throw Error('INPUT_TOO_LARGE');
  const buffer=Buffer.alloc(max+1);let offset=0;
  while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  if(offset>max)throw Error('INPUT_TOO_LARGE');
  return buffer.subarray(0,offset).toString('utf8');
 }finally{await file.close();}
}
const report=auditNflShadow({snapshotText:await boundedRead(snapshotPath,8*1024*1024),
 evidence:JSON.parse(await boundedRead(evidencePath,65536)),games:JSON.parse(await boundedRead(gamesPath,65536)),season:Number(seasonText)});
console.log(JSON.stringify(report,null,2));
if(report.rows.some(row=>row.blocked.length))process.exitCode=2;
