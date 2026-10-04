#!/usr/bin/env node
import fs from "node:fs";
import { buildDynamicSkillProfile, boxImpactPrior, fitRegularizedRapm, combinePlayerImpact } from "../functions/lib/nbaPlayerImpact.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/nba-canonical.jsonl";
const stintsFile=args.stints||"artifacts/nba-lineup-stints.jsonl";
const out=args.out||"artifacts/nba-player-impact-v1.json";
const cutoff=args.cutoff||null;
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const games=read(gamesFile).filter(g=>!cutoff||Date.parse(g.start||g.date)<Date.parse(cutoff));
const stints=read(stintsFile).filter(s=>!cutoff||Date.parse(s.date)<Date.parse(cutoff));
const hist=new Map(),teamByPlayer=new Map(),nameByPlayer=new Map(),positionByPlayer=new Map();
for(const g of games)for(const p of g.players||[]){
  const id=String(p.id||p.name||"");if(!id)continue;
  if(!hist.has(id))hist.set(id,[]);
  hist.get(id).push({...p,date:g.start||g.date,teamPossessions:g.possessions});
  teamByPlayer.set(id,String(p.teamId||""));nameByPlayer.set(id,p.name||id);positionByPlayer.set(id,p.position||null);
}
const prior={};
for(const [id,rows] of hist){const skill=buildDynamicSkillProfile(rows,{asOf:cutoff});const p=boxImpactPrior(skill);if(p)prior[id]=p}
const rapm=fitRegularizedRapm(stints,{priorByPlayer:prior,lambda:Number(args.lambda||900),priorStrength:Number(args.priorStrength||.35)});
const players={};
for(const [id,rows] of hist){
  const impact=combinePlayerImpact({playerId:id,history:rows,stints,rapm,asOf:cutoff});
  if(impact.ok)players[id]={...impact,name:nameByPlayer.get(id),teamId:teamByPlayer.get(id),position:positionByPlayer.get(id)};
}
const values=Object.values(players).map(x=>x.net).filter(Number.isFinite);
const report={
  modelId:"NBA-FBIS-PLAYER-IMPACT-v1",version:"research-v1",cutoff,
  generatedAt:new Date().toISOString(),games:games.length,stints:stints.length,
  players,distribution:{n:values.length,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null},
  governance:{marketUsed:false,proprietaryMetricRequired:false,productionEligible:false,reason:"walk_forward_validation_required"}
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:true,out,players:Object.keys(players).length,games:games.length,stints:stints.length,rapmStints:rapm.stints},null,2));
