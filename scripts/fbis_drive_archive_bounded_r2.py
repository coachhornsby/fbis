#!/usr/bin/env python3
"""Manual bounded R2 -> Google Drive copy, with independent archive readback.

No D1 API endpoints, source modifications, or deletion paths.
"""
import base64
import hashlib
import json
import os
import re
import sqlite3
import sys

import requests
from fbis_drive_archive_pilot import Drive, ROOT, digest, fail

BUCKET = "fbis-archive"
KEY = ("research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/"
       "part-000-1-100-fde1183dc06a37692826f3e4bd6cbc96cb4461f6a171fb7835136f8f8f37891e.json")
EXPECTED_SIZE = 171032
MAX_BYTES = 256 * 1024
EXPECTED_ROWS = 100
EXPECTED_TABLE = "cfb_roster_observations"

def read_r2_bounded(account, token):
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}"
    headers = {"Authorization": "Bearer " + token}
    # Exact key metadata lookup; no unbounded bucket listing.
    listing = requests.get(base + "/objects",
                           params={"prefix": KEY, "per_page": 2},
                           headers=headers, timeout=25)
    if listing.status_code != 200:
        fail("R2_METADATA_HTTP_" + str(listing.status_code))
    result = listing.json()
    matching = [x for x in result.get("result", [])
                if x.get("key") == KEY]
    if len(matching) != 1:
        fail("R2_EXACT_OBJECT_NOT_FOUND")
    size = matching[0].get("size")
    if size != EXPECTED_SIZE or size > MAX_BYTES:
        fail("R2_SIZE_PREFLIGHT_FAILED")
    with requests.get(base + "/objects/" + KEY, headers=headers, stream=True,
                      timeout=35) as response:
        if response.status_code != 200:
            fail("R2_OBJECT_HTTP_" + str(response.status_code))
        data = bytearray()
        for block in response.iter_content(chunk_size=8192):
            data.extend(block)
            if len(data) > MAX_BYTES:
                fail("R2_STREAM_SIZE_CAP")
    if len(data) != EXPECTED_SIZE:
        fail("R2_OBJECT_SIZE_CHANGED")
    return bytes(data)

def verify_archive(payload):
    obj = json.loads(payload)
    if obj.get("table") != EXPECTED_TABLE or obj.get("season") != 2004:
        fail("R2_ARCHIVE_IDENTITY_MISMATCH")
    rows = obj.get("rows")
    if not isinstance(rows, list) or len(rows) != EXPECTED_ROWS or obj.get("count") != EXPECTED_ROWS:
        fail("R2_ROW_COUNT_MISMATCH")
    ids = [int(x["__archive_rowid"]) for x in rows]
    if len(ids) != len(set(ids)) or ids != sorted(ids):
        fail("R2_ROWID_PARITY_FAILED")
    return rows

def restore_sqlite(rows):
    # Restore content into isolated SQLite using an identity key and canonical row JSON.
    # This verifies record-by-record losslessness, not production schema compatibility.
    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE restored (source_rowid INTEGER PRIMARY KEY, body TEXT NOT NULL)")
        for row in rows:
            db.execute("INSERT INTO restored VALUES (?, ?)",
                       (int(row["__archive_rowid"]),
                        json.dumps(row, sort_keys=True, separators=(",", ":"))))
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("SQLITE_INTEGRITY_FAILED")
        actual = [json.loads(record[0]) for record in
                  db.execute("SELECT body FROM restored ORDER BY source_rowid")]
        if actual != rows:
            fail("SQLITE_RECORD_RESTORE_MISMATCH")
        if len(actual) != EXPECTED_ROWS:
            fail("SQLITE_RECORD_COUNT_MISMATCH")
    finally:
        db.close()

def main():
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account or not re.fullmatch("[a-fA-F0-9]{32}", account):
        fail("CLOUDFLARE_CONFIG_MISSING_OR_INVALID")
    raw = read_r2_bounded(account, token)
    source_sha = digest(raw)
    # The content-addressed source key includes the expected SHA-256.
    if source_sha != KEY.rsplit("-", 1)[-1].removesuffix(".json"):
        fail("R2_SOURCE_CONTENT_HASH_MISMATCH")
    rows = verify_archive(raw)
    restore_sqlite(rows)
    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")
    archive_folder = drive.folder(ROOT, "04_Model_Evidence")
    cfb = drive.folder(archive_folder, "CFB")
    r2 = drive.folder(cfb, "R2_Cold_Archive")
    # Existing immutable Drive helper accepts JSON only; preserve original bytes in base64 envelope.
    envelope = {"contract": "fbis-r2-backup-envelope-v1", "encoding": "base64",
                "originalSize": len(raw), "originalSha256": source_sha,
                "raw": base64.b64encode(raw).decode("ascii")}
    envelope_bytes = (json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(envelope_bytes) > 400 * 1024:
        fail("DRIVE_ENVELOPE_SIZE_CAP")
    filename = "cfb-roster-2004-r2-" + source_sha + ".json"
    archive_id, archive_status = drive.save_immutable(r2, filename, envelope_bytes)
    manifest = {
        "contract": "fbis-r2-drive-backup-manifest-v1",
        "sourceBucket": BUCKET, "sourceKey": KEY,
        "originalBytes": len(raw), "originalSha256": source_sha,
        "rows": len(rows), "year": 2004, "table": EXPECTED_TABLE,
        "driveFolder": "FBIS_Data/04_Model_Evidence/CFB/R2_Cold_Archive",
        "driveFileId": archive_id,
        "sourceDeletionAuthorized": False, "productionAuthority": False,
        "retentionReleaseAuthorized": False, "noD1Queries": True
    }
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    catalog = drive.folder(ROOT, "00_Catalog")
    manifest_id, manifest_status = drive.save_immutable(
        catalog, "r2-cfb-2004-manifest-" + digest(manifest_bytes) + ".json", manifest_bytes
    )
    # Independent readback uses manifest and archived Drive content, not original local package.
    read_manifest = json.loads(drive.read(manifest_id))
    read_envelope = json.loads(drive.read(read_manifest["driveFileId"]))
    reconstructed = base64.b64decode(read_envelope["raw"], validate=True)
    if len(reconstructed) != read_manifest["originalBytes"] or digest(reconstructed) != read_manifest["originalSha256"]:
        fail("DRIVE_READBACK_HASH_MISMATCH")
    restore_sqlite(verify_archive(reconstructed))
    if reconstructed != raw:
        fail("BYTE_PARITY_FAILED")
    print("R2_SOURCE_SIZE:", len(raw))
    print("R2_SOURCE_SHA256:", source_sha)
    print("R2_RECORDS:", len(rows))
    print("GOOGLE_DRIVE_ARCHIVE:", archive_status)
    print("GOOGLE_DRIVE_MANIFEST:", manifest_status)
    print("R2_TO_DRIVE_INDEPENDENT_READBACK_OK")
    print("SQLITE_100_RECORD_RESTORE_OK")
    print("CLOUDFLARE_D1_QUERIES: 0")
    print("SOURCE_UNCHANGED_AND_NOT_DELETED")
    print("FBIS_BOUNDED_R2_DRIVE_ARCHIVE_PASSED")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_BOUNDED_R2_DRIVE_ARCHIVE_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        sys.exit(1)
