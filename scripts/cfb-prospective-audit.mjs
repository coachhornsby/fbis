#!/usr/bin/env node
/** Offline CFB PIT research scoreboard. Expects verified immutable ledger rows as JSON or JSONL.
 * No network, provider credits, production writes, qualification or wager authorization. */
import {readFile,writeFile} from "node:fs/promises";
import {gradeCfbFrozenRows,cfbErrorSegments,cfbTotalDispersionAudit,compareCfbTotalShadows} from "../functions/lib/cfbProspectiveAudit.js";
const [input,output]=process.argv.slice(2);
if(!input){console.error("Usage: node scripts/cfb-prospective-audit.mjs frozen-rows.jsonl [report.json]");process.exitCode=2;}
else {
 try{
 const raw=await readFile(input,"utf8");const lines=raw.trim();
 const rows=lines.startsWith("[")?JSON.parse(lines):lines.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 if(!Array.isArray(rows))throw new Error("Expected array of frozen ledger rows");
 const scores=gradeCfbFrozenRows(rows);
 const report={version:"cfb-pit-scoreboard-v1",source:input,generatedAt:new Date().toISOString(),
  summary:scores.metrics,rejected:scores.rejected,byGame:scores.byGame,
  segments:cfbErrorSegments(rows),dispersion:cfbTotalDispersionAudit(rows),
  shadows:compareCfbTotalShadows(rows,{incumbent:r=>Number(r.projHome)+Number(r.projAway),
   ppaBaseTotal:r=>r.baseTotal}),
  governance:{researchOnly:true,automaticPromotion:false,canQualify:false,canAuthorizeWager:false},
  limitations:["Snapshot cutoff and feature provenance must be independently attested","Do not treat retrospective market quotes as executable bets"]};
 const body=JSON.stringify(report,null,2)+"\n";
 if(output)await writeFile(output,body);else process.stdout.write(body);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
