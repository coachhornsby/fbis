import http from 'node:http';
import {healthSummary,validateModels,validateSheetsAccess,processQueue,runSnapshot} from './orchestrator.mjs';

const port=Number(process.env.PORT||10000);
const token=process.env.ORCH_CONTROL_TOKEN||'';

function json(res,status,obj){
  const body=JSON.stringify(obj);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});
  res.end(body);
}
function authorized(req){
  if(!token) return false;
  const auth=req.headers.authorization||'';
  const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
  return bearer===token || req.headers['x-orch-token']===token;
}
async function body(req){
  let s='';
  for await(const chunk of req){ s+=chunk; if(s.length>2_000_000) throw new Error('body too large'); }
  return s?JSON.parse(s):{};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,healthSummary());
    if(!authorized(req)) return json(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/api/validate/sheets') return json(res,200,await validateSheetsAccess());
    if(req.method==='POST'&&url.pathname==='/api/validate/models') return json(res,200,await validateModels());
    if(req.method==='POST'&&url.pathname==='/api/process-queue') return json(res,200,await processQueue());
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
