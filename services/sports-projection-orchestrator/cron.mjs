import {processQueue,healthSummary} from './orchestrator.mjs';
try{
  console.log(JSON.stringify({event:'cron_start',health:healthSummary()}));
  const result=await processQueue();
  console.log(JSON.stringify({event:'cron_complete',result}));
}catch(e){
  console.error(JSON.stringify({event:'cron_failed',error:String(e.message||e),providerResults:e.providerResults||null}));
  process.exitCode=1;
}
