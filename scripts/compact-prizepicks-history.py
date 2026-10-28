#!/usr/bin/env python3
"""One-shot archive-gated raw-payload compaction. No acquisition or schedules."""
import argparse,hashlib,json,pathlib,sqlite3,time,urllib.request,urllib.error
ENDPOINT='https://fbis-prizepicks-history-maintenance.coachhornsby.workers.dev/apply'
p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--verified-dir',required=True);p.add_argument('--key-file',required=True);p.add_argument('--receipt',required=True);args=p.parse_args()
root=pathlib.Path(args.verified_dir);reference=json.loads((root/'verification-original.json').read_text());verified=json.loads((root/'verification-downloaded.json').read_text());assert reference==verified and reference['rows']==127812
c=sqlite3.connect(pathlib.Path(args.database).resolve().as_uri()+'?mode=ro',uri=True);columns=[r[1] for r in c.execute('PRAGMA table_info(prizepicks_prop_lines)')];assert columns==reference['columns'];h=hashlib.sha256();n=0
for row in c.execute('SELECT * FROM prizepicks_prop_lines ORDER BY id'):
 data=json.dumps(row,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode();h.update(len(data).to_bytes(8,'big'));h.update(data);n+=1
assert n==reference['rows'] and h.hexdigest()==reference['fullRecordSha256'],'Unverified source database'
key=pathlib.Path(args.key_file).read_text().strip();assert len(key)==64
receipt=pathlib.Path(args.receipt);state=json.loads(receipt.read_text()) if receipt.exists() else {'cursor':0,'processed':0,'updated':0,'bytesRemoved':0}
while state['processed']<n:
 rows=[{'rowid':r[0],'id':r[1],'oldRaw':r[2]} for r in c.execute('SELECT rowid,id,raw_json FROM prizepicks_prop_lines WHERE rowid>? ORDER BY rowid LIMIT 2000',(state['cursor'],))];assert rows
 body=json.dumps({'afterRowid':state['cursor'],'rows':rows},ensure_ascii=False,separators=(',',':')).encode();assert len(body)<=8*1024*1024
 req=urllib.request.Request(ENDPOINT,data=body,headers={'x-maintenance-key':key,'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},method='POST')
 result=None
 for attempt in range(3):
  try:
   with urllib.request.urlopen(req,timeout=45) as response:result=json.load(response)
   break
  except urllib.error.HTTPError:raise
  except (urllib.error.URLError,TimeoutError):
   if attempt==2:raise
   time.sleep(.5)
 assert result and result['processed']==state['processed']+len(rows) and result['cursor']==rows[-1]['rowid'];state=result
 temporary=receipt.with_suffix('.tmp');temporary.write_text(json.dumps(state,indent=2)+'\n');temporary.replace(receipt)
 if state['processed']%5000==0 or state['processed']==n:print(json.dumps(state),flush=True)
print('COMPLETED',flush=True)
