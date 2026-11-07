#!/usr/bin/env python3
"""Independent, read-only market R2/Drive coverage and recovery audit."""
import base64
import json
import os
import re
import sqlite3
import sys

import requests
from fbis_drive_archive_pilot import Drive, ROOT, BASE, digest, fail
from fbis_drive_archive_market_r2 import BUCKET, OBJECTS, MAX_BYTES_PER_OBJECT, validate

MAX_TOTAL_BYTES = 16 * 1024
MAX_ENVELOPE_BYTES = 20 * 1024

def list_exact_prefix(drive, folder_id, prefix):
    """One bounded Drive list, no wildcard access to unrelated folders."""
    query = f"'{folder_id}' in parents and name contains '{prefix}' and trashed = false"
    response = drive.request("GET", BASE, params={
        "q": query,
        "fields": "nextPageToken,files(id,name,mimeType,parents,trashed)",
        "pageSize": 20, "spaces": "drive",
    }).json()
    if response.get("nextPageToken"):
        fail("DRIVE_MANIFEST_PAGINATION_LIMIT")
    return [f for f in response["files"] if f["name"].startswith(prefix)]

def unique_folder(drive, parent_id, name):
    matches = drive.children(parent_id, name)
    if len(matches) != 1 or matches[0].get("mimeType") != "application/vnd.google-apps.folder":
        fail("EXPECTED_DRIVE_FOLDER_MISSING")
    return matches[0]["id"]

def inspect_r2(account, token):
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}"
    s = requests.Session()
    s.headers["Authorization"] = "Bearer " + token
    prefixes = sorted({key.rsplit("/", 1)[0] + "/" for key, *_ in OBJECTS})
    available = {}
    for prefix in prefixes:
        r = s.get(base + "/objects", params={"prefix": prefix, "per_page": 25}, timeout=25)
        if r.status_code != 200:
            fail("R2_INVENTORY_HTTP_" + str(r.status_code))
        listing = r.json()
        if not listing.get("success") or listing.get("result_info", {}).get("is_truncated"):
            fail("R2_INVENTORY_UNTRUSTED")
        for item in listing.get("result", []):
            available[item["key"]] = item["size"]
    result = {}
    for key, size, fmt, count in OBJECTS:
        if available.get(key) != size or size > MAX_BYTES_PER_OBJECT:
            fail("R2_SOURCE_INVENTORY_MISMATCH")
        with s.get(base + "/objects/" + key, stream=True, timeout=30) as resp:
            if resp.status_code != 200:
                fail("R2_SOURCE_HTTP_" + str(resp.status_code))
            data = bytearray()
            for block in resp.iter_content(4096):
                data.extend(block)
                if len(data) > MAX_BYTES_PER_OBJECT:
                    fail("R2_SOURCE_SIZE_CEILING")
        raw = bytes(data)
        if len(raw) != size:
            fail("R2_SOURCE_CHANGED")
        validate(raw, fmt, count)
        result[key] = raw
    return result

def verify_sqlite(groups):
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE TABLE restored(object_index INTEGER, row_index INTEGER, payload TEXT NOT NULL, PRIMARY KEY(object_index,row_index))")
        for oi, group in enumerate(groups):
            for ri, row in enumerate(group):
                conn.execute("INSERT INTO restored VALUES (?,?,?)", (
                    oi, ri, json.dumps(row, sort_keys=True, separators=(",", ":"))
                ))
        for oi, group in enumerate(groups):
            recovered = [json.loads(x[0]) for x in conn.execute(
                "SELECT payload FROM restored WHERE object_index=? ORDER BY row_index", (oi,)
            )]
            if recovered != group:
                fail("INDEPENDENT_RECORD_PARITY_FAILED")
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("INDEPENDENT_SQLITE_INTEGRITY_FAILED")
    finally:
        conn.close()

