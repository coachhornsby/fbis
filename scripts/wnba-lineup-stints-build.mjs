#!/usr/bin/env node
import fs from "node:fs";
import { reconstructLineupStints, attachStintOutcomes, aggregateLineupEffects } from "../functions/lib/nbaLineupModel.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/wnba-canonical.jsonl";
const pbpFile=args.pbp||"artifacts/wnba-pbp.jsonl";
const out=args.out||"artifacts/wnba-lineup-stints.jsonl";
const effectsOut=args.effects||"artifacts/wnba-lineup-effects.json";
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const games=read(gamesFile),pbp=read(pbpFile),pbpBy=new Map(pbp.map(x=>[String(x.id),x]));
const stints=[];
let gamesWithCompleteStints=0;
for(const g of games){
  const p=pbpBy.get(String(g.id));if(!p)continue;
  const hp=(g.players||[]).filter(x=>String(x.teamId)===String(g.homeId));
  const ap=(g.players||[]).filter(x=>String(x.teamId)===String(g.awayId));
  const raw=reconstructLineupStints({plays:p.plays,homeTeamId:g.homeId,awayTeamId:g.awayId,homePlayers:hp,awayPlayers:ap});
  const withOutcomes=attachStintOutcomes(raw,p.plays).map(s=>({...s,gameId:g.id,date:g.start||g.date}));
  if(withOutcomes.length&&withOutcomes.every(s=>s.homePlayers.length===5&&s.awayPlayers.length===5))gamesWithCompleteStints++;
  stints.push(...withOutcomes);
}
const effects=aggregateLineupEffects(stints,20);
const quality={
  games:games.length,pbpGames:pbp.length,stints:stints.length,
  gamesWithCompleteStints,
  totalPossessions:stints.reduce((s,x)=>s+(Number(x.possessions)||0),0),
  fiveManEffects:effects.filter(x=>x.kind==="five").length,
  pairEffects:effects.filter(x=>x.kind==="pair").length,
  trioEffects:effects.filter(x=>x.kind==="trio").length
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,stints.map(JSON.stringify).join("\n")+(stints.length?"\n":""));
fs.writeFileSync(effectsOut,JSON.stringify({generatedAt:new Date().toISOString(),quality,effects},null,2)+"\n");
console.log(JSON.stringify({ok:true,out,effectsOut,quality},null,2));
