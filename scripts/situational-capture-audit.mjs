#!/usr/bin/env node
// Local JSON only. No external acquisition, persistence or authority activation.
import { readFile } from 'node:fs/promises';
import { captureAuditJson } from '../research/situational/captureReadiness.mjs';
import { canonicalJson } from '../research/situational/marketEvidence.mjs';
try{if(process.argv.length!==3)throw new Error('Usage: node scripts/situational-capture-audit.mjs LOCAL_INPUT.json');const input=JSON.parse(await readFile(process.argv[2],'utf8'));process.stdout.write(canonicalJson(captureAuditJson(input))+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
