import { createHash } from 'node:crypto';
import { parseTmlCsv } from './tennismylife.js';
const DEFAULT_BASE='https://stats.tennismylife.org';
const REQUIRED=['tourney_name','tourney_date','winner_name','loser_name','score'];
const sha256=s=>createHash('sha256').update(s).digest('hex');
export async function listTmlDataFiles({baseUrl=DEFAULT_BASE,fetchImpl=fetch}={}){
 const retrievedAt=new Date().toISOString();
 const r=await fetchImpl(`${baseUrl}/api/data-files`,{headers:{accept:'application/json'}});
 if(!r.ok) throw new Error(`TML data-files HTTP ${r.status}`);
 const ct=String(r.headers?.get?.('content-type')||'').toLowerCase();
 if(ct && !ct.includes('json')) throw new Error(`TML data-files non-JSON content-type ${ct}`);
 const j=await r.json(); if(!Array.isArray(j.files)) throw new Error('TML data-files response missing files[]');
 return j.files.map(f=>({name:String(f.name||''),url:String(f.url||''),size:Number.isFinite(Number(f.size))?Number(f.size):null,updatedAt:f.updatedAt||f.updated_at||null,manifestRetrievedAt:retrievedAt})).filter(f=>f.name&&f.url);
}
export function classifyTmlFile(name){
 const n=String(name).toLowerCase();
 if(/atp_quali\//.test(n)||/atp[_-]?quali/.test(n)) return 'ATP_QUALIFYING';
 if(/challenger/.test(n)||/ch_ongoing_tourney\.csv$/.test(n)) return /ongoing/.test(n)?'CHALLENGER_ONGOING':'CHALLENGER';
 if(/ongoing_tourneys/.test(n)&&!/wta/.test(n)) return 'ATP_ONGOING';
 if(/(^|\/)20(1[5-9]|2[0-6])\.csv$/.test(n)&&!/wta/.test(n)) return 'ATP_TOUR';
 return 'OTHER';
}
function validateCsvPayload(text,file){
 const s=String(text||''); if(!s.trim()) throw new Error(`TML file ${file.name} is empty`);
 const lead=s.trimStart().slice(0,256).toLowerCase();
 if(lead.startsWith('<!doctype html')||lead.startsWith('<html')||lead.includes('<body')) throw new Error(`TML file ${file.name} returned HTML/error content`);
 const header=s.split(/\r?\n/,1)[0].replace(/^\uFEFF/,'');
 const cols=header.split(',').map(x=>x.replace(/^"|"$/g,'').trim());
 for(const k of REQUIRED) if(!cols.includes(k)) throw new Error(`TML file ${file.name} schema drift: missing ${k}`);
 return {bytes:Buffer.byteLength(s),headerHash:sha256(header),header};
}
export async function fetchTmlCanonicalFile(file,{fetchImpl=fetch,ingestedAt=new Date().toISOString()}={}){
 const r=await fetchImpl(file.url,{headers:{accept:'text/csv,text/plain;q=0.9,*/*;q=0.1'}});
 if(!r.ok) throw new Error(`TML file ${file.name} HTTP ${r.status}`);
 const text=await r.text(); const payload=validateCsvPayload(text,file);
 if(file.size!=null && file.size===0) throw new Error(`TML manifest reports zero-byte file ${file.name}`);
 const observations=parseTmlCsv(text,{source:'tennismylife',sourceFile:file.name,ingestedAt,sourceUpdatedAt:file.updatedAt});
 if(!observations.length) throw new Error(`TML file ${file.name} has zero valid observations`);
 return {observations,payload};
}
export async function acquireTmlCanonical({baseUrl=DEFAULT_BASE,fetchImpl=fetch,include=(f)=>classifyTmlFile(f.name)!=='OTHER'}={}){
 const retrievedAt=new Date().toISOString();
 const files=(await listTmlDataFiles({baseUrl,fetchImpl})).filter(include); if(!files.length) throw new Error('TML manifest has no eligible Tennis files');
 const observations=[],manifest=[];
 for(const f of files){
   const got=await fetchTmlCanonicalFile(f,{fetchImpl,ingestedAt:retrievedAt}); const rows=got.observations;
   observations.push(...rows);
   manifest.push({...f,kind:classifyTmlFile(f.name),actualBytes:got.payload.bytes,headerHash:got.payload.headerHash,rowCount:rows.length,
     observations:rows.length,latest:rows.reduce((m,x)=>(x.matchDate||'')>m?(x.matchDate||''):m,''),retrievedAt});
 }
 return {observations,manifest,retrievedAt};
}
export default {listTmlDataFiles,classifyTmlFile,fetchTmlCanonicalFile,acquireTmlCanonical};
