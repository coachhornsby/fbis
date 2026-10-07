#!/usr/bin/env node
import fs from "node:fs";
import { reconstructLineupStints, attachStintOutcomes, auditWnbaLineupEvidence, parseSubstitution, normalizeEspnPlay } from "../functions/lib/wnbaLineupModel.js";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games, pbpFile=args.pbp, oldFile=args.old, out=args.out;
const read=p=>fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse);
const games=read(gamesFile), pbp=read(pbpFile), old=read(oldFile);
const byPbp=new Map(pbp.map(x=>[String(x.id),x]));
const oldBy=new Map(); for(const s of old){const k=String(s.gameId);if(!oldBy.has(k))oldBy.set(k,[]);oldBy.get(k).push(s)}
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const nameMap=ps=>new Map(ps.map(p=>[norm(p.name||p.displayName),String(p.id||p.playerId||"")]).filter(x=>x[0]&&x[1]));
function oldReconstruct({plays,homeTeamId,awayTeamId,homePlayers,awayPlayers}){
 const hm=nameMap(homePlayers),am=nameMap(awayPlayers),starters=a=>a.filter(p=>p.starter).slice(0,5).map(p=>String(p.id||p.playerId||""));
 let home=starters(homePlayers),away=starters(awayPlayers),last=0; const out=[];
 const cs=c=>{const m=String(c||"").match(/(\d+):(\d+(?:\.\d+)?)/);return m?Number(m[1])*60+Number(m[2]):null};
 const el=(p,c)=>{const n=Number(p||1),q=n<=4?600:300,x=cs(c);let b=0;for(let i=1;i<n;i++)b+=i<=4?600:300;return b+(q-(x??q))};
 const ns=plays.map(normalizeEspnPlay).sort((a,b)=>el(a.period,a.clock)-el(b.period,b.clock)||(a.sequenceNumber??0)-(b.sequenceNumber??0));
 const emit=e=>{if(home.length!==5||away.length!==5){last=e;return}if(e>last)out.push({startElapsed:last,endElapsed:e,durationSeconds:e-last,homePlayers:[...home],awayPlayers:[...away],homeTeamId:String(homeTeamId),awayTeamId:String(awayTeamId)});last=e};
 for(const p of ns){const s=parseSubstitution({...p,participants:p.participants});if(!s)continue;const e=el(p.period,p.clock);emit(e);const isHome=String(s.teamId)===String(homeTeamId),lineup=isHome?home:away,map=isHome?hm:am,res=x=>String(x?.id||map.get(norm(x?.name))||"");const inn=res(s.playerIn),oo=res(s.playerOut);if(oo){const i=lineup.indexOf(oo);if(i>=0)lineup.splice(i,1)}if(inn&&!lineup.includes(inn)&&lineup.length<5)lineup.push(inn)}
 const mp=Math.max(4,...ns.map(p=>Number(p.period||0)).filter(Number.isFinite));emit(2400+Math.max(0,mp-4)*300);return out;
}
const sum=a=>a.reduce((s,x)=>s+(Number(x)||0),0), result={games:games.length,old:{stints:0,seconds:0,possessions:0},new:{stints:0,seconds:0,possessions:0},audit:{substitutionEvents:0,resolved:0,unresolved:0,outNotOnFloor:0,inAlreadyOnFloor:0,lineupSizeFaults:0},affectedGames:0,periodBoundary:{atRegulationStart:0,atOvertimeStart:0}};
for(const g of games){const p=byPbp.get(String(g.id));if(!p)continue;const hp=(g.players||[]).filter(x=>String(x.teamId)===String(g.homeId)),ap=(g.players||[]).filter(x=>String(x.teamId)===String(g.awayId));
 const oldRaw=oldReconstruct({plays:p.plays,homeTeamId:g.homeId,awayTeamId:g.awayId,homePlayers:hp,awayPlayers:ap}),newRaw=reconstructLineupStints({plays:p.plays,homeTeamId:g.homeId,awayTeamId:g.awayId,homePlayers:hp,awayPlayers:ap});
 const oo=attachStintOutcomes(oldRaw,p.plays),nn=attachStintOutcomes(newRaw,p.plays);result.old.stints+=oo.length;result.new.stints+=nn.length;result.old.seconds+=sum(oo.map(x=>x.durationSeconds));result.new.seconds+=sum(nn.map(x=>x.durationSeconds));result.old.possessions+=sum(oo.map(x=>x.possessions));result.new.possessions+=sum(nn.map(x=>x.possessions));if(JSON.stringify(oldRaw)!==JSON.stringify(newRaw))result.affectedGames++;
 const q=auditWnbaLineupEvidence({plays:p.plays,homeTeamId:g.homeId,awayTeamId:g.awayId,homePlayers:hp,awayPlayers:ap});for(const k of Object.keys(result.audit))result.audit[k]+=Number(q[k]||0);
 for(const x of p.plays||[]){const n=normalizeEspnPlay(x),s=parseSubstitution(x);if(!s)continue;if(n.period<=4&&n.clock==="10:00")result.periodBoundary.atRegulationStart++;if(n.period>4&&n.clock==="5:00")result.periodBoundary.atOvertimeStart++}
}
result.oldFrozen={stints:old.length,seconds:sum(old.map(x=>x.durationSeconds)),possessions:sum(old.map(x=>x.possessions))};
result.delta={stints:result.new.stints-result.old.stints,seconds:result.new.seconds-result.old.seconds,possessions:result.new.possessions-result.old.possessions};
result.governance={researchOnly:true,canQualify:false,canAuthorize:false,sourceImmutable:true};
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
