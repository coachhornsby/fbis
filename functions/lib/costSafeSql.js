const ident = value => {
 if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw Error('UNSAFE_SQL_IDENTIFIER');
 return value;
};
export function archivePageSql(columns) {
 return `SELECT ${columns.map(ident).join(', ')} FROM normalized_market_observations INDEXED BY idx_market_archive_cursor
 WHERE collected_at < ? AND (collected_at,id) > (?,?)
 ORDER BY collected_at ASC, id ASC LIMIT ?`;
}
export function changedOnlyUpsertSql(table,columns,keys,{rowid=false}={}) {
 ident(table);columns.forEach(ident);keys.forEach(ident);
 const mutable=columns.filter(c=>!keys.includes(c));
 const action=mutable.length?`DO UPDATE SET ${mutable.map(c=>`${c}=excluded.${c}`).join(',')} WHERE ${mutable.map(c=>`${table}.${c} IS NOT excluded.${c}`).join(' OR ')}`:'DO NOTHING';
 const insertColumns=rowid?['rowid',...columns]:columns;
 return `INSERT INTO ${table} (${insertColumns.join(',')}) VALUES (${insertColumns.map(()=>'?').join(',')}) ON CONFLICT(${keys.join(',')}) ${action}`;
}
