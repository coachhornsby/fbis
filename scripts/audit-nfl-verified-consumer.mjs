// Offline-only integration proof. Inputs must be already gathered local evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {prepareVerifiedNflRecoveryPacket} from '../functions/lib/nflVerifiedRecoveryPacket.js';
import {publicProjectionSummary} from '../functions/lib/publicFourSportProjection.js';
import {boardDate} from '../functions/lib/publicBoardSnapshot.js';
import teams from '../data/teams/nfl.js';
import {projectVerifiedNflFutureGames} from '../functions/lib/nflVerifiedProjectionInputs.js';
import {attachNflVerseFeatures} from '../functions/lib/nflVerseFeed.js';
import {attachNflProShadow} from '../functions/lib/nflProModel.js';
import {promoteNflResearchToBoard} from '../functions/lib/researchBoardPromote.js';
import {attachNflPlayerProjectionResearch} from '../functions/lib/proPlayerProjectionLayer.js';
const [publicationPath,schedulePath,baselinePath,output]=process.argv.slice(2);
if(!output)throw Error('Usage: publication.json schedule.json pre-enrichment-snapshot.json new-output.json');
const publication=JSON.parse(await readFile(publicationPath,'utf8')),schedule=JSON.parse(await readFile(schedulePath,'utf8')),baseline=JSON.parse(await readFile(baselinePath,'utf8')),now=Date.now();
const canon=x=>x==='LA'?'LAR':x;
const team=abbr=>teams.find(t=>t.abbr===canon(abbr));
const games=schedule.games.filter(g=>g.start&&Date.parse(g.start)>now&&Date.parse(g.start)<now+8*86400000&&!g.hasResult).map(g=>({id:g.espnId,sport:'nfl',date:boardDate(g.start),start:g.start,status:'scheduled',neutralSite:g.neutralSite,home:team(g.home),away:team(g.away)}));
const before=attachNflPlayerProjectionResearch(promoteNflResearchToBoard(attachNflProShadow(attachNflVerseFeatures(games,baseline)).games).games,{byTeam:baseline.playersByTeam,leaguePositionDefense:baseline.leaguePositionDefense,meta:baseline.meta});
const after=await projectVerifiedNflFutureGames({games,publication,schedule,now});
const key=r=>[r.playerId,r.playerName,r.market,r.team].join('|');
const comparisons=after.games.flatMap((g,i)=>{
 if(after.decisions[i].state!=='NFL_RESEARCH_INPUTS_APPLIED')return [];
 const b=before[i],map=new Map((b.playerProjectionRows||[]).map(r=>[key(r),r]));
 const changed=(g.playerProjectionRows||[]).flatMap(r=>{const prior=map.get(key(r));return prior&&prior.fbisProjection!==r.fbisProjection?[{player:r.playerName,market:r.market,before:prior.fbisProjection,after:r.fbisProjection}]:[];});
 return [{gameId:g.id,matchup:`${g.away.abbr}@${g.home.abbr}`,start:g.start,before:{home:b.model.projHome,away:b.model.projAway,total:b.model.projTotal,margin:b.model.projMargin},after:{home:g.model.projHome,away:g.model.projAway,total:g.model.projTotal,margin:g.model.projMargin},playerRows:g.playerProjectionRows.length,changedPlayerRows:changed.length,examples:changed.slice(0,5),wagerAuthority:false}];
});
const transport=[];
for(const date of [...new Set(games.map(g=>g.date))]){
 const prepared=await prepareVerifiedNflRecoveryPacket({date,games,publication,schedule,now});
 if(!prepared.changed)continue;
 const summary=publicProjectionSummary(prepared.packet,{sport:'nfl',date});
 transport.push({date,bytes:new TextEncoder().encode(JSON.stringify(prepared.packet)).length,events:summary.events.length,playerRows:summary.events.reduce((n,e)=>n+(e.nflPlayerResearch?.rows.length||0),0),allHeld:summary.events.every(e=>e.nflPlayerResearch.rows.every(r=>['HOLD','BLOCKED'].includes(r.gate))),storageWrites:0});
}
const report={transport,auditAt:new Date(now).toISOString(),snapshotSha256:publication.receipt.snapshotSha256,mode:'OFFLINE_CURRENT_EVIDENCE_NOT_HISTORICAL_BACKTEST',productionActivated:false,calibrationVerified:false,meta:after.meta,decisions:after.decisions,comparisons};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({applied:after.meta.applied,comparisonGames:comparisons.length,changedPlayerRows:comparisons.reduce((n,g)=>n+g.changedPlayerRows,0),decisions:after.decisions}));