def main():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not re.fullmatch(r"[A-Fa-f0-9]{32}", account) or not token:
        fail("CLOUDFLARE_CREDS_INVALID")
    if len(OBJECTS) != 3 or sum(o[1] for o in OBJECTS) > MAX_TOTAL_BYTES:
        fail("SOURCE_LIMIT_INVALID")
    source = inspect_r2(account, token)

    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_INVALID")
    catalog = unique_folder(drive, ROOT, "00_Catalog")
    batches = unique_folder(drive, catalog, "R2_Batches")
    evidence = unique_folder(drive, ROOT, "04_Model_Evidence")
    history = unique_folder(drive, evidence, "Market_History")
    destination = unique_folder(drive, history, "R2_Pilot_003")

    matches = list_exact_prefix(drive, batches, "market-r2-pilot-003-")
    if len(matches) != 1:
        fail("MARKET_MANIFEST_MISSING_OR_AMBIGUOUS")
    metadata = matches[0]
    if metadata["mimeType"] != "application/json" or batches not in metadata.get("parents", []):
        fail("MARKET_MANIFEST_LOCATION_INVALID")
    manifest_bytes = drive.read(metadata["id"])
    if digest(manifest_bytes) != metadata["name"].removeprefix("market-r2-pilot-003-").removesuffix(".json"):
        fail("MARKET_MANIFEST_DIGEST_INVALID")
    manifest = json.loads(manifest_bytes)
    if (manifest.get("contract") != "fbis-market-r2-three-object-manifest-v1"
            or manifest.get("bucket") != BUCKET or manifest.get("cloudflareD1Queries") != 0
            or manifest.get("sourceDeletionAuthorized") is not False
            or manifest.get("retentionReleaseAuthorized") is not False
            or manifest.get("productionAuthority") is not False):
        fail("MARKET_MANIFEST_CONTRACT_INVALID")
    receipts = manifest.get("objects")
    if not isinstance(receipts, list) or len(receipts) != 3:
        fail("MARKET_MANIFEST_OBJECT_COUNT")
    by_key = {rec["key"]: rec for rec in receipts}
    if len(by_key) != 3 or set(by_key) != set(source):
        fail("MARKET_MANIFEST_SOURCE_COVERAGE")
    restored_groups = []
    for key, size, fmt, count in OBJECTS:
        rec = by_key[key]
        if rec["bytes"] != size or rec["records"] != count or rec["format"] != fmt:
            fail("MARKET_RECEIPT_METADATA_MISMATCH")
        if rec["sha256"] != digest(source[key]):
            fail("MARKET_RECEIPT_SOURCE_HASH_MISMATCH")
        item = drive.metadata(rec["driveId"])
        if item.get("trashed") or item.get("mimeType") != "application/json" or destination not in item.get("parents", []):
            fail("MARKET_ARCHIVE_PARENT_MISMATCH")
        envelope_bytes = drive.read(rec["driveId"])
        if len(envelope_bytes) > MAX_ENVELOPE_BYTES:
            fail("MARKET_ENVELOPE_CAP")
        env = json.loads(envelope_bytes)
        if (env.get("contract") != "fbis-market-r2-envelope-v1"
                or env.get("sourceKey") != key
                or env.get("sourceSize") != size
                or env.get("sourceSha256") != rec["sha256"]):
            fail("MARKET_ENVELOPE_METADATA_INVALID")
        content = base64.b64decode(env["payload"], validate=True)
        if content != source[key] or digest(content) != rec["sha256"]:
            fail("MARKET_DRIVE_SOURCE_BYTE_MISMATCH")
        restored_groups.append(validate(content, fmt, count))
    if sum(len(g) for g in restored_groups) != 39 or manifest["sourceBytes"] != 13269 or manifest["records"] != 39:
        fail("MARKET_AUDIT_TOTALS_MISMATCH")
    verify_sqlite(restored_groups)
    print("MARKET_COVERAGE_OBJECTS: 3")
    print("MARKET_COVERAGE_SOURCE_BYTES: 13269")
    print("MARKET_COVERAGE_RECORDS: 39")
    print("MARKET_COVERAGE_MANIFESTS: 1")
    print("MARKET_R2_TO_DRIVE_BYTES_EQUAL")
    print("MARKET_MANIFEST_SHA256_VERIFIED")
    print("MARKET_INDEPENDENT_SQLITE_39_RECORDS_OK")
    print("D1_QUERIES: 0")
    print("SOURCE_AND_DRIVE_UNCHANGED")
    print("FBIS_MARKET_R2_COVERAGE_AUDIT_PASSED")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_MARKET_R2_COVERAGE_AUDIT_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        sys.exit(1)
