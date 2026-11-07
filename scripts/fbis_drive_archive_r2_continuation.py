#!/usr/bin/env python3
"""Manual continuation batch of two R2 objects. No D1 queries or source changes."""
import base64
import json
import os
import re
import sqlite3
import sys

import requests
from fbis_drive_archive_pilot import Drive, ROOT, digest, fail

BUCKET = "fbis-archive"
PREFIX = "research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/"
PARTS = (
    ("part-003-301-400-be07428b427b6d134a0ef623626fe89c3c34fa1b99372384af6b4bdae03f7ebd.json", 174813, 301, 400),
    ("part-004-401-500-378e6e45801af05b6e2f452cf43224b1e0978b8fc834ac936f1e81f5bad9a65f.json", 173700, 401, 500),
)
MAX_OBJECT_BYTES = 192 * 1024
MAX_TOTAL_BYTES = 400 * 1024
MAX_OBJECTS = 2


def get_r2(account, token, key, expected_size):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}/objects/" + key
    with requests.get(url, headers={"Authorization": "Bearer " + token},
                      stream=True, timeout=30) as response:
        if response.status_code != 200:
            fail("R2_OBJECT_HTTP_" + str(response.status_code))
        data = bytearray()
        for part in response.iter_content(8192):
            data.extend(part)
            if len(data) > MAX_OBJECT_BYTES:
                fail("OBJECT_STREAM_CAP")
    if len(data) != expected_size:
        fail("R2_SIZE_CHANGED")
    return bytes(data)


def check_rows(payload, first, last):
    archive = json.loads(payload)
    if archive.get("format") != "fbis-cold-roster-pilot-v1" or archive.get("table") != "cfb_roster_observations":
        fail("ARCHIVE_CONTRACT_MISMATCH")
    if archive.get("season") != 2004 or archive.get("count") != 100:
        fail("ARCHIVE_SEASON_OR_COUNT_MISMATCH")
    if str(archive.get("firstRowid")) != str(first) or str(archive.get("lastRowid")) != str(last):
        fail("ARCHIVE_ROW_BOUND_MISMATCH")
    rows = archive.get("rows")
    if not isinstance(rows, list) or len(rows) != 100:
        fail("ARCHIVE_ROWS_INVALID")
    ids = [int(row["__archive_rowid"]) for row in rows]
    if ids != list(range(first, last + 1)):
        fail("ARCHIVE_ROWID_SEQUENCE_MISMATCH")
    return rows


