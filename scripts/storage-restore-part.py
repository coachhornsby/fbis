#!/usr/bin/env python3
import gzip,json,sqlite3,sys
if sys.argv[1]=='--check':
 c=sqlite3.connect(sys.argv[2]);assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert not c.execute('PRAGMA foreign_key_check').fetchall()
 print(json.dumps({'integrity':'ok','foreignKeyErrors':0}));sys.exit()
p=json.load(gzip.open(sys.argv[1],'rt'));assert p['contract']=='fbis-full-cold-part-v1'
assert p['table'] in ('normalized_market_observations','cfb_roster_observations')
c=sqlite3.connect(sys.argv[2]);c.execute(p['schema'].replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ',1));cols=p['columns'];table=p['table']
q='INSERT OR IGNORE INTO '+table+'(rowid,'+','.join(cols)+') VALUES ('+','.join('?' for _ in range(len(cols)+1))+')'
c.executemany(q,[[int(r['__source_rowid'])]+[r[k] for k in cols] for r in p['rows']]);c.commit();c.row_factory=sqlite3.Row
sql='SELECT CAST(rowid AS TEXT) __source_rowid,* FROM '+table+' WHERE rowid>? AND rowid<=?'+(' AND season BETWEEN 2005 AND 2025' if table=='cfb_roster_observations' else '')+' ORDER BY rowid'
actual=[dict(r) for r in c.execute(sql,(p['afterRowid'],int(p['rows'][-1]['__source_rowid'])))];assert actual==p['rows'],'FULL_FIELD_PARITY_FAILED'
print(json.dumps({'rows':len(actual),'fullFieldParity':True}))
