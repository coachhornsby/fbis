/** Hard caps for the authenticated one-shot source-preserving D1 compaction runner. */
export function compactionBudget({startRowid=0,maxRows=5000}={}){
 const cursor=Number(startRowid),cap=Number(maxRows);
 if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('INVALID_COMPACTION_START_ROWID');
 if(!Number.isSafeInteger(cap)||cap<1||cap>10000)throw Error('INVALID_COMPACTION_MAX_ROWS');
 return {startRowid:cursor,maxRows:cap};
}
export function compactionPageLimit(examined,maxRows){
 if(!Number.isSafeInteger(examined)||examined<0||!Number.isSafeInteger(maxRows)||maxRows<1||examined>maxRows)throw Error('INVALID_COMPACTION_PROGRESS');
 return Math.min(500,maxRows-examined);
}
