import http from 'node:http';

const port = Number(process.env.PORT || 10000);
const payload = JSON.stringify({
  status: 'retired',
  platform: 'render',
  replacement: 'https://fbis-orchestrator.coachhornsby.workers.dev',
  message: 'Sports Projection Orchestrator moved to Cloudflare Workers.'
});

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(410, {'content-type':'application/json','cache-control':'no-store'});
    res.end(payload);
    return;
  }
  res.writeHead(410, {'content-type':'application/json','cache-control':'no-store'});
  res.end(payload);
}).listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({event:'render_orchestrator_retired',port}));
});
