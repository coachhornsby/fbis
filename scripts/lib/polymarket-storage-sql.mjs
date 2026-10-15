export const sqlQuote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function compactUpdateSql(u){
 const sql=`UPDATE normalized_market_observations SET raw_payload_json=${sqlQuote(u.text)},raw_payload_hash=${sqlQuote(u.hash)} WHERE id=${sqlQuote(u.id)} AND raw_payload_hash=${sqlQuote(u.oldHash)};`;
 if(Buffer.byteLength(sql)>99000)throw Error('COMPACTION_SQL_STATEMENT_TOO_LARGE');
 return sql;
}
