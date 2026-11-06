#!/usr/bin/env python3
"""Bounded D1 -> Drive cold archive / independent in-memory SQLite restoration.

Manual only. Exactly two read-only D1 statements; no Cloudflare R2 writes,
no production D1 mutations, and no storage deletion.
"""
import gzip
import hashlib
import io
import json
import os
import re
import sqlite3
import sys

import requests
from fbis_drive_archive_pilot import Drive, ROOT, digest, fail

DB_ID = "b50c724c-903b-4241-8ce1-48d931e7a44c"
TABLE = "normalized_market_observations"
LIMIT_ROWS = 5
MAX_RESPONSE_BYTES = 128 * 1024
MAX_ARCHIVE_BYTES = 128 * 1024
MAX_BILLABLE_ROWS_READ = 1000
FIELDS = "rowid, *"


def cloudflare_query(sql, account, token):
    # No free-form SQL: callers use only the two fixed literal statements below.
    if sql not in (
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='normalized_market_observations'",
        "SELECT CAST(rowid AS TEXT) AS __fbis_rowid, * FROM normalized_market_observations WHERE rowid > 0 ORDER BY rowid LIMIT 5",
    ):
        fail("SQL_NOT_ALLOWLISTED")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{DB_ID}/query"
    with requests.post(
        url,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        json={"sql": sql},
        timeout=35,
        stream=True,
    ) as response:
        if response.status_code != 200:
            fail("D1_HTTP_" + str(response.status_code))
        raw = bytearray()
        for piece in response.iter_content(chunk_size=8192):
            raw.extend(piece)
            if len(raw) > MAX_RESPONSE_BYTES:
                fail("D1_RESPONSE_SIZE_CAP")
    data = json.loads(raw)
    if not data.get("success") or len(data.get("result", [])) != 1:
        fail("D1_QUERY_NOT_SUCCESSFUL")
    block = data["result"][0]
    meta = block.get("meta") or {}
    if block.get("success") is False or meta.get("changed_db") or int(meta.get("rows_written", 0)) != 0:
        fail("D1_MUTATION_ASSERTION_FAILED")
    rows_read = meta.get("rows_read")
    if rows_read is None or not 0 <= int(rows_read) <= MAX_BILLABLE_ROWS_READ:
        fail("D1_ROW_READ_BUDGET_EXCEEDED_OR_UNKNOWN")
    return block.get("results") or [], int(rows_read)


