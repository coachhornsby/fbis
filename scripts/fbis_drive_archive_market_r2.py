#!/usr/bin/env python3
"""Archive three fixed small market-evidence objects R2->Drive; no D1 calls or source mutation."""
from archive_manifest import save_batch_manifest

import base64
import json
import os
import re
import sqlite3
import sys
import requests
from fbis_drive_archive_pilot import Drive, ROOT, digest, fail

BUCKET = "fbis-archive"
OBJECTS = (
    ("research/storage-recovery/2026-10-16/market-history-shard/pilot-66261188c7e99f6fb3171bdeab3bf6dbd11b35e347f2b2c264b80f1420c1ea3f.json", 7754, "fbis-market-history-shadow-pilot-v1", 30),
    ("research/storage-recovery/2026-10-16/market-history-shard/ws-one-shot-9d7f97482fc30eed74d6488d3cb5a57cf1130c0abf7fb67a0e9693bc488af172.json", 2662, "FBIS-market-history-ws-source-preserving-pilot-v1", 8),
    ("research/storage-recovery/2026-10-17/market-pilot-ceadd4f8de481ef7ab40f7ca1a545bc5ca8803ed482c82a09fd2a358dfc5da65.json", 2853, "fbis-lossless-row-v1", 1),
)
MAX_BYTES_PER_OBJECT = 12 * 1024
MAX_TOTAL_BYTES = 16 * 1024
EXPECTED_TOTAL_RECORDS = 39

def validate(raw, expected_format, count):
    j = json.loads(raw)
    if j.get("format") != expected_format or not isinstance(j.get("rows"), list) or len(j["rows"]) != count:
        fail("SOURCE_FORMAT_OR_RECORD_COUNT_MISMATCH")
    if j.get("sourceRowsDeleted", j.get("productionRowsDeleted", 0)) != 0:
        fail("SOURCE_DECLARED_DELETION")
    if j.get("retentionReleaseAuthorized", False):
        fail("SOURCE_RETENTION_RELEASE")
    return j["rows"]

def sqlite_verify(grouped):
    db=sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE evidence (object_index INTEGER, record_index INTEGER, json_body TEXT, PRIMARY KEY(object_index,record_index))")
        for gi, rows in enumerate(grouped):
            for i, row in enumerate(rows):
                db.execute("INSERT INTO evidence VALUES (?,?,?)",(gi,i,json.dumps(row,sort_keys=True,separators=(",",":"))))
        for gi, rows in enumerate(grouped):
            actual=[json.loads(v[0]) for v in db.execute("SELECT json_body FROM evidence WHERE object_index=? ORDER BY record_index",(gi,))]
            if actual != rows:
                fail("SQLITE_EVIDENCE_RESTORE_MISMATCH")
        if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
            fail("SQLITE_INTEGRITY_FAILED")
    finally:
        db.close()

