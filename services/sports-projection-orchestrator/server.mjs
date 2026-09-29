import http from 'node:http';

const port=Number(process.env.PORT||10000);
const server=http.createServer((_req,res)=>{
  const payload=JSON.stringify({
    status:'retired',
    replacement:'Cloudflare fbis-orchestrator',
    retiredAt:'2026-09-29T16:00:00Z'
  });
  res.writeHead(410,{
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(payload),
    'cache-control':'no-store'
  });
  res.end(payload);
});
server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'render_orchestrator_retired',port})));
