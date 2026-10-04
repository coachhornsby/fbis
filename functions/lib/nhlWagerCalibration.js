export const NHL_CONFIDENCE_GATES=Object.freeze({
  GAME:{minDecisions:150,minPerBin:25,minBins:3,minRoi:0.0,maxDrawdown:12,minClvCoverage:.50,minAvgClv:0},
  PROP:{minDecisions:250,minPerBin:25,minBins:3,minRoi:0.0,maxDrawdown:15,minClvCoverage:0,minAvgClv:null},
});
function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function round(v,n=4){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**n;return Math.round(Number(v)*p)/p;}
function band(c){const n=Number(c)||0;return n<50?"0-49":n<60?"50-59":n<70?"60-69":n<80?"70-79":n<90?"80-89":"90-100";}
function drawdown(rows){
  let equity=0,peak=0,max=0;
  for(const r of rows){equity+=finite(r.profit_units)||0;peak=Math.max(peak,equity);max=Math.max(max,peak-equity);}
  return max;
}
function brier(rows){
  const xs=rows.filter(r=>finite(r.calibrated_probability)!=null&&["WIN","LOSS"].includes(String(r.result)));
  if(!xs.length)return null;
  return xs.reduce((s,r)=>{const y=r.result==="WIN"?1:0,p=Number(r.calibrated_probability);return s+(p-y)**2;},0)/xs.length;
}
export function auditConfidenceRows(rows=[],scope="GAME"){
  const xs=rows.filter(r=>String(r.wager_scope).toUpperCase()===scope&&["WIN","LOSS","PUSH"].includes(String(r.result)));
  const risk=xs.reduce((s,r)=>s+Math.abs(finite(r.risk_units)??1),0);
  const units=xs.reduce((s,r)=>s+(finite(r.profit_units)||0),0);
  const clvRows=xs.filter(r=>finite(r.clv_probability_pp)!=null);
  const groups=new Map();
  for(const r of xs){const k=band(r.confidence);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  const order=["0-49","50-59","60-69","70-79","80-89","90-100"];
  const bins=order.map(k=>{
    const rs=groups.get(k)||[],dec=rs.filter(r=>["WIN","LOSS"].includes(String(r.result)));
    const rr=rs.reduce((s,r)=>s+Math.abs(finite(r.risk_units)??1),0),u=rs.reduce((s,r)=>s+(finite(r.profit_units)||0),0);
    return {band:k,min:Number(k.split("-")[0]),max:Number(k.split("-")[1]),n:rs.length,winRate:dec.length?dec.filter(r=>r.result==="WIN").length/dec.length:null,roi:rr?u/rr:null,units:u,meanConfidence:rs.length?rs.reduce((s,r)=>s+(finite(r.confidence)||0),0)/rs.length:null};
  });
  const gates=NHL_CONFIDENCE_GATES[scope]||NHL_CONFIDENCE_GATES.GAME;
  const qualifiedBins=bins.filter(b=>b.n>=gates.minPerBin&&b.winRate!=null);
  let monotonic=true,prev=-Infinity;
  for(const b of qualifiedBins){if(b.winRate+1e-9<prev)monotonic=false;prev=b.winRate;}
  const avgClv=clvRows.length?clvRows.reduce((s,r)=>s+Number(r.clv_probability_pp),0)/clvRows.length:null;
  const metrics={n:xs.length,units:round(units),roi:risk?round(units/risk):null,maxDrawdown:round(drawdown(xs)),brier:round(brier(xs)),clvCoverage:xs.length?round(clvRows.length/xs.length):0,avgClvProbabilityPp:round(avgClv),bins,qualifiedBins:qualifiedBins.length,monotonic};
  const failures=[];
  if(xs.length<gates.minDecisions)failures.push("minimum-decisions");
  if(qualifiedBins.length<gates.minBins)failures.push("minimum-populated-bins");
  if(!monotonic)failures.push("confidence-not-monotonic");
  if(metrics.roi==null||metrics.roi<=gates.minRoi)failures.push("roi-not-positive");
  if(metrics.maxDrawdown>gates.maxDrawdown)failures.push("drawdown-gate");
  if(scope==="GAME"&&metrics.clvCoverage>=gates.minClvCoverage&&metrics.avgClvProbabilityPp<gates.minAvgClv)failures.push("clv-negative");
  return {scope,status:failures.length?"NOT_VALIDATED":"VALIDATED",validated:failures.length===0,failures,gates,metrics};
}
export async function loadNhlCalibrationRows(db){
  if(!db?.prepare)return[];
  const q=await db.prepare(`WITH ranked AS (
    SELECT d.*,s.result,s.risk_units,s.profit_units,s.clv_probability_pp,s.settled_at,
      ROW_NUMBER() OVER (
        PARTITION BY d.wager_scope,d.event_id,COALESCE(d.player_id,''),d.market,d.selection,COALESCE(d.line,-9999)
        ORDER BY d.snapshot_at DESC
      ) rn
    FROM nhl_wager_decisions d JOIN nhl_wager_settlements s ON s.decision_id=d.id
    WHERE d.research_candidate=1 AND d.game_type=2
  )
  SELECT * FROM ranked WHERE rn=1 ORDER BY settled_at,event_id,market,selection`).all();
  return q.results||[];
}
export async function runNhlConfidenceAudit(db,{source="PROSPECTIVE_LEDGER"}={}){
  const rows=await loadNhlCalibrationRows(db);
  const game=auditConfidenceRows(rows,"GAME"),prop=auditConfidenceRows(rows,"PROP");
  const at=new Date().toISOString(),id="nhlc_"+crypto.randomUUID().replaceAll("-","");
  if(db?.prepare){
    await db.prepare(`INSERT INTO nhl_wager_confidence_runs(id,run_at,source,game_validated,prop_validated,game_n,prop_n,game_json,prop_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,at,source,game.validated?1:0,prop.validated?1:0,game.metrics.n,prop.metrics.n,JSON.stringify(game),JSON.stringify(prop)).run();
  }
  return {ok:true,id,runAt:at,source,game,prop,authority:false,staking:false};
}
