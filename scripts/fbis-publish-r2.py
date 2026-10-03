#!/usr/bin/env python3
"""Publish an immutable FBIS snapshot to Cloudflare R2 using the Cloudflare API token."""
import argparse,json,os,mimetypes,urllib.request,urllib.error
from pathlib import Path
from urllib.parse import quote

API="https://api.cloudflare.com/client/v4"

def put(account,bucket,key,path=None,body=None,content_type=None):
    # Keep slashes literal in the R2 object key; encode other reserved characters.
    encoded="/".join(quote(x,safe="") for x in key.split("/"))
    url=f"{API}/accounts/{account}/r2/buckets/{bucket}/objects/{encoded}"
    if path is not None:
        data=Path(path).read_bytes()
        if content_type is None:
            content_type=mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    else:
        data=body if isinstance(body,(bytes,bytearray)) else str(body).encode()
        content_type=content_type or "application/octet-stream"
    if len(data)>300*1024*1024:
        raise RuntimeError(f"R2 REST upload object exceeds 300MB endpoint limit: {key} bytes={len(data)}")
    req=urllib.request.Request(url,data=data,method="PUT",headers={
        "Authorization":f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
        "Content-Type":content_type,
        "Content-Length":str(len(data)),
        "User-Agent":"FBIS-Snapshot-Publisher/2.0",
    })
    try:
        with urllib.request.urlopen(req,timeout=600) as r:
            raw=r.read()
    except urllib.error.HTTPError as e:
        msg=e.read().decode("utf-8","replace")
        raise RuntimeError(f"R2 upload failed key={key} status={e.code} body={msg[:1000]}")
    parsed=json.loads(raw.decode() or "{}")
    if not parsed.get("success"):
        raise RuntimeError(f"R2 upload failed key={key}: {parsed.get('errors')}")
    return parsed.get("result") or {}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--bucket",default=os.getenv("FBIS_R2_BUCKET","fbis-archive"))
    ap.add_argument("--prefix",default="canonical")
    a=ap.parse_args()
    account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise SystemExit("CLOUDFLARE_API_TOKEN missing")
    m=json.loads(Path(a.manifest).read_text())
    base=f"{a.prefix}/{m['sport'].lower()}/{m['version']}"
    uploaded=[]
    for x in m["files"]:
        p=Path(x["path"])
        obj=f"{base}/files/{x['path']}"
        result=put(account,a.bucket,obj,path=p)
        uploaded.append({"key":obj,"size":x["bytes"],"etag":result.get("etag")})
    manifest_key=f"{base}/manifest.json"
    put(account,a.bucket,manifest_key,path=a.manifest,content_type="application/json")
    current={
        "version":m["version"],
        "manifestKey":manifest_key,
        "manifestSha256":m["manifestSha256"],
        "parentSnapshot":m.get("parentSnapshot"),
    }
    current_key=f"{a.prefix}/{m['sport'].lower()}/current.json"
    put(account,a.bucket,current_key,body=json.dumps(current).encode(),content_type="application/json")
    print(json.dumps({"ok":True,"bucket":a.bucket,"prefix":base,"objects":len(uploaded)+2,"currentKey":current_key},indent=2))

if __name__=="__main__":
    main()
