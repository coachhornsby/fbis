import {processQueue,healthSummary} from './orchestrator.mjs';

const health=healthSummary();
console.log(JSON.stringify({event:'cron_start',health}));

if(!health.credentials.openai || !health.credentials.gemini || !health.credentials.googleSheets){
  console.log(JSON.stringify({
    event:'cron_blocked_fail_closed',
    reason:'runtime_credentials_incomplete',
    credentials:health.credentials
  }));
  process.exit(0);
}

try{
  const result=await processQueue();
  console.log(JSON.stringify({event:'cron_complete',result}));
}catch(e){
  console.error(JSON.stringify({event:'cron_failed',error:String(e.message||e),providerResults:e.providerResults||null}));
  process.exitCode=1;
}
