// Current-use source contract, not a model/qualification threshold.
export const ACTION_CURRENT_FRESHNESS_SECONDS = 600;

// Zoned source timestamps and SQLite's documented UTC storage format only.
// Reject Date.parse's permissive date-only/numeric/overflow interpretations.
export function actionTimestampMs(value) {
  if (typeof value !== 'string') return NaN;
  const text=value.trim();
  const m=text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m || (!m[7] && text.includes('T'))) return NaN;
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (month<1||month>12||day<1||day>days||hour>23||minute>59||second>59) return NaN;
  return Date.parse(m[7]?text:text.replace(' ','T')+'Z');
}

export function actionTemporalValidity({collectedAt,sourceObservedAt=null},
  {now=Date.now(),freshnessSeconds=ACTION_CURRENT_FRESHNESS_SECONDS}={}) {
  const clock=typeof now==='number'?now:actionTimestampMs(now);
  const captured=actionTimestampMs(collectedAt);
  const source=sourceObservedAt==null?null:actionTimestampMs(sourceObservedAt);
  const validClock=Number.isFinite(clock)&&Number.isFinite(freshnessSeconds)&&freshnessSeconds>=0;
  const validTime=t=>Number.isFinite(t)&&t<=clock&&clock-t<=freshnessSeconds*1000;
  // Zero clock-skew allowance preserves the existing fail-closed display rule.
  const valid=validClock&&validTime(captured)&&(source===null||(validTime(source)&&source<=captured));
  return {valid,state:valid?'CURRENT':'UNAVAILABLE',reason:valid?null:'ACTION_CAPTURE_NOT_CURRENT',
    collectedAt:collectedAt??null,sourceObservedAt:sourceObservedAt??null};
}

export function currentActionRows(rows=[],options={}) {
  return rows.filter(row=>String(row.snapshot_type||row.snapshotType||'').toUpperCase()!=='CLOSE'&&
    actionTemporalValidity({collectedAt:row.collected_at??row.collectedAt,
      sourceObservedAt:row.provider_timestamp??row.providerTimestamp??row.observedAt??null},options).valid);
}

// Explicit historical research: retain original timestamps, exclude future/CLOSE
// evidence, and label the result so it cannot be mistaken for a current quote.
export function historicalActionRows(rows=[],{now=Date.now()}={}) {
  return currentActionRows(rows,{now,freshnessSeconds:Number.MAX_SAFE_INTEGER})
    .map(row=>({...row,temporalUse:'HISTORICAL_RESEARCH'}));
}
