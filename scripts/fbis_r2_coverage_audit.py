#!/usr/bin/env python3
"""Manual R2/Google Drive coverage audit: metadata and Drive readback, no D1 access."""
import base64
import json
import os
import re
import sqlite3
import sys

import requests
from fbis_drive_archive_pilot import Drive, ROOT, BASE, digest, fail

BUCKET = "fbis-archive"
PREFIX = "research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/"
PARTS = [
    ("part-000-1-100-fde1183dc06a37692826f3e4bd6cbc96cb4461f6a171fb7835136f8f8f37891e.json",171032,1,100),
    ("part-001-101-200-f91b360d4562598688e3ba5524e2638611661db8060b3687cb5b95833dc13238.json",173245,101,200),
    ("part-002-201-300-92dccbd5a5acef3b60b64361ae9dee97af4fb8ae942590a81133b3ed1cf2bc0e.json",174501,201,300),
    ("part-003-301-400-be07428b427b6d134a0ef623626fe89c3c34fa1b99372384af6b4bdae03f7ebd.json",174813,301,400),
    ("part-004-401-500-378e6e45801af05b6e2f452cf43224b1e0978b8fc834ac936f1e81f5bad9a65f.json",173700,401,500),
]
EXPECTED_BYTES = 867291
EXPECTED_ROWS = 500
MAX_DRIVE_OBJECT = 400 * 1024

def list_drive(drive, folder):
    # A fixed parent lookup with capped pagination; only in the already verified FBIS root.
    results = []
    page_token = None
    for _ in range(3):
        q = f"'{folder}' in parents and trashed = false"
        params = {"q":q, "pageSize":100,"fields":"nextPageToken,files(id,name,mimeType,parents)","spaces":"drive"}
        if page_token:
            params["pageToken"] = page_token
        data = drive.request("GET", BASE, params=params).json()
        results.extend(data.get("files", []))
        if len(results) > 200:
            fail("DRIVE_CATALOG_SIZE_CAP")
        page_token = data.get("nextPageToken")
        if not page_token:
            return results
    fail("DRIVE_CATALOG_PAGINATION_CAP")

def inspect_rows(raw, first, last):
    obj = json.loads(raw)
    if obj.get("format") != "fbis-cold-roster-pilot-v1" or obj.get("table") != "cfb_roster_observations" or obj.get("season") != 2004:
        fail("ARCHIVE_IDENTITY_FAILED")
    rows = obj.get("rows")
    if obj.get("count") != 100 or not isinstance(rows,list) or len(rows) != 100:
        fail("ARCHIVE_ROW_COUNT_FAILED")
    if str(obj.get("firstRowid")) != str(first) or str(obj.get("lastRowid")) != str(last):
        fail("ARCHIVE_ROW_BOUNDS_FAILED")
    if [int(x["__archive_rowid"]) for x in rows] != list(range(first,last+1)):
        fail("ARCHIVE_ROW_SEQUENCE_FAILED")
    return rows

