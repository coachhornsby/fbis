#!/usr/bin/env node
// Offline only. The controlled archive writer publishes this small manifest;
// this utility has no Cloudflare, Drive, provider or model credentials.
import {stat,readFile,writeFile} from 'node:fs/promises';
import {buildStreamRosterManifest} from '../services/polymarket-us-stream/boundedSession.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/build-bounded-stream-roster.mjs candidates.json roster.json');
if((await stat(input)).size>2097152)throw Error('ROSTER_INPUT_EXCEEDS_2MB');
const value=JSON.parse(await readFile(input,'utf8'));
const manifest=buildStreamRosterManifest(Array.isArray(value)?value:value.roster);
await writeFile(output,JSON.stringify(manifest)+'\n',{flag:'wx'});
console.log(JSON.stringify({selected:manifest.roster.length,complete:manifest.complete,expiresAt:manifest.expiresAt,coverage:manifest.coverage}));
