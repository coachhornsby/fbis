#!/usr/bin/env python3
"""Verify every object described by an FBIS immutable snapshot manifest."""
import argparse,hashlib,json
from pathlib import Path
def sha(p):
 h=hashlib.sha256()
 with open(p,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser();ap.add_argument("manifest");a=ap.parse_args();m=json.loads(Path(a.manifest).read_text())
 if not m.get("frozen") or m.get("mutable") is not False:raise SystemExit("manifest is not immutable")
 bad=[]
 for x in m["files"]:
  p=Path(x["path"])
  if not p.exists() or p.stat().st_size!=x["bytes"] or sha(p)!=x["sha256"]:bad.append(x["path"])
 if bad:raise SystemExit("snapshot verification failed: "+",".join(bad[:20]))
 print(json.dumps({"ok":True,"sport":m["sport"],"version":m["version"],"files":len(m["files"]),"bytes":m.get("totalBytes"),"manifestSha256":m["manifestSha256"]},indent=2))
if __name__=="__main__":main()