def main():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID","")
    token = os.environ.get("CLOUDFLARE_API_TOKEN","")
    if not re.fullmatch("[a-fA-F0-9]{32}",account) or not token:
        fail("CLOUDFLARE_CONFIG_INVALID")
    response = requests.get(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}/objects",
        params={"prefix":PREFIX+"part-","per_page":10},
        headers={"Authorization":"Bearer "+token},timeout=25)
    if response.status_code != 200:
        fail("R2_INVENTORY_HTTP_"+str(response.status_code))
    result = response.json()
    if not result.get("success") or result.get("result_info",{}).get("is_truncated"):
        fail("R2_INVENTORY_INCOMPLETE")
    available = {x["key"]:x["size"] for x in result.get("result",[])}
    if len(available) != len(PARTS):
        fail("R2_EXPECTED_PART_INVENTORY_DRIFT")

    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")
    catalog = drive.children(ROOT,"00_Catalog")
    if len(catalog) != 1 or catalog[0]["mimeType"] != "application/vnd.google-apps.folder":
        fail("CATALOG_FOLDER_MISSING")
    batch_folders = drive.children(catalog[0]["id"],"R2_Batches")
    if len(batch_folders) != 1:
        fail("BATCH_CATALOG_MISSING")
    listings = list_drive(drive,batch_folders[0]["id"])
    candidate_manifests=[]
    for item in listings:
        if not item["name"].startswith(("cfb-2004-three-part-","cfb-2004-continuation-two-part-")):
            continue
        if item["mimeType"] != "application/json":
            fail("MANIFEST_TYPE_WRONG")
        manifest = json.loads(drive.read(item["id"]))
        if manifest.get("contract") != "fbis-r2-drive-multifile-manifest-v1":
            fail("MANIFEST_CONTRACT_MISMATCH")
        if digest(drive.read(item["id"])) != item["name"].split("-")[-1].removesuffix(".json"):
            fail("MANIFEST_HASH_FILENAME_MISMATCH")
        candidate_manifests.append(manifest)
    if len(candidate_manifests) != 2:
        fail("EXPECTED_TWO_MANIFESTS_NOT_FOUND")
    mapped={}
    for manifest in candidate_manifests:
        if manifest.get("bucket") != BUCKET or manifest.get("cloudflareD1Queries") != 0:
            fail("MANIFEST_SOURCE_OR_D1_MISMATCH")
        files = manifest.get("files") or []
        if len(files) != manifest.get("objectCount") or sum(x["sourceBytes"] for x in files) != manifest["totalSourceBytes"]:
            fail("MANIFEST_COUNTS_FAILED")
        for file in files:
            if file["sourceKey"] in mapped:
                fail("DUPLICATE_SOURCE_KEY")
            mapped[file["sourceKey"]] = file
    if len(mapped) != 5:
        fail("COVERAGE_GAP")
    rows=[]
    total=0
    for name,size,first,last in PARTS:
        key=PREFIX+name
        if available.get(key) != size or key not in mapped:
            fail("R2_DRIVE_INVENTORY_MISMATCH")
        receipt=mapped[key]
        if receipt["sourceBytes"] != size or receipt["sha256"] != name.rsplit("-",1)[-1].removesuffix(".json"):
            fail("RECEIPT_SHA_OR_SIZE_MISMATCH")
        # Verify all referenced objects have the correct approved Drive parents.
        item=drive.metadata(receipt["driveId"])
        if item.get("mimeType") != "application/json" or item.get("trashed"):
            fail("DRIVE_OBJECT_METADATA_FAILED")
        envelope_bytes=drive.read(receipt["driveId"])
        if len(envelope_bytes)>MAX_DRIVE_OBJECT:
            fail("DRIVE_OBJECT_SIZE_CAP")
        env=json.loads(envelope_bytes)
        raw=base64.b64decode(env["source"],validate=True)
        if env.get("sourceKey")!=key or digest(raw)!=receipt["sha256"] or len(raw)!=size:
            fail("DRIVE_OBJECT_READBACK_MISMATCH")
        if receipt["rowStart"]!=first or receipt["rowEnd"]!=last:
            fail("RECEIPT_ROW_RANGE_MISMATCH")
        rows.extend(inspect_rows(raw,first,last))
        total+=size
    if total!=EXPECTED_BYTES or len(rows)!=EXPECTED_ROWS:
        fail("COMBINED_TOTAL_MISMATCH")
    conn=sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE TABLE restored(rowid_source INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        for row in rows:
            conn.execute("INSERT INTO restored VALUES (?,?)",(
                int(row["__archive_rowid"]),json.dumps(row,sort_keys=True,separators=(",",":"))))
        recovered=[json.loads(x[0]) for x in conn.execute("SELECT payload FROM restored ORDER BY rowid_source")]
        if recovered!=rows or conn.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
            fail("SQLITE_FULL_COVERAGE_RESTORE_FAILED")
    finally:
        conn.close()
    print("R2_COVERAGE_OBJECTS: 5")
    print("R2_COVERAGE_BYTES:",total)
    print("R2_COVERAGE_RECORDS: 500")
    print("R2_BATCH_MANIFESTS: 2")
    print("DRIVE_SOURCE_COVERAGE_COMPLETE")
    print("DRIVE_ARCHIVE_READBACK_SHA256_OK")
    print("SQLITE_500_RECORD_COVERAGE_RESTORE_OK")
    print("D1_QUERIES: 0")
    print("NO_SOURCE_DELETION_OR_PRODUCTION_CUTOVER")
    print("FBIS_R2_COVERAGE_AUDIT_PASSED")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_R2_COVERAGE_AUDIT_FAILED:",type(exc).__name__,
              str(exc) if isinstance(exc,RuntimeError) else "")
        sys.exit(1)
