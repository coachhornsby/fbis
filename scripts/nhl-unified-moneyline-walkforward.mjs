#!/usr/bin/env node
/**
 * Offline NHL full-game ML research. Requires historical *immutable pregame*
 * three-head snapshots; refuses reconstructed/postgame-only predictions.
 *
 * node scripts/nhl-unified-moneyline-walkforward.mjs
 *   --input=/path/immutable-nhl-triple-head-games.json
 *   --train=20212022,20222023 --validation=20232024 --test=20242025,20252026
 *   --out=/tmp/nhl-unified-ml-research.json
 */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {dirname} from "node:path";
import {evaluateNhlUnifiedWalkforward} from "../functions/lib/nhlUnifiedMoneylineResearch.js";

const arg = name => process.argv.find(x=>x.startsWith("--"+name+"="))?.slice(name.length+3)||null;
const input=arg("input"),out=arg("out");
if(!input||!out||!arg("train")||!arg("validation")||!arg("test")){
  console.error("Missing required --input, --out, --train, --validation, --test; no live/retrospective fallback permitted.");
  process.exitCode=2;
}else{
  const raw=JSON.parse(await readFile(input,"utf8"));
  const rows=Array.isArray(raw)?raw:raw.immutablePregameSnapshots;
  if(!Array.isArray(rows))throw Error("IMMUTABLE_PREGAME_SNAPSHOTS_ARRAY_REQUIRED");
  const split=name=>arg(name).split(",").map(s=>s.trim()).filter(Boolean);
  const result=evaluateNhlUnifiedWalkforward(rows,{trainSeasons:split("train"),
    validationSeasons:split("validation"),testSeasons:split("test")});
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(result,null,2)+"\n","utf8");
  console.log(JSON.stringify({status:result.status,train:result.split.trainN,
    validation:result.split.validationN,test:result.split.testN,
    selectedByValidation:result.selectedByValidation,
    allThreeTest:result.test.allThree.metrics,
    incumbentTest:result.test.incumbent.metrics},null,2));
}
