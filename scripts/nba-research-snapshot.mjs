// Usage: node scripts/nba-research-snapshot.mjs authorized-local-input.json
// Prints research output only. Does not fetch, persist or publish data.
import { readFile } from 'node:fs/promises';
import { projectNbaResearchSnapshot } from '../functions/lib/nbaResearchContext.js';
if(process.argv.length!==3) throw new Error('Supply one existing local JSON snapshot');
const result=projectNbaResearchSnapshot(JSON.parse(await readFile(process.argv[2],'utf8')));
process.stdout.write(JSON.stringify(result,null,2)+'\n');
