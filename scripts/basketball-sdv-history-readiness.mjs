#!/usr/bin/env node
import {createReadStream,writeFileSync} from "node:fs";
import {createGunzip} from "node:zlib";
import {createInterface} from "node:readline";
import {createBasketballHistoricalReadiness} from "../functions/lib/basketballSdvHistoricalReadiness.js";
const sport=process.argv[2],targetSeason=Number(process.argv[3]),
 input=process.argv[4],asOf=new Date().toISOString();
if(!input)throw Error("BASKETBALL_READINESS_VERIFIED_SOURCE_FILE_REQUIRED");
const run=createBasketballHistoricalReadiness({sport,targetSeason,asOf});
const stream=createInterface({input:createReadStream(input).pipe(createGunzip()),
 crlfDelay:Infinity});
let sourceLines=0;
for await (const line of stream){
 if(!line.trim())continue;
 sourceLines++;
 if(sourceLines>25000)throw Error("BASKETBALL_READINESS_SOURCE_EXCEEDS_LIMIT");
 run.accept(JSON.parse(line));
}
const result={...run.summary(),sourceLines,generatedAt:new Date().toISOString()};
const path=input.replace(/-verified-games\.jsonl\.gz$/,"-team-readiness.json");
if(path===input)throw Error("BASKETBALL_READINESS_OUTPUT_PATH_INVALID");
writeFileSync(path,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({sport,targetSeason,sourceLines,
 acceptedGames:result.acceptedGames,distinctTeams:result.distinctTeams,
 historyReadyTeams:result.historyReadyTeams,unreadyTeams:result.unreadyTeams,
 sourceFirstObservedAt:result.sourceFirstObservedAt,
 canQualify:false,canAuthorizeWager:false},null,2));
if(result.acceptedGames===0||result.acceptedPossessions===0)process.exitCode=2;