def sqlite_restore(rows):
    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE restored (rid INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        for row in rows:
            db.execute("INSERT INTO restored VALUES (?,?)", (
                int(row["__archive_rowid"]),
                json.dumps(row, sort_keys=True, separators=(",", ":")),
            ))
        db.row_factory = sqlite3.Row
        restored = [json.loads(x["payload"]) for x in db.execute("SELECT payload FROM restored ORDER BY rid")]
        if restored != rows or db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("INDEPENDENT_SQLITE_RESTORE_MISMATCH")
    finally:
        db.close()


def main():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token:
        fail("CLOUDFLARE_CONFIG_INVALID")
    if len(PARTS) > MAX_OBJECTS or sum(x[1] for x in PARTS) > MAX_TOTAL_BYTES:
        fail("TOTAL_BUDGET_PRECHECK")
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}"
    response = requests.get(base + "/objects", params={"prefix": PREFIX + "part-", "per_page": 10},
                            headers={"Authorization": "Bearer " + token}, timeout=25)
    if response.status_code != 200:
        fail("R2_LIST_HTTP_" + str(response.status_code))
    listing = response.json()
    if not listing.get("success"):
        fail("R2_LIST_FAILED")
    objects = listing.get("result", [])
    if listing.get("result_info", {}).get("is_truncated"):
        fail("R2_METADATA_TRUNCATED")
    expected = {PREFIX + name: size for name, size, _, _ in PARTS}
    for key, size in expected.items():
        matches = [obj for obj in objects if obj.get("key") == key]
        if len(matches) != 1 or matches[0].get("size") != size or size > MAX_OBJECT_BYTES:
            fail("R2_OBJECT_PREFLIGHT_FAILED")
    # Preflight completes before any objects are downloaded or Drive files created.
    payloads = []
    for name, size, first, last in PARTS:
        raw = get_r2(account, token, PREFIX + name, size)
        source_hash = digest(raw)
        if source_hash != name.rsplit("-", 1)[-1].removesuffix(".json"):
            fail("R2_SOURCE_HASH_MISMATCH")
        check_rows(raw, first, last)
        payloads.append((name, raw, source_hash, first, last))
    if sum(len(x[1]) for x in payloads) > MAX_TOTAL_BYTES:
        fail("TOTAL_BYTES_EXCEEDED")

    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")
    parent = drive.folder(ROOT, "04_Model_Evidence")
    parent = drive.folder(parent, "CFB")
    parent = drive.folder(parent, "R2_Cold_Archive")
    batch = drive.folder(parent, "Batch_2004_002")
    receipts = []
    all_rows = []
    for name, raw, checksum, first, last in payloads:
        envelope = {"contract": "fbis-r2-multifile-envelope-v1",
                    "sourceKey": PREFIX + name, "sourceSha256": checksum,
                    "sourceBytes": len(raw), "encoding": "base64",
                    "source": base64.b64encode(raw).decode("ascii")}
        data = (json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(data) > 400 * 1024:
            fail("ENVELOPE_SIZE_CAP")
        archive_id, status = drive.save_immutable(batch, "part-" + checksum + ".json", data)
        receipts.append({"sourceKey": PREFIX + name, "sourceBytes": len(raw),
                         "sha256": checksum, "driveId": archive_id,
                         "rowStart": first, "rowEnd": last, "status": status})
        all_rows.extend(check_rows(raw, first, last))
    manifest = {"contract": "fbis-r2-drive-multifile-manifest-v1",
                "bucket": BUCKET, "objectCount": len(receipts),
                "totalSourceBytes": sum(x["sourceBytes"] for x in receipts),
                "totalRows": len(all_rows), "files": receipts,
                "sourceDeletionAuthorized": False,
                "productionAuthority": False, "retentionReleaseAuthorized": False,
                "cloudflareD1Queries": 0}
    manifest_data = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    catalog = drive.folder(ROOT, "00_Catalog")
    catalog = drive.folder(catalog, "R2_Batches")
    manifest_id, manifest_state = drive.save_immutable(
        catalog, "cfb-2004-continuation-two-part-" + digest(manifest_data) + ".json", manifest_data)
    # Read only the downloaded Drive manifest and its referenced Drive files.
    remote_manifest = json.loads(drive.read(manifest_id))
    if remote_manifest["objectCount"] != 2 or remote_manifest["totalRows"] != 200:
        fail("REMOTE_MANIFEST_MISMATCH")
    restored_rows = []
    for rec in remote_manifest["files"]:
        stored = json.loads(drive.read(rec["driveId"]))
        raw = base64.b64decode(stored["source"], validate=True)
        if (len(raw) != rec["sourceBytes"] or digest(raw) != rec["sha256"]
                or stored["sourceKey"] != rec["sourceKey"]):
            fail("REMOTE_ARCHIVE_HASH_MISMATCH")
        restored_rows.extend(check_rows(raw, rec["rowStart"], rec["rowEnd"]))
    if [int(x["__archive_rowid"]) for x in restored_rows] != list(range(301, 501)):
        fail("FULL_BATCH_ROW_SEQUENCE_MISMATCH")
    if restored_rows != all_rows:
        fail("FULL_BATCH_DATA_PARITY_MISMATCH")
    sqlite_restore(restored_rows)
    print("R2_OBJECT_COUNT: 2")
    print("R2_ORIGINAL_BYTES:", remote_manifest["totalSourceBytes"])
    print("R2_TOTAL_ROWS: 200")
    print("R2_OBJECT_STATES:", ",".join(x["status"] for x in receipts))
    print("R2_BATCH_MANIFEST:", manifest_state)
    print("GOOGLE_DRIVE_BATCH_READBACK_SHA256_OK")
    print("SQLITE_200_RECORD_RESTORE_OK")
    print("CLOUDFLARE_D1_QUERIES: 0")
    print("SOURCE_UNCHANGED_AND_NOT_DELETED")
    print("FBIS_R2_CONTINUATION_DRIVE_ARCHIVE_PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_R2_MULTIFILE_DRIVE_ARCHIVE_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        sys.exit(1)
