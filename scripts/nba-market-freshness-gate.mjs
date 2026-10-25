#!/usr/bin/env node
// Read-only NBA market freshness receipt. A successful D1 query is NOT fresh data.
import {writeFile,mkdir} from "node:fs/promises";
import {pathToFileURL} from "node:url";
export function evaluateNbaMarketFreshness(row,{now=new Date(),maxAgeHours=12}={}){
 const captured=Date.parse(row?.latest_capture||"");
 const ageHours=Number.isFinite(captured)?(now.getTime()-captured)/3600000:null;
 const reasons=[];
 if(!Number.isFinite(captured))reasons.push("NO_NBA_MARKET_SNAPSHOTS");
 else if(ageHours<0)reasons.push("FUTURE_MARKET_TIMESTAMP");
 else if(ageHours>maxAgeHours)reasons.push("NBA_MARKETS_STALE");
 if(Number(row?.snapshots||0)<=0)reasons.push("NO_MARKET_ROWS");
 return {ok:reasons.length===0,status:reasons.length?"BLOCKED":"HEALTHY",
  latestCapture:row?.latest_capture||null,ageHours,maxAgeHours,
  snapshots:Number(row?.snapshots||0),distinctGames:Number(row?.distinct_games||0),
  reasons,canAuthorizeWager:false};
}
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 const db=process.env.CLOUDFLARE_D1_DATABASE_ID;
 if(!account||!token||db!=="ed992525-d2ed-4b1d-8a12-feeb2efa152c")throw Error("NBA_DB_READONLY_CREDENTIALS_REQUIRED");
 const sql="SELECT COUNT(*) AS snapshots,COUNT(DISTINCT game_id) AS distinct_games,MAX(captured_at) AS latest_capture FROM odds_snapshots WHERE sport='nba'";
 const resp=await fetch("https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database/"+db+"/query",
  {method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},
  body:JSON.stringify({sql}),signal:AbortSignal.timeout(25000)});
 if(!resp.ok)throw Error("NBA_MARKET_READ_HTTP_"+resp.status);
 const raw=await resp.json();
 if(raw.success!==true||raw.result?.[0]?.success!==true||!raw.result?.[0]?.results?.[0]||
   raw.result?.[0]?.meta?.changed_db===true||Number(raw.result?.[0]?.meta?.rows_written||0)!==0)
   throw Error("NBA_MARKET_READ_FAILED_CLOSED");
 const r=evaluateNbaMarketFreshness(raw.result[0].results[0]);
 await mkdir("artifacts",{recursive:true});
 await writeFile("artifacts/nba-market-freshness.json",JSON.stringify({...r,measuredAt:new Date().toISOString(),database:"NBA_DB"},null,2)+"\n");
 console.log(JSON.stringify(r));
 if(!r.ok)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{console.error(e.message);process.exitCode=1});
