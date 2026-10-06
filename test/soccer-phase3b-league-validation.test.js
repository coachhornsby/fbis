import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function asian(win,push,loss){
  return {"-0.5":{win,push:0,loss:1-win},"0":{win,push,loss:1-win-push},"0.5":{win,push:0,loss:1-win}};
}
function row(i){
  const h=i%3===0?2:1,a=i%4===0?1:0,o=h>a?"H":h<a?"A":"D";
  const p2={H:.50,D:.27,A:.23},p3={H:.54,D:.25,A:.21};
  const brier=p=>((p.H-(o==="H"?1:0))**2+(p.D-(o==="D"?1:0))**2+(p.A-(o==="A"?1:0))**2)/3;
  const ll=p=>-Math.log(Math.max(1e-12,p[o]));
  return {
    league:"eng.1",id:"m"+i,date:new Date(Date.parse("2024-08-01T00:00:00Z")+i*86400000).toISOString().slice(0,10),season:"2024/2025",
    homeTeam:"Alpha",awayTeam:"Beta",homeScore:h,awayScore:a,outcome:o,
    v2Home:p2.H,v2Draw:p2.D,v2Away:p2.A,v3Home:p3.H,v3Draw:p3.D,v3Away:p3.A,
    v2Pick:"H",v3Pick:"H",v2Brier:brier(p2),v3Brier:brier(p3),v2LogLoss:ll(p2),v3LogLoss:ll(p3),
    v2HomeGoals:1.35,v2AwayGoals:.95,v3HomeGoals:1.5,v3AwayGoals:.85,
    v2BttsProb:.48,v3BttsProb:.44,v2O25Prob:.47,v3O25Prob:.45,
    v2AsianCore:asian(.50,.25,.25),v3AsianCore:asian(.54,.24,.22),
    v2GoalMae:.7,v3GoalMae:.6,v2TotalMae:.8,v3TotalMae:.7,
    v2BttsBrier:.25,v3BttsBrier:.24,v2O25Brier:.25,v3O25Brier:.24,
    v2AsianBrier:.23,v3AsianBrier:.22,scoreLayerActive:true
  };
}

test("Phase 3B analyzer emits league metrics, stability, classification and bounded evidence",()=>{
  const dir=mkdtempSync(join(tmpdir(),"soccer-phase3b-"));
  const input=join(dir,"rows.jsonl"),out=join(dir,"report.json"),evidence=join(dir,"evidence.json");
  writeFileSync(input,Array.from({length:120},(_,i)=>JSON.stringify(row(i))).join("\n")+"\n");
  execFileSync(process.execPath,["scripts/soccer-phase3b-league-validation.mjs",input,out,evidence],{
    cwd:process.cwd(),env:{...process.env,GITHUB_SHA:"test-sha",SOCCER_VALIDATION_SNAPSHOT:"test-snapshot"},stdio:"ignore"
  });
  const report=JSON.parse(readFileSync(out,"utf8"));
  const ev=JSON.parse(readFileSync(evidence,"utf8"));
  const epl=report.leagues["eng.1"];
  assert.equal(report.codeSha,"test-sha");
  assert.equal(report.snapshotId,"test-snapshot");
  assert.equal(report.researchOnly,true);
  assert.equal(report.canQualify,false);
  assert.equal(report.canAuthorize,false);
  assert.equal(report.persistentStateUsed,false);
  assert.equal(epl.n,120);
  assert.ok(Number.isFinite(epl.v2.oneX2.brier));
  assert.ok(Number.isFinite(epl.v3.goals.homeGoalMae));
  assert.ok(Number.isFinite(epl.v3.goals.awayGoalMae));
  assert.ok(Number.isFinite(epl.v3.goals.totalGoalBias));
  assert.ok(Number.isFinite(epl.v3.btts.ece));
  assert.ok(Number.isFinite(epl.v3.totals25.bias));
  assert.equal(epl.v3.asian.coreLines["0"].n,120);
  assert.ok(epl.stability.bySeason["2024/2025"]);
  assert.ok(epl.stability.latest50);
  assert.notEqual(epl.classification,"INSUFFICIENT_EVIDENCE");
  assert.equal(ev.rows.length,150);
  assert.ok(ev.rows.some(r=>r.heritageKey==="eng.1"&&r.marketFamily==="ASIAN_HANDICAP"&&r.lineKey==="0"));
  assert.ok(ev.rows.some(r=>r.heritageKey==="eng.1"&&r.marketFamily==="STABILITY"));
});

test("Phase 3B workflow preserves bounded research governance",()=>{
  const workflow=readFileSync(".github/workflows/soccer-v3-walkforward.yml","utf8");
  const api=readFileSync("functions/api/soccer-validation-evidence.js","utf8");
  const migration=readFileSync("migrations/0067_soccer_phase3b_validation_provenance.sql","utf8");
  assert.match(workflow,/soccer-phase3b-league-validation\.mjs/);
  assert.match(workflow,/phase3b-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow,/soccer-phase3b-evidence\.json/);
  assert.match(api,/snapshotId/);
  assert.match(api,/codeSha/);
  assert.match(api,/researchOnly:true,canQualify:false,canAuthorize:false/);
  assert.match(migration,/snapshot_id/);
  assert.match(migration,/code_sha/);
});
