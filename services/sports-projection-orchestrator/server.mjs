import http from 'node:http';
import crypto from 'node:crypto';
import {healthSummary,validateModels,validateSheetsAccess,selectCandidates,processQueue,runSnapshot} from './orchestrator.mjs';

const port=Number(process.env.PORT||10000);
const token=process.env.ORCH_CONTROL_TOKEN||'';
const oidcAudience=process.env.GITHUB_OIDC_AUDIENCE||'sports-projection-orchestrator';
const allowedRepo=process.env.GITHUB_OIDC_REPOSITORY||'coachhornsby/fbis';
let jwksCache={at:0,keys:[]};

function json(res,status,obj){
  const payload=JSON.stringify(obj);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(payload),'cache-control':'no-store'});
  res.end(payload);
}
function decodePart(part){
  return JSON.parse(Buffer.from(part,'base64url').toString('utf8'));
}
async function githubJwks(){
  if(jwksCache.keys.length && Date.now()-jwksCache.at<15*60*1000) return jwksCache.keys;
  const res=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{
    headers:{'user-agent':'sports-projection-orchestrator'}
  });
  if(!res.ok) throw new Error('GitHub OIDC JWKS '+res.status);
  const body=await res.json();
  jwksCache={at:Date.now(),keys:Array.isArray(body.keys)?body.keys:[]};
  return jwksCache.keys;
}
async function verifyGithubOidc(jwt){
  try{
    const parts=String(jwt||'').split('.');
    if(parts.length!==3) return false;
    const header=decodePart(parts[0]), claims=decodePart(parts[1]);
    if(header.alg!=='RS256'||!header.kid) return false;
    if(claims.iss!=='https://token.actions.githubusercontent.com') return false;
    const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(!aud.includes(oidcAudience)) return false;
    if(String(claims.repository||'')!==allowedRepo) return false;
    if(!String(claims.ref||'').startsWith('refs/heads/')) return false;
    const now=Math.floor(Date.now()/1000);
    if(Number(claims.exp||0)<=now || Number(claims.nbf||0)>now+30) return false;
    const keys=await githubJwks();
    const jwk=keys.find(k=>k.kid===header.kid);
    if(!jwk) return false;
    const key=crypto.createPublicKey({key:jwk,format:'jwk'});
    const signed=Buffer.from(parts[0]+'.'+parts[1]);
    const signature=Buffer.from(parts[2],'base64url');
    const ok=crypto.verify('RSA-SHA256',signed,key,signature);
    if(!ok) return false;
    return {
      repository:claims.repository,
      ref:claims.ref,
      workflow:claims.workflow||null,
      workflow_ref:claims.workflow_ref||null,
      run_id:claims.run_id||null,
      actor:claims.actor||null,
    };
  }catch{
    return false;
  }
}
async function authorization(req){
  const auth=String(req.headers.authorization||'');
  const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(token && (bearer===token || req.headers['x-orch-token']===token)) return {type:'control-token'};
  if(bearer){
    const gh=await verifyGithubOidc(bearer);
    if(gh) return {type:'github-oidc',claims:gh};
  }
  return false;
}
async function body(req){
  let s='';
  for await(const chunk of req){ s+=chunk; if(s.length>2_000_000) throw new Error('body too large'); }
  return s?JSON.parse(s):{};
}
async function processQueueFailClosed(){
  const health=healthSummary();
  const missing=Object.entries(health.credentials).filter(([k,v])=>k!=='googleCredentialParseError'&&!v).map(([k])=>k);
  if(missing.length){
    return {ok:true,processed:0,status:'BLOCKED_FAIL_CLOSED',reason:'runtime_credentials_incomplete',missing,at:new Date().toISOString()};
  }
  return {ok:true,status:'EXECUTED',...(await processQueue())};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,healthSummary());
    const auth=await authorization(req);
    if(!auth) return json(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/api/validate/sheets') return json(res,200,await validateSheetsAccess());
    if(req.method==='POST'&&url.pathname==='/api/validate/models') return json(res,200,await validateModels());
    if(req.method==='POST'&&url.pathname==='/api/select-candidates'){
      const payload=await body(req);
      return json(res,200,{auth:auth.type,...(await selectCandidates({dryRun:payload.dryRun===true}))});
    }
    if(req.method==='POST'&&url.pathname==='/api/process-queue') return json(res,200,{auth:auth.type,...(await processQueueFailClosed())});
    if(req.method==='POST'&&url.pathname==='/api/run-snapshot'){
      const payload=await body(req);
      return json(res,200,await runSnapshot(payload.snapshot||payload,{persist:payload.persist!==false}));
    }
    return json(res,404,{error:'not found'});
  }catch(e){
    json(res,500,{error:String(e.message||e),providerResults:e.providerResults||undefined});
  }
});
server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_started',port,health:healthSummary()})));