def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    account=os.environ.get("CLOUDFLARE_ACCOUNT_ID","")
    if not token or not re.fullmatch(r"[a-fA-F0-9]{32}",account):
        fail("CLOUDFLARE_CONFIG_INVALID")
    if len(OBJECTS)>3 or sum(o[1] for o in OBJECTS)>MAX_TOTAL_BYTES:
        fail("PRECHECK_TOTAL_CAP")
    base=f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}"
    session=requests.Session()
    session.headers.update({"Authorization":"Bearer "+token})
    # Fixed prefix metadata listings; never enumerate or scan D1.
    prefixes={
        "research/storage-recovery/2026-10-16/market-history-shard/",
        "research/storage-recovery/2026-10-17/"
    }
    inventory={}
    for prefix in sorted(prefixes):
        res=session.get(base+"/objects",params={"prefix":prefix,"per_page":25},timeout=25)
        if res.status_code!=200:
            fail("R2_LIST_HTTP_"+str(res.status_code))
        body=res.json()
        if not body.get("success") or body.get("result_info",{}).get("is_truncated"):
            fail("R2_LIST_INCOMPLETE")
        for obj in body.get("result",[]):
            inventory[obj["key"]]=obj["size"]
    for key,size,_,_ in OBJECTS:
        if size>MAX_BYTES_PER_OBJECT or inventory.get(key)!=size:
            fail("R2_PREFLIGHT_SIZE_OR_KEY_MISMATCH")

    contents=[]
    original_rows=[]
    for key,size,fmt,count in OBJECTS:
        with session.get(base+"/objects/"+key,stream=True,timeout=30) as r:
            if r.status_code!=200:
                fail("R2_GET_HTTP_"+str(r.status_code))
            chunks=bytearray()
            for chunk in r.iter_content(4096):
                chunks.extend(chunk)
                if len(chunks)>MAX_BYTES_PER_OBJECT:
                    fail("R2_STREAM_CAP")
        raw=bytes(chunks)
        if len(raw)!=size:
            fail("R2_OBJECT_SIZE_CHANGED")
        contents.append(raw)
        original_rows.append(validate(raw,fmt,count))
    sqlite_verify(original_rows)
    drive=Drive()
    root=drive.metadata(ROOT)
    if root.get("name")!="FBIS_Data" or root.get("mimeType")!="application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")
    f=drive.folder(ROOT,"04_Model_Evidence")
    f=drive.folder(f,"Market_History")
    f=drive.folder(f,"R2_Pilot_003")
    receipts=[]
    for (key,size,fmt,count),raw in zip(OBJECTS,contents):
        sha=digest(raw)
        envelope={"contract":"fbis-market-r2-envelope-v1","sourceKey":key,
                  "sourceSize":size,"sourceSha256":sha,
                  "encoding":"base64","payload":base64.b64encode(raw).decode("ascii")}
        envelope_bytes=(json.dumps(envelope,sort_keys=True,separators=(",",":"))+"\n").encode()
        fid,status=drive.save_immutable(f,"market-r2-"+sha+".json",envelope_bytes)
        receipts.append({"key":key,"bytes":size,"sha256":sha,"format":fmt,"records":count,"driveId":fid,"status":status})
    manifest={"contract":"fbis-market-r2-three-object-manifest-v1","bucket":BUCKET,
              "sourceBytes":sum(o[1] for o in OBJECTS),"records":EXPECTED_TOTAL_RECORDS,
              "objects":receipts,"cloudflareD1Queries":0,"sourceDeletionAuthorized":False,
              "retentionReleaseAuthorized":False,"productionAuthority":False}
    cat=drive.folder(ROOT,"00_Catalog")
    cat=drive.folder(cat,"R2_Batches")
    mid,mstate=save_batch_manifest(drive,cat,"market-r2-pilot-003-",manifest,"objects")
    m=json.loads(drive.read(mid))
    restored=[]
    for item in m["objects"]:
        doc=json.loads(drive.read(item["driveId"]))
        raw=base64.b64decode(doc["payload"],validate=True)
        if len(raw)!=item["bytes"] or digest(raw)!=item["sha256"] or doc["sourceKey"]!=item["key"]:
            fail("DRIVE_OBJECT_BYTE_PARITY_FAILED")
        restored.append(validate(raw,item["format"],item["records"]))
    if restored!=original_rows or sum(map(len,restored))!=EXPECTED_TOTAL_RECORDS:
        fail("RESTORED_RECORD_PARITY_FAILED")
    sqlite_verify(restored)
    print("MARKET_R2_FILES: 3")
    print("MARKET_R2_SOURCE_BYTES:",sum(o[1] for o in OBJECTS))
    print("MARKET_R2_RECORDS: 39")
    print("MARKET_R2_FILE_STATES:",",".join(x["status"] for x in receipts))
    print("MARKET_R2_MANIFEST:",mstate)
    print("MARKET_R2_INDEPENDENT_DRIVE_READBACK_OK")
    print("MARKET_R2_SQLITE_RECORD_RESTORE_OK")
    print("CLOUDFLARE_D1_QUERIES: 0")
    print("SOURCE_FILES_NOT_MODIFIED_OR_DELETED")
    print("FBIS_MARKET_R2_ARCHIVE_PASSED")

if __name__=="__main__":
    try:
        main()
    except Exception as e:
        print("FBIS_MARKET_R2_ARCHIVE_FAILED:",type(e).__name__,
              str(e) if isinstance(e,RuntimeError) else "")
        sys.exit(1)
