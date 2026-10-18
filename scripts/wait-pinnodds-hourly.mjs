import {createGitHubOidcProvider} from './github-oidc.mjs';
const token=createGitHubOidcProvider();
for(let attempt=0;attempt<60;attempt++){
 try{const r=await fetch('https://fbis-orchestrator.coachhornsby.workers.dev/api/pinnodds-capture',{headers:{authorization:'Bearer '+await token()},signal:AbortSignal.timeout(15000)});const x=await r.json();if(r.status===405&&x.footballHourly===true){console.log('HOURLY_FOOTBALL_CAPABILITY_READY');process.exit(0);}}catch{}
 await new Promise(r=>setTimeout(r,5000));
}
throw Error('HOURLY_FOOTBALL_CAPABILITY_UNAVAILABLE');