def isolated_restore(schema, rows, columns):
    if not re.match(r"^CREATE\s+TABLE\s+", schema, re.IGNORECASE):
        fail("SCHEMA_NOT_TABLE")
    if re.search(r"\b(VIRTUAL|ATTACH|PRAGMA|DROP)\b", schema, re.IGNORECASE):
        fail("SCHEMA_NOT_ALLOWED")
    if not columns or len(columns) > 80 or any(not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", x) for x in columns):
        fail("UNSAFE_COLUMN_NAME")
    db = sqlite3.connect(":memory:")
    try:
        db.execute(schema)
        quoted_columns = ",".join('"' + x + '"' for x in columns)
        placeholders = ",".join("?" for _ in range(len(columns) + 1))
        stmt = f'INSERT INTO "{TABLE}" (rowid,{quoted_columns}) VALUES ({placeholders})'
        for row in rows:
            db.execute(stmt, [int(row["__fbis_rowid"])] + [row[col] for col in columns])
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("SQLITE_INTEGRITY_FAILED")
        db.row_factory = sqlite3.Row
        actual = [
            dict(x) for x in db.execute(
                f'SELECT CAST(rowid AS TEXT) AS __fbis_rowid, * FROM "{TABLE}" ORDER BY rowid'
            )
        ]
        if actual != rows:
            fail("RESTORED_ROW_VALUES_MISMATCH")
    finally:
        db.close()
    return True


def main():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not account or not token:
        fail("CLOUDFLARE_SECRETS_NOT_CONFIGURED")
    if not re.fullmatch(r"[0-9a-f-]{36}", account):
        fail("INVALID_CLOUDFLARE_ACCOUNT_ID")
    schema_rows, cost_schema = cloudflare_query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='normalized_market_observations'",
        account, token
    )
    if len(schema_rows) != 1 or not schema_rows[0].get("sql"):
        fail("MISSING_SOURCE_TABLE")
    rows, cost_sample = cloudflare_query(
        "SELECT CAST(rowid AS TEXT) AS __fbis_rowid, * FROM normalized_market_observations WHERE rowid > 0 ORDER BY rowid LIMIT 5",
        account, token
    )
    if not rows:
        fail("SOURCE_SAMPLE_EMPTY")
    if len(rows) > LIMIT_ROWS:
        fail("ROW_CAP_EXCEEDED")
    columns = [c for c in rows[0] if c != "__fbis_rowid"]
    if any(set(row) != set(columns) | {"__fbis_rowid"} for row in rows):
        fail("INCONSISTENT_COLUMNS")
    schema = schema_rows[0]["sql"]
    isolated_restore(schema, rows, columns)
    package = {
        "contract": "fbis-bounded-d1-drive-archive-v1",
        "database": DB_ID, "table": TABLE, "schema": schema,
        "columns": columns, "rows": rows,
        "sampleOnly": True, "sourceRowsDeleted": 0,
        "sourceMutations": 0, "retentionReleaseAuthorized": False,
        "productionAuthority": False
    }
    unpacked = (json.dumps(package, sort_keys=True, separators=(",", ":")) + "\n").encode()
    compressed = gzip.compress(unpacked, mtime=0)
    if len(compressed) > MAX_ARCHIVE_BYTES:
        fail("ARCHIVE_SIZE_CAP")
    verified = json.loads(gzip.decompress(compressed))
    isolated_restore(verified["schema"], verified["rows"], verified["columns"])

    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")
    evidence = drive.folder(ROOT, "04_Model_Evidence")
    d1 = drive.folder(evidence, "D1")
    pilot = drive.folder(d1, "bounded-sample-v1")
    # Store gzip inside a JSON envelope for the existing immutable upload helper.
    import base64
    envelope = {
        "encoding": "gzip+base64", "contract": "fbis-d1-drive-envelope-v1",
        "gzipSha256": digest(compressed), "gzipSize": len(compressed),
        "payload": base64.b64encode(compressed).decode("ascii")
    }
    envelope_bytes = (json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n").encode()
    data_name = "d1-sample-" + digest(compressed) + ".json"
    file_id, status = drive.save_immutable(pilot, data_name, envelope_bytes)
    catalog = drive.folder(ROOT, "00_Catalog")
    manifest = {
        "contract": "fbis-bounded-d1-archive-manifest-v1",
        "dataId": file_id, "dataName": data_name,
        "folder": "FBIS_Data/04_Model_Evidence/D1/bounded-sample-v1",
        "sourceDatabase": DB_ID, "sourceTable": TABLE,
        "rows": len(rows), "columns": len(columns),
        "compressedSha256": digest(compressed), "uncompressedSha256": digest(unpacked),
        "compressedBytes": len(compressed), "sourceRowsRead": cost_schema + cost_sample,
        "productionAuthority": False, "sourceDeletionAuthorized": False,
        "retentionReleaseAuthorized": False
    }
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    manifest_id, manifest_status = drive.save_immutable(
        catalog, "d1-bounded-manifest-" + digest(manifest_bytes) + ".json", manifest_bytes
    )
    # Reconstruct solely from Drive manifest and Drive object: source package not reused.
    remote_manifest = json.loads(drive.read(manifest_id))
    remote_data = json.loads(drive.read(remote_manifest["dataId"]))
    restored_compressed = base64.b64decode(remote_data["payload"], validate=True)
    if digest(restored_compressed) != remote_manifest["compressedSha256"]:
        fail("DRIVE_COMPRESSED_HASH_MISMATCH")
    reconstructed = gzip.decompress(restored_compressed)
    if digest(reconstructed) != remote_manifest["uncompressedSha256"]:
        fail("DRIVE_UNCOMPRESSED_HASH_MISMATCH")
    restored = json.loads(reconstructed)
    isolated_restore(restored["schema"], restored["rows"], restored["columns"])
    if restored["rows"] != rows:
        fail("DRIVE_SOURCE_ROW_PARITY_FAILED")
    print("D1_ROWS_READ_BILLABLE_UPPER:", cost_schema + cost_sample)
    print("D1_SAMPLE_ROWS:", len(rows))
    print("D1_SAMPLE_COLUMNS:", len(columns))
    print("D1_COMPRESSED_BYTES:", len(compressed))
    print("D1_ARCHIVE:", status)
    print("D1_MANIFEST:", manifest_status)
    print("D1_INDEPENDENT_SQLITE_RESTORE_OK")
    print("D1_SOURCE_UNCHANGED_AND_NOT_DELETED")
    print("FBIS_BOUNDED_D1_DRIVE_ARCHIVE_PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_BOUNDED_D1_DRIVE_ARCHIVE_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        sys.exit(1)
