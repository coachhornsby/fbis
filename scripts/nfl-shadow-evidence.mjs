#!/usr/bin/env node
// Local files only: no Cloudflare, provider, credential, or publication access.
import {readFile,stat} from 'node:fs/promises';
import {auditNflShadow} from './lib/nfl-shadow-evidence.mjs';
const [snapshotPath,evidencePath,gamesPath,seasonText]=process.argv.slice(2);
if(!snapshotPath||!evidencePath||!gamesPath||!/^20\d\d$/.test(seasonText||''))throw Error('Usage: node scripts/nfl-shadow-evidence.mjs SNAPSHOT EVIDENCE SLATE SEASON');
async function boundedRead(path,max){if((await stat(path)).size>max)throw Error('INPUT_TOO_LARGE');return readFile(path,'utf8');}
const report=auditNflShadow({snapshotText:await boundedRead(snapshotPath,8*1024*1024),
 evidence:JSON.parse(await boundedRead(evidencePath,65536)),games:JSON.parse(await boundedRead(gamesPath,65536)),season:Number(seasonText)});
console.log(JSON.stringify(report,null,2));
if(report.rows.some(row=>row.blocked.length))process.exitCode=2;
