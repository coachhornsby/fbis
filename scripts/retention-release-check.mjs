#!/usr/bin/env node
/** Evaluate a retention release proposal. Blocks deletion without verified recovery. */
import {readFile} from 'node:fs/promises';
import {evaluateRetentionRelease,retentionGateRecord} from '../functions/lib/retentionGate.js';

const path=process.argv[2];
if(!path){
  console.error('Usage: node scripts/retention-release-check.mjs <proposal.json>');
  process.exit(2);
}
const proposal=JSON.parse(await readFile(path,'utf8'));
const evaluation=evaluateRetentionRelease(proposal);
const record=retentionGateRecord(proposal,evaluation);
console.log(JSON.stringify({evaluation,record},null,2));
if(!evaluation.authorized)process.exitCode=1;
