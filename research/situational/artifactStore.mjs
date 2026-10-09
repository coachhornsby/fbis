// Local write-once, content-addressed evidence; tamper-evident, not WORM storage.
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, verifySeal } from './marketEvidence.mjs';

export async function persistArtifact(directory, envelope) {
  if (!verifySeal(envelope)) throw new Error('INVALID_ARTIFACT');
  const key=envelope.kind === 'PROTOCOL' ? envelope.sha256 : envelope.payload.logicalKey;
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('INVALID_LOGICAL_KEY');
  const state=envelope.kind === 'GRADE' ? envelope.payload.status === 'PENDING' ? `pending-${envelope.sha256}-` : 'final-' : '';
  const path=join(directory,`${envelope.kind.toLowerCase()}-${state}${key}.json`), bytes=canonicalJson(envelope)+'\n';
  let file;
  try {
    file=await open(path,'wx',0o444);
    await file.writeFile(bytes); await file.sync();
    return {status:'CREATED',path,sha256:envelope.sha256};
  } catch (error) {
    if(error.code !== 'EEXIST') throw error;
    const existing=JSON.parse(await readFile(path,'utf8'));
    if (!verifySeal(existing) || existing.sha256 !== envelope.sha256) throw new Error('IMMUTABLE_ARTIFACT_CONFLICT');
    return {status:'ALREADY_PRESENT',path,sha256:envelope.sha256};
  } finally { if(file) await file.close(); }
}

export async function readArtifact(path) {
  const value=JSON.parse(await readFile(path,'utf8'));
  if(!verifySeal(value)) throw new Error('ARTIFACT_TAMPER_DETECTED');
  return value;
}
