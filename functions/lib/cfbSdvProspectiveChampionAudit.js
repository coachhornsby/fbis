/**
 * Independent CFB prospective score comparison: frozen champion v2 vs an
 * authentic shadow receipt, matched to the same verified regulation result.
 * No historical reconstructed predictions or model promotion.
 */
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const eventKey=x=>[x.homeTeamId,x.awayTeamId,Date.parse(x.kickoff)].join("|");
function bootstrap(xs){
 if(xs.length<30)return null;
 let seed=0x58a423b1;
 const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
 const out=[];
 for(let i=0;i<1000;i++){
  let total=0;for(let j=0;j<xs.length;j++)total+=xs[Math.floor(rnd()*xs.length)];
  out.push(total/xs.length);
 }
 out.sort((a,b)=>a-b);return [out[25],out[975]];
}
function summarize(rows,mode){
 const home=mode==="champion"?"championHome":"challengerHome";
 const away=mode==="champion"?"championAway":"challengerAway";
 const losses=rows.map(r=>({
  margin:Math.abs(r[home]-r[away]-(r.actualHome-r.actualAway)),
  total:Math.abs(r[home]+r[away]-r.actualHome-r.actualAway),
  winner:Number(Math.sign(r[home]-r[away])===Math.sign(r.actualHome-r.actualAway))
 }));
 return {marginMAE:mean(losses.map(x=>x.margin)),totalMAE:mean(losses.map(x=>x.total)),
  projectedWinnerAccuracy:mean(losses.map(x=>x.winner)),losses};
}
export function compareCfbProspectiveToFrozenChampion(rows,{asOf,minGames=30}={}){
 if(!Number.isFinite(Date.parse(asOf))||!Number.isInteger(minGames)||minGames<1)
  throw Error("CFB_PROSPECTIVE_INVALID_SCOPE");
 const chosen=new Map(),excluded={};const add=k=>excluded[k]=(excluded[k]||0)+1;
 for(const row of rows||[]){
  if(row.modelId!=="CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0"||
    row.championModelVersion!=="CFB-FBIS-v2"){add("MODEL_IDENTITY_MISMATCH");continue}
  if(!row.receiptId||!row.sourceFingerprint||!row.baselineSnapshotId||
   !row.homeTeamId||!row.awayTeamId||![row.kickoff,row.capturedAt,
   row.baselineFrozenAt,row.observedAt,row.gradedAt].every(x=>Number.isFinite(Date.parse(x)))||
   !(Date.parse(row.baselineFrozenAt)<=Date.parse(row.capturedAt)&&
    Date.parse(row.capturedAt)<Date.parse(row.kickoff)&&
    Date.parse(row.kickoff)<=Date.parse(row.observedAt)&&
    Date.parse(row.observedAt)<=Date.parse(row.gradedAt)&&
    Date.parse(row.gradedAt)<=Date.parse(asOf))){
   add("INVALID_PROSPECTIVE_CHRONOLOGY");continue
  }
  if(![row.championHome,row.championAway,row.challengerHome,row.challengerAway,
   row.actualHome,row.actualAway].every(finite)||
   [row.championHome,row.championAway,row.challengerHome,row.challengerAway,
    row.actualHome,row.actualAway].some(v=>v<0||v>100)){
   add("SCORE_MISSING_OR_INVALID");continue
  }
  const key=eventKey(row),prior=chosen.get(key);
  if(!prior||Date.parse(row.capturedAt)<Date.parse(prior.capturedAt))
   chosen.set(key,row);
 }
 const eligible=[...chosen.values()],champion=summarize(eligible,"champion"),
  challenger=summarize(eligible,"challenger");
 const deltas=(metric)=>eligible.map((_,i)=>challenger.losses[i][metric]-champion.losses[i][metric]);
 return {sport:"cfb",asOf,n:eligible.length,minGames,
  status:eligible.length>=minGames?"PROSPECTIVE_DESCRIPTIVE_ONLY":"INSUFFICIENT_PROSPECTIVE_PAIRED_SAMPLE",
  championModelId:"CFB-FBIS-v2",
  challengerModelId:"CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0",
  champion:{marginMAE:champion.marginMAE,totalMAE:champion.totalMAE,
   projectedWinnerAccuracy:champion.projectedWinnerAccuracy},
  challenger:{marginMAE:challenger.marginMAE,totalMAE:challenger.totalMAE,
   projectedWinnerAccuracy:challenger.projectedWinnerAccuracy},
  pairedDeltas:{marginMAE:mean(deltas("margin")),totalMAE:mean(deltas("total")),
   marginBootstrap95:bootstrap(deltas("margin")),totalBootstrap95:bootstrap(deltas("total"))},
  excluded,prospective:true,calibrated:false,canQualify:false,
  canAuthorizeWager:false,changesProductionChampion:false,CLV:null,ROI:null};
}
