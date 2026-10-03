#!/usr/bin/env python3
"""Publish an immutable FBIS snapshot to Cloudflare R2 via S3 API."""
import argparse,json,os
from pathlib import Path
import boto3
def main():
 ap=argparse.ArgumentParser();ap.add_argument("manifest");ap.add_argument("--bucket",default=os.getenv("FBIS_R2_BUCKET","fbis-archive"));ap.add_argument("--prefix",default="canonical");a=ap.parse_args()
 account=os.environ["CLOUDFLARE_ACCOUNT_ID"]; key=os.environ["R2_ACCESS_KEY_ID"]; secret=os.environ["R2_SECRET_ACCESS_KEY"]
 s3=boto3.client("s3",endpoint_url=f"https://{account}.r2.cloudflarestorage.com",aws_access_key_id=key,aws_secret_access_key=secret,region_name="auto")
 m=json.loads(Path(a.manifest).read_text()); base=f"{a.prefix}/{m['sport'].lower()}/{m['version']}"
 for x in m["files"]:
  p=Path(x["path"]); obj=f"{base}/files/{x['path']}"
  s3.upload_file(str(p),a.bucket,obj,ExtraArgs={"Metadata":{"sha256":x["sha256"],"snapshot":m["version"]}})
 manifest_key=f"{base}/manifest.json";s3.upload_file(a.manifest,a.bucket,manifest_key,ExtraArgs={"ContentType":"application/json"})
 current={"version":m["version"],"manifestKey":manifest_key,"manifestSha256":m["manifestSha256"],"parentSnapshot":m.get("parentSnapshot")}
 s3.put_object(Bucket=a.bucket,Key=f"{a.prefix}/{m['sport'].lower()}/current.json",Body=json.dumps(current).encode(),ContentType="application/json")
 print(json.dumps({"ok":True,"bucket":a.bucket,"prefix":base,"objects":len(m["files"])+2},indent=2))
if __name__=="__main__":main()
