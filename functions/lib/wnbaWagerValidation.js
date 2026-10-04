const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

function profit(price){
  const p=finite(price); if(p==null||p===0)return null;
  return p>0?p/100:100/(-p);
}
function unitResult(r){
  if(Number(r.push)===1)return 0;
  if(Number(r.win)===1)return profit(r.american_price);
  return -1;
}
function mean(xs){
  const a=xs.filter(Number.isFinite); return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
}
function maxDrawdown(units=[]){
  let equity=0,peak=0,max=0;
  for(const u of units){equity+=u;peak=Math.max(peak,equity);max=Math.max(max,peak-equity);}
  return max;
}
function group(rows,keyFn){
  const m=new Map();
  for(const r of rows){const k=keyFn(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return m;
}
function summarize(rows=[]){
  const decisions=rows.filter(r=>Number(r.push)!==1);
  const wins=decisions.filter(r=>Number(r.win)===1).length;
  const units=rows.map(unitResult).filter(Number.isFinite);
  const total=units.reduce((s,x)=>s+x,0);
  const probs=decisions.map(r=>[finite(r.model_probability),Number(r.win)]).filter(([p])=>p!=null);
  const brier=probs.length?mean(probs.map(([p,y])=>(p-y)**2)):null;
  return {
    n:rows.length,decisions:decisions.length,wins,
    winRate:decisions.length?wins/decisions.length:null,
    units:total,roi:decisions.length?total/decisions.length:null,
    brier,maxDrawdown:maxDrawdown(units),
    avgClvLine:mean(rows.map(r=>finite(r.clv_line))),
    avgClvPricePp:mean(rows.map(r=>finite(r.clv_price))),
  };
}
export function buildWnbaWagerValidation(rows=[]){
  const graded=(rows||[]).filter(r=>r.result!=null&&String(r.decision||"").toUpperCase()==="BET");
  const overall=summarize(graded);

  const confidenceBands=[...group(graded,r=>Math.floor((Number(r.confidence)||0)/10)*10)]
    .map(([band,rs])=>({band:Number(band),...summarize(rs)}))
    .sort((a,b)=>a.band-b.band);
  const qualifiedBands=confidenceBands.filter(b=>b.decisions>=25&&b.winRate!=null);
  let monotonic=qualifiedBands.length>=3;
  for(let i=1;i<qualifiedBands.length;i++){
    if(qualifiedBands[i].winRate+1e-9<qualifiedBands[i-1].winRate){monotonic=false;break;}
  }

  const markets=[...group(graded,r=>String(r.market||"UNKNOWN").toUpperCase())]
    .map(([market,rs])=>({market,...summarize(rs)}))
    .sort((a,b)=>a.market.localeCompare(b.market));
  const seasons=[...group(graded,r=>String(r.event_start||"").slice(0,4)||"UNKNOWN")]
    .map(([season,rs])=>({season,...summarize(rs)}))
    .sort((a,b)=>a.season.localeCompare(b.season));

  const probBins=[...group(
    graded.filter(r=>finite(r.model_probability)!=null),
    r=>Math.floor(finite(r.model_probability)*10)/10
  )].map(([bin,rs])=>{
    const s=summarize(rs);
    return {probabilityBin:Number(bin),n:s.decisions,meanModelProbability:mean(rs.map(r=>finite(r.model_probability))),observedWinRate:s.winRate};
  }).sort((a,b)=>a.probabilityBin-b.probabilityBin);

  return {
    generatedAt:new Date().toISOString(),
    sampleN:graded.length,
    overall,markets,seasons,probabilityCalibration:probBins,confidenceBands,
    confidenceMonotonicity:{
      valid:monotonic,
      minimumBandN:25,
      qualifiedBands:qualifiedBands.length,
      rule:"Higher confidence bands must not underperform lower qualified bands.",
    },
    staking:{
      validated:false,
      reason:"Stake sizing remains disabled until positive, stable units/ROI/CLV and confidence monotonicity are demonstrated prospectively.",
    },
    objective:"positive expected value at the offered price; historical subsets are evidence, never automatic betting rules",
  };
}
