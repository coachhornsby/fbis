import {pathToFileURL} from 'node:url';
export async function verifyMlbCompletionApi({fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=24}={}){
 for(let i=0;i<attempts;i++){
  try{const response=await fetchImpl('https://fbis-myz.pages.dev/api/mlb-completion',{signal:AbortSignal.timeout(30000)}),body=await response.json();if(response.ok&&body.ok===true&&body.prospectiveReport?.version==='mlb-completion-v1')return {ok:true,contract:'mlb-completion-v1'};}catch{}
  if(i+1<attempts)await sleep(10000);
 }
 throw Error('COMPATIBLE_MLB_COMPLETION_API_REQUIRED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await verifyMlbCompletionApi()));
