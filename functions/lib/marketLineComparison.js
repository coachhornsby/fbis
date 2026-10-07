const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export function marketComparisonKey(row={}){
  return [String(row.sport||"").toLowerCase(),norm(row.playerName||row.player_name),String(row.statFamily||row.canonical_market||row.market||"").toLowerCase(),String(row.eventId||row.fbis_event_id||"")].join("|");
}

export function compareEquivalentPropLines(rows=[],{nowMs=Date.now(),staleAfterMs=30*60*1000,outlierThreshold=2}={}){
  const groups=new Map();
  for(const row of rows){
    const line=finite(row.line);
    if(line==null||!row.playerName||!row.statFamily)continue;
    const k=marketComparisonKey(row);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push({...row,line});
  }
  return [...groups.values()].map(group=>{
    const lines=group.map(x=>x.line),min=Math.min(...lines),max=Math.max(...lines);
    const sorted=lines.slice().sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
    const sources=group.map(row=>{
      const t=Date.parse(row.timestamp||row.fetchedAt||row.collected_at||"");
      return {...row,stale:Number.isFinite(t)?nowMs-t>staleAfterMs:true,outlier:group.length>=2&&Math.abs(row.line-median)>=outlierThreshold};
    });
    return {
      sport:group[0].sport,playerName:group[0].playerName,statFamily:group[0].statFamily,eventId:group[0].eventId||null,
      lowestOverThreshold:min,highestUnderThreshold:max,lineDisagreement:max-min,
      betterOverEntry:sources.filter(x=>x.line===min).map(x=>x.platform),
      betterUnderEntry:sources.filter(x=>x.line===max).map(x=>x.platform),
      timestampSpreadMs:(()=>{const ts=sources.map(x=>Date.parse(x.timestamp||x.fetchedAt||"")).filter(Number.isFinite);return ts.length>1?Math.max(...ts)-Math.min(...ts):0})(),
      sources,
      governance:"MARKET_SHOPPING_ONLY",
    };
  });
}
