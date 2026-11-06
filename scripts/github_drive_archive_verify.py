#!/usr/bin/env python3
"""Read-only Drive archive verification. Never publishes provider contents."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import urllib.request

SOURCES = (
    ("torvik", "1tJASpVptiIUlnTLFb3aTi8UrME1CCMWp", "30b2fab621e47fff73084a3a51bf8c7f94b45c4fa4c0ceb9bfbe39df680285bb", "torvik-manifest.json"),
    ("authenticated", "1zMC-68JGjYO3-Xly02SXZrO7SbxfnVVB", "fde1fb19484ac9821298f800d288f1fa036a4170e4732236e14c9ee8d339dbe4", "authenticated-archive-manifest.json"),
    ("current", "1m3bPodgfT-ESQBstwKG4T8X6D0C5V8Jk", "24189fbd54595e7f491c3f19daff6c354e4be3b1750e20a329bf7306301113fe", "archive-manifest.json"),
)
LIMIT = 25 * 1024 * 1024


def inspect_archive(data, name, expected_hash, manifest_name):
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_hash:
        raise ValueError("ARCHIVE_SHA256_MISMATCH")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = {m.name: m for m in archive.getmembers()}
        if manifest_name not in members:
            raise ValueError("MISSING_INTERNAL_MANIFEST")
        manifest = json.load(archive.extractfile(members[manifest_name]))
        expected = manifest.get("files", {})
        if not expected:
            raise ValueError("EMPTY_INTERNAL_MANIFEST")
        for path, item in expected.items():
            m = members.get(path)
            if not m or not m.isfile() or m.size != item["bytes"]:
                raise ValueError("MISSING_OR_WRONG_SIZE_MEMBER")
            raw = archive.extractfile(m).read()
            if hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError("MEMBER_SHA256_MISMATCH")
    return {"dataset": name, "sha256": digest, "memberCount": len(expected),
            "integrity": "VERIFIED", "snapshotSeason": manifest.get("season"),
            "projectionReady": bool(manifest.get("projectionReady", False))}


def drive_read(file_id, credentials):
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    scopes = ["https://www.googleapis.com/auth/drive.readonly"]
    cred = service_account.Credentials.from_service_account_info(credentials, scopes=scopes)
    cred.refresh(Request())
    req = urllib.request.Request(
        "https://www.googleapis.com/drive/v3/files/" + file_id + "?alt=media",
        headers={"Authorization": "Bearer " + cred.token, "Accept": "application/octet-stream"},
    )
    with urllib.request.urlopen(req, timeout=35) as response:
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("ARCHIVE_EXCEEDS_ALLOWED_BYTES")
    return data


def execute(credentials_text, out):
    if not credentials_text:
        raise ValueError("DRIVE_SERVICE_ACCOUNT_SECRET_MISSING")
    credentials = json.loads(credentials_text)
    if credentials.get("type") != "service_account":
        raise ValueError("DRIVE_CREDENTIAL_NOT_SERVICE_ACCOUNT")
    result = {"schema": "FBIS-DRIVE-READONLY-VERIFICATION-v1",
              "productionAuthority": False, "providerCalls": 0,
              "cloudflareCalls": 0, "wagerAuthorization": False,
              "archives": [], "allArchiveChecksPassed": False}
    # Never emit credential, OAuth response, download URL, raw data, or provider file.
    for name, file_id, expected_hash, manifest_name in SOURCES:
        row = {"dataset": name, "integrity": "BLOCKED"}
        try:
            content = drive_read(file_id, credentials)
            row = inspect_archive(content, name, expected_hash, manifest_name)
        except Exception as exc:
            row["errorCode"] = type(exc).__name__
        result["archives"].append(row)
        print(json.dumps(row), flush=True)
    result["allArchiveChecksPassed"] = all(r["integrity"] == "VERIFIED" for r in result["archives"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    if not result["allArchiveChecksPassed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="artifacts/college-drive-readonly/receipt.json")
    a = p.parse_args()
    execute(os.environ.get("FBIS_DRIVE_SERVICE_ACCOUNT_JSON", ""), Path(a.output))
