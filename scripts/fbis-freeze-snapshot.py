#!/usr/bin/env python3
"""Create/verify immutable FBIS canonical dataset manifests."""
import argparse, hashlib, json
from pathlib import Path
from datetime import datetime, timezone
def sha(p):
 h=hashlib.sha256()
 with open(p,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--sport",required=True);ap.add_argument("--version",required=True);ap.add_argument("--parent");ap.add_argument("--out",required=True);ap.add_argument("--root");ap.add_argument("files",nargs="*");a=ap.parse_args()
 fs=[]
 for x in a.files:
  p=Path(x)
  if not p.exists():raise SystemExit("missing snapshot input: "+x)
  fs.append({"path":x,"bytes":p.stat().st_size,"sha256":sha(p)})
 m={"schemaVersion":"fbis-snapshot-v2","sport":a.sport.upper(),"version":a.version,"frozen":True,"mutable":False,"parentSnapshot":a.parent,"createdAt":datetime.now(timezone.utc).isoformat(),"fileCount":len(fs),"totalBytes":sum(x["bytes"] for x in fs),"files":fs}
 raw=json.dumps(m,sort_keys=True,separators=(",",":")).encode();m["manifestSha256"]=hashlib.sha256(raw).hexdigest()
 Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(m,indent=2));print(json.dumps(m,indent=2))
if __name__=="__main__":main()
