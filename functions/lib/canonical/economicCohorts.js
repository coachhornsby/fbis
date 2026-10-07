const CALIBRATION_VERSION="FBIS-ECE-10-EQUAL-WIDTH-v1";
const DRAWDOWN_VERSION="FBIS-DRAWDOWN-GRADED-AT-v1";
const COHORT_CONTRACT_VERSION="FBIS-ECONOMIC-COHORT-v1";
const finite=v=>v==null?null:(Number.isFinite(Number(v))?Number(v):null);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

function calibrationEce(rows=[]){
  const usable=rows.map(r=>({p:finite(r.projected_probability),y:r.result==="WIN"?1:r.result==="LOSS"?0:null}))
    .filter(x=>x.p!=null&&x.p>=0&&x.p<=1&&x.y!=null);
  if(!usable.length)return null;
  let weighted=0;
  for(let b=0;b<10;b++){
    const lo=b/10,hi=(b+1)/10,bin=usable.filter(x=>x.p>=lo&&(b===9?x.p<=hi:x.p<hi));
    if(bin.length)weighted+=(bin.length/usable.length)*Math.abs(mean(bin.map(x=>x.p))-mean(bin.map(x=>x.y)));
  }
  return weighted;
}
function maxDrawdown(rows=[]){
  const profits=rows.map(r=>finite(r.profit_units)).filter(v=>v!=null);
  if(!profits.length)return null;
  let equity=0,peak=0,maxDd=0;
  for(const p of profits){equity+=p;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,peak-equity)}
  return maxDd;
}
export function aggregateEconomicCohort(rows=[]){
  const ordered=[...rows].sort((a,b)=>String(a.graded_at||"").localeCompare(String(b.graded_at||""))||String(a.grade_id||"").localeCompare(String(b.grade_id||"")));
  const stake=ordered.map(r=>finite(r.stake_units)).filter(v=>v!=null),profit=ordered.map(r=>finite(r.profit_units)).filter(v=>v!=null);
  const totalStake=stake.length===ordered.length?stake.reduce((a,b)=>a+b,0):null,totalProfit=profit.length===ordered.length?profit.reduce((a,b)=>a+b,0):null;
  const hasCalibration=ordered.some(r=>finite(r.projected_probability)!=null&&(r.result==="WIN"||r.result==="LOSS"));
  return{observationsN:ordered.length,brierMean:mean(ordered.map(r=>finite(r.brier)).filter(v=>v!=null)),logLossMean:mean(ordered.map(r=>finite(r.log_loss)).filter(v=>v!=null)),
    clvProbabilityMean:mean(ordered.map(r=>finite(r.clv_probability)).filter(v=>v!=null)),profitUnits:totalProfit,
    roi:totalStake!=null&&totalStake>0&&totalProfit!=null?totalProfit/totalStake:null,calibrationValue:calibrationEce(ordered),
    calibrationMethodVersion:hasCalibration?CALIBRATION_VERSION:null,maxDrawdownUnits:maxDrawdown(ordered),
    drawdownMethodVersion:profit.length===ordered.length&&ordered.length?DRAWDOWN_VERSION:null};\n}
}
async function sha256(value){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("")}
export async function economicGradeSetId(rows=[]){return sha256(JSON.stringify([...rows].map(r=>String(r.grade_id||"")).sort()))}\nexport async function persistEconomicCohorts(env,{sport=null,windowStartAt=null,windowEndAt=null,generatedAt=new Date().toISOString()}={}){
  if(!env?.DB)return{ok:false,reason:"D1-unbound"};
  const where=[],bind=[]; if(sport){where.push("g.sport=?");bind.push(sport)} if(windowStartAt){where.push("g.graded_at>=?");bind.push(windowStartAt)} if(windowEndAt){where.push("g.graded_at<?");bind.push(windowEndAt)}
  const q=await env.DB.prepare(`SELECT g.*,e.model_id,e.gate_version FROM fbis_economic_grades g JOIN fbis_prospective_evidence e ON g.evidence_id=e.evidence_id ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY g.graded_at,g.grade_id`).bind(...bind).all();
  const groups=new Map(); for(const row of q.results||[]){const key=JSON.stringify([row.sport,row.model_id,row.market_family,row.gate_version]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  let written=0;
  for(const [key,group] of groups){
    const [cohortSport,modelId,marketFamily,gateVersion]=JSON.parse(key),metrics=aggregateEconomicCohort(group);
    const evidenceFilter={sport:cohortSport,modelId,marketFamily,gateVersion,windowStartAt,windowEndAt};
    const cohortId=await sha256(JSON.stringify([COHORT_CONTRACT_VERSION,evidenceFilter,"FBIS-ECONOMIC-GRADE-v1",CALIBRATION_VERSION,DRAWDOWN_VERSION]));
    if(await env.DB.prepare("SELECT cohort_id FROM fbis_economic_cohort_metrics WHERE cohort_id=?").bind(cohortId).first())continue;
    const provenance={codeSha:env.CF_PAGES_COMMIT_SHA||null,gradingVersion:"FBIS-ECONOMIC-GRADE-v1",gradeSetId,gradeCount:group.length,calibrationVersion:metrics.calibrationMethodVersion,drawdownVersion:metrics.drawdownMethodVersion,generatedAt};
    await env.DB.prepare(`INSERT INTO fbis_economic_cohort_metrics(cohort_id,contract_version,sport,model_id,market_family,gate_version,window_start_at,window_end_at,observations_n,brier_mean,log_loss_mean,clv_probability_mean,profit_units,roi,calibration_value,calibration_method_version,max_drawdown_units,drawdown_method_version,evidence_filter_json,provenance_json,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      cohortId,COHORT_CONTRACT_VERSION,cohortSport,modelId,marketFamily,gateVersion,windowStartAt,windowEndAt,metrics.observationsN,metrics.brierMean,metrics.logLossMean,metrics.clvProbabilityMean,metrics.profitUnits,metrics.roi,metrics.calibrationValue,metrics.calibrationMethodVersion,metrics.maxDrawdownUnits,metrics.drawdownMethodVersion,JSON.stringify(evidenceFilter),JSON.stringify(provenance),generatedAt).run(); written++;
  }
  return{ok:true,rows:(q.results||[]).length,cohorts:groups.size,written};
}
export{CALIBRATION_VERSION,DRAWDOWN_VERSION,COHORT_CONTRACT_VERSION};
