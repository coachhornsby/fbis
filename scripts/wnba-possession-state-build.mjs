#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { reconstructWnbaPossessionState, buildWnbaOpponentShotProfiles } from "../functions/lib/wnbaPossessionState.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/wnba-canonical.jsonl";
const pbpFile=args.pbp||"artifacts/wnba-pbp.jsonl";
const out=args.out||"artifacts/wnba-possession-state.jsonl";
const shotsOut=args.shots||"artifacts/wnba-shot-events.jsonl";
const profilesOut=args.profiles||"artifacts/wnba-shot-profiles.jsonl";
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];

const games=read(gamesFile),pbp=read(pbpFile),gameBy=new Map(games.map(g=>[String(g.id),g]));
const states=[],shots=[],profiles=[];
for(const p of pbp){
  const g=gameBy.get(String(p.id));
  if(!g)continue;
  const r=reconstructWnbaPossessionState({...p,boxPossessions:g.possessions});
  if(!r.ok)continue;
  states.push(r);
  shots.push(...r.shots.map(s=>({...s,date:g.date,start:g.start})));
  profiles.push({gameId:r.gameId,date:r.date,start:r.start,homeId:r.homeTeamId,awayId:r.awayTeamId,profiles:buildWnbaOpponentShotProfiles(r),qa:r.qa});
}
const quality={
  games:states.length,
  totalPossessions:states.reduce((s,r)=>s+r.qa.possessions,0),
  totalShots:shots.length,
  zoneResolution:shots.length?shots.filter(s=>s.zone!=="two_unknown").length/shots.length:0,
  coordinateCoverage:shots.length?shots.filter(s=>s.x!=null&&s.y!=null).length/shots.length:0,
  gamesPossessionBalanced:states.length?states.filter(r=>(r.qa.possessionBalanceDelta??99)<=3).length/states.length:0,
  gamesBoxPossWithin8:states.length?states.filter(r=>r.qa.boxPossessionDelta==null||Math.abs(r.qa.boxPossessionDelta)<=8).length/states.length:0,
};
for(const p of [out,shotsOut,profilesOut])fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(out,states.map(JSON.stringify).join("\n")+(states.length?"\n":""));
fs.writeFileSync(shotsOut,shots.map(JSON.stringify).join("\n")+(shots.length?"\n":""));
fs.writeFileSync(profilesOut,profiles.map(JSON.stringify).join("\n")+(profiles.length?"\n":""));
fs.writeFileSync(out.replace(/\.jsonl$/,"-manifest.json"),JSON.stringify({
  source:"ESPN_PUBLIC",modelId:"WNBA-POSSESSION-STATE-v1",version:"research-v1",
  builtAt:new Date().toISOString(),quality,
  governance:{productionFeatureActive:false,marketInformed:false,requiresAblation:true}
},null,2)+"\n");
console.log(JSON.stringify({ok:true,out,shotsOut,profilesOut,quality},null,2));
