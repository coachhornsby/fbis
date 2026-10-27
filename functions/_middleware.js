// Emergency freeze: no downstream handlers, databases or providers are invoked.
export async function onRequest() {
 return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FBIS paused</title><body style="background:#101827;color:#fff;font:18px system-ui;padding:12vh 8vw"><h1>FBIS is paused</h1><p>Live data collection and analysis are offline while operating costs are reviewed.</p></body></html>', {status:503,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','retry-after':'86400','x-fbis-state':'COST_STOP_20261027'}});
}
