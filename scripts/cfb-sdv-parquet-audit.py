#!/usr/bin/env python3
"""Offline play evidence audit. Requires pyarrow; never executes in a Worker."""
import argparse,datetime,pathlib,urllib.request,hashlib,json
import pyarrow.parquet as pq
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--season',type=int,default=2026);a=p.parse_args();root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True);report=[]
for family,tag,prefix in [('play_by_play','espn_cfb_pbp','play_by_play'),('model_pbp','espn_cfb_model_pbp','model_pbp')]:
 filename=f'{prefix}_{a.season}.parquet';url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{filename}';path=root/filename
 entry={'family':family,'url':url,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'productionConsumed':False,'historicalPITQualified':False}
 try:
  with urllib.request.urlopen(url,timeout=120) as response,path.open('wb') as target:
   size=0
   while chunk:=response.read(1024*1024):
    size+=len(chunk)
    if size>128*1024*1024:raise ValueError('Source exceeds offline bound')
    target.write(chunk)
  pf=pq.ParquetFile(path);columns=pf.schema_arrow.names;nulls={c:0 for c in columns};rows=0
  for batch in pf.iter_batches(batch_size=2048):
   rows+=batch.num_rows
   for i,c in enumerate(columns):nulls[c]+=batch.column(i).null_count
   if 'season' in columns:
    values={v for v in batch.column(columns.index('season')).to_pylist() if v is not None}
    if any(int(v)!=a.season for v in values):raise ValueError('Season scope mismatch')
  if rows!=pf.metadata.num_rows:raise ValueError('Silent Parquet truncation')
  entry.update(status='AVAILABLE',rows=rows,columns=columns,nulls=nulls,bytes=size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
 except Exception as error:path.unlink(missing_ok=True);entry.update(status='UNAVAILABLE',error=str(error))
 report.append(entry)
(root/'parquet-manifest.json').write_text(json.dumps({'season':a.season,'datasets':report,'productionMutation':False,'paidProviderUsage':False},indent=2)+'\n');print(json.dumps([{k:r.get(k) for k in ['family','status','rows','bytes','error']} for r in report]))
