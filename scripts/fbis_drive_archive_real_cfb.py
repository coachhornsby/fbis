#!/usr/bin/env python3
"""One-file, manually triggered real FBIS research archive. Never deletes or edits source."""
import hashlib
import json
import os
from pathlib import Path

from fbis_drive_archive_pilot import Drive, ROOT, BASE, MAX_BYTES, digest, fail

SOURCE = Path("data/research/cfb-drive-v2-cohort-20261022.tsv")
EXPECTED_ROWS = 20

def archive_file(drive, parent, name, payload):
    if not (0 < len(payload) <= MAX_BYTES):
        fail("SOURCE_SIZE_OUT_OF_BOUNDS")
    found = drive.children(parent, name)
    if len(found) > 1:
        fail("SOURCE_FILENAME_AMBIGUOUS")
    if found:
        item = found[0]
        if item.get("mimeType") != "text/tab-separated-values":
            fail("SOURCE_MIME_COLLISION")
        if drive.read(item["id"]) != payload:
            fail("SOURCE_CONTENT_COLLISION")
        return item["id"], "existing_verified"
    boundary = "fbisresearch2026"
    metadata = json.dumps({"name": name, "mimeType": "text/tab-separated-values",
                           "parents": [parent]})
    body = (
        "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        + metadata + "\r\n--" + boundary
        + "\r\nContent-Type: text/tab-separated-values; charset=UTF-8\r\n\r\n"
    ).encode() + payload + ("\r\n--" + boundary + "--\r\n").encode()
    uploaded = drive.request(
        "POST", "https://www.googleapis.com/upload/drive/v3/files",
        params={"uploadType": "multipart", "fields": "id,parents"},
        headers={"Content-Type": "multipart/related; boundary=" + boundary},
        data=body,
    ).json()
    if parent not in uploaded.get("parents", []):
        fail("ARCHIVE_PARENT_MISMATCH")
    if drive.read(uploaded["id"]) != payload:
        fail("ARCHIVE_BYTE_PARITY_FAILED")
    return uploaded["id"], "created_verified"


def main():
    if not SOURCE.is_file():
        fail("SOURCE_NOT_FOUND")
    raw = SOURCE.read_bytes()
    if len(raw) > MAX_BYTES:
        fail("SOURCE_TOO_LARGE")
    decoded = raw.decode("utf-8")
    lines = [l for l in decoded.splitlines() if l and not l.startswith("#")]
    if len(lines) != EXPECTED_ROWS:
        fail("CFB_COHORT_ROW_COUNT_MISMATCH")
    for line in lines:
        if len(line.split("\t")) != 4:
            fail("CFB_COHORT_FORMAT_DRIFT")
    local_hash = digest(raw)
    drive = Drive()
    root = drive.metadata(ROOT)
    if root.get("name") != "FBIS_Data" or root.get("mimeType") != "application/vnd.google-apps.folder" or root.get("trashed"):
        fail("DRIVE_ROOT_NOT_ALLOWED")

    research = drive.folder(ROOT, "04_Model_Evidence")
    cfb = drive.folder(research, "CFB")
    pilot = drive.folder(cfb, "2026-10-22")
    archive_name = f"cfb-drive-v2-cohort-20261022-{local_hash}.tsv"
    file_id, file_state = archive_file(drive, pilot, archive_name, raw)

    manifest = {
        "schema": "fbis-research-drive-archive-v1",
        "source": str(SOURCE),
        "sourceRepository": "coachhornsby/fbis",
        "sourceSha256": local_hash,
        "archive": {
            "folder": "FBIS_Data/04_Model_Evidence/CFB/2026-10-22",
            "fileId": file_id,
            "filename": archive_name,
            "size": len(raw),
            "sha256": local_hash,
            "rowCount": EXPECTED_ROWS,
        },
        "sourceReadOnly": True,
        "sourceDeletionAuthorized": False,
        "productionAuthority": False,
        "retentionReleaseAuthorized": False,
    }
    catalog = drive.folder(ROOT, "00_Catalog")
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    manifest_id, manifest_state = drive.save_immutable(
        catalog, "cfb-cohort-20261022-manifest-" + digest(manifest_bytes) + ".json", manifest_bytes
    )
    confirmed_manifest = json.loads(drive.read(manifest_id))
    confirmed_payload = drive.read(confirmed_manifest["archive"]["fileId"])
    if confirmed_payload != raw or digest(confirmed_payload) != confirmed_manifest["archive"]["sha256"]:
        fail("INDEPENDENT_RESTORE_PARITY_FAILED")
    print("SOURCE_FILE:", SOURCE)
    print("SOURCE_ROWS:", len(lines))
    print("SOURCE_BYTES:", len(raw))
    print("SOURCE_SHA256:", local_hash)
    print("ARCHIVE:", file_state)
    print("MANIFEST:", manifest_state)
    print("ARCHIVE_DOWNLOAD_PARITY_OK")
    print("SOURCE_UNCHANGED_AND_NOT_DELETED")
    print("FBIS_REAL_DATA_DRIVE_ARCHIVE_PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FBIS_REAL_DATA_DRIVE_ARCHIVE_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        raise SystemExit(1)
