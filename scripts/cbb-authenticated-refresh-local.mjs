// Secure runner only. Never copy credential values into arguments, source or handoff.
import fs from'node:fs';import path from'node:path';import{runCbbAuthenticatedRefresh}from'../functions/lib/cbbBoundedAuthenticatedRefresh.js';
const keys={cbbd:process.env.CBBD_API_KEY||process.env.CFBD_API_KEY,kenpom:process.env.KENPOM_API_KEY};
if(process.argv[2]==='--preflight'){
 console.log(JSON.stringify({kenpomConfigured:Boolean(keys.kenpom),collegeDataConfigured:Boolean(keys.cbbd),maximumRequests:2,networkCalls:0}));
}else{
 const [leaseFile,output]=process.argv.slice(2);if(!leaseFile||!output)throw Error('Supply lease JSON and NEW private output directory, or --preflight');
 const lease=JSON.parse(fs.readFileSync(leaseFile));
 const root=path.resolve(output);if(fs.existsSync(root))throw Error('OUTPUT_ALREADY_EXISTS');
 // Persistent private parent directory owns consumed-run markers across invocations.
 const claims=path.join(path.dirname(root),'.cbb-refresh-claims');
 const result=await runCbbAuthenticatedRefresh({lease,keys,
  claimOnce:async id=>{fs.mkdirSync(claims,{recursive:true,mode:0o700});try{const fd=fs.openSync(path.join(claims,id),'wx',0o600);fs.closeSync(fd);fs.mkdirSync(root,{mode:0o700});return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}},
  save:async(name,provider,bytes,metadata)=>{fs.writeFileSync(path.join(root,provider+'-'+name+'.json'),bytes,{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(root,provider+'-'+name+'-metadata.json'),JSON.stringify(metadata,null,2),{mode:0o600,flag:'wx'});}});
 if(fs.existsSync(root))fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({state:result.state,attempts:result.attempts,providers:result.records.map(r=>({provider:r.provider,status:r.status,rows:r.rows,error:r.error})),missing:result.missing}));
 if(result.state!=='CAPTURED')process.exitCode=2;
}
