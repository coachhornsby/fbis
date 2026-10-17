#!/usr/bin/env python3
"""Prepare bounded SQL for the isolated rehearsal database, never primary D1."""
import gzip, hashlib, json, pathlib, sys

source=pathlib.Path(sys.argv[1]); expected_sha=sys.argv[2]
assert hashlib.sha256(source.read_bytes()).hexdigest()==expected_sha, 'ARCHIVE_SHA_MISMATCH'
p=json.loads(gzip.decompress(source.read_bytes()))
assert p['contract']=='fbis-lossless-market-cohort-v1'
assert p['table']=='normalized_market_observations' and len(p['columns'])==50
target='market_research_restore_20261017'
out=pathlib.Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
def quote(v):
    if v is None:return 'NULL'
    if isinstance(v,(float,int)):return repr(v)
    return "'"+str(v).replace("'","''")+"'"
for i in range(0,len(p['rows']),20):
    rows=p['rows'][i:i+20];statements=[]
    prefix='INSERT OR IGNORE INTO '+target+'(rowid,'+','.join(p['columns'])+') VALUES '
    values=[]
    for r in rows:
        value='('+','.join([r['__source_rowid']]+[quote(r[k]) for k in p['columns']])+')'
        assert len((prefix+value).encode())<85000, 'ROW_TOO_LARGE'
        if values and len((prefix+','.join(values+[value])).encode())>=85000:
            statements.append(prefix+','.join(values));values=[]
        values.append(value)
    if values:statements.append(prefix+','.join(values))
    select='SELECT CAST(rowid AS TEXT) __source_rowid,* FROM '+target+' WHERE id IN ('+','.join(quote(r['id']) for r in rows)+') ORDER BY rowid'
    (out/f'{i//20:04d}.json').write_text(json.dumps({'sql':statements,'select':select,'expected':rows,'columns':['__source_rowid']+p['columns']}))
print(json.dumps({'batches':(len(p['rows'])+19)//20,'rows':len(p['rows']),'targetTable':target,'primaryWrites':0}))
