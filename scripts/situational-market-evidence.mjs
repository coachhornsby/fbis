#!/usr/bin/env node
// Offline only: no HTTP, D1/R2 bindings, provider credentials or production writers.
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adaptPopulation, movement, registerProtocol, candidateSnapshot, researchGrade, summarizeGrades, reproduceAdapter, canonicalJson } from '../research/situational/marketEvidence.mjs';
import { persistArtifact, readArtifact } from '../research/situational/artifactStore.mjs';

const [command,inputPath,outputDirectory]=process.argv.slice(2);
try {
  if(!['adapt','movement','register','candidate','grade','summary'].includes(command) || !inputPath) throw new Error('Usage: node scripts/situational-market-evidence.mjs <adapt|movement|register|candidate|grade|summary> input.json [local-artifact-directory]');
  const input=JSON.parse(await readFile(resolve(inputPath),'utf8'));
  let result;
  if(command==='adapt') result=adaptPopulation(input.records,input.contexts);
  if(command==='movement') result=movement(input.results);
  // Live clock cannot be overridden by an input field. Fixed-clock injection exists
  // only in library unit tests; CLI never restamps older observations as prospective.
  if(command==='register') result=registerProtocol(input);
  if(command==='candidate') result=candidateSnapshot({game:input.game,adapted:reproduceAdapter(input.adapterInput),protocol:await readArtifact(resolve(input.protocolPath)),codeSha:input.codeSha});
  if(command==='grade') result=researchGrade(await readArtifact(resolve(input.candidatePath)),input.outcome,input.evaluation);
  if(command==='summary') result=summarizeGrades(await readArtifact(resolve(input.protocolPath)),await Promise.all(input.candidatePaths.map(p=>readArtifact(resolve(p)))),await Promise.all(input.gradePaths.map(p=>readArtifact(resolve(p)))));
  if(outputDirectory) {
    if(!['register','candidate','grade'].includes(command)) throw new Error('ONLY_SEALED_ARTIFACTS_MAY_BE_PERSISTED');
    const dir=resolve(outputDirectory);await mkdir(dir,{recursive:true});result=await persistArtifact(dir,result);
  }
  process.stdout.write(canonicalJson(result)+'\n');
} catch(error) { process.stderr.write(error.message+'\n');process.exitCode=1; }
