#!/usr/bin/env python3
"""FBIS manual, bounded Drive archive pilot. No Cloudflare or deletion APIs."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
import requests

ROOT = "1-cEe24VMCvfO55HZry5qxRaf0riTs6NO"
BASE = "https://www.googleapis.com/drive/v3/files"
MAX_BYTES = 1024 * 1024
FOLDER_MIME = "application/vnd.google-apps.folder"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fail(code):
    raise RuntimeError(code)


class Drive:
    def __init__(self):
        names = ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")
        if any(not os.environ.get(x) for x in names):
            fail("MISSING_GOOGLE_SECRETS")
        cred = Credentials(
            token=None,
            refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
            scopes=["https://www.googleapis.com/auth/drive"],
        )
        cred.refresh(Request())
        self.http = requests.Session()
        self.http.headers["Authorization"] = "Bearer " + cred.token

    def request(self, method, url, **kwargs):
        r = self.http.request(method, url, timeout=30, **kwargs)
        if not r.ok:
            fail("DRIVE_HTTP_" + str(r.status_code))
        return r

    def metadata(self, item):
        return self.request(
            "GET", BASE + "/" + item,
            params={"fields": "id,name,mimeType,parents,trashed", "supportsAllDrives": "true"},
        ).json()

    def children(self, parent, name):
        # Only enumerate exact-name children immediately under an already checked parent.
        safe = name.replace("\\", "\\\\").replace("'", "\\'")
        q = f"'{parent}' in parents and name = '{safe}' and trashed = false"
        response = self.request(
            "GET", BASE,
            params={"q": q, "fields": "nextPageToken,files(id,name,mimeType,parents,trashed)",
                    "page_size": 100, "spaces": "drive"},
        ).json()
        if response.get("nextPageToken"):
            fail("DUPLICATE_SCAN_PAGINATION")
        return response["files"]

    def folder(self, parent, name):
        found = self.children(parent, name)
        if len(found) > 1:
            fail("AMBIGUOUS_FOLDER")
        if found:
            if found[0]["mimeType"] != FOLDER_MIME:
                fail("FOLDER_NAME_COLLISION")
            return found[0]["id"]
        created = self.request(
            "POST", BASE, json={"name": name, "mimeType": FOLDER_MIME,
                                 "parents": [parent]},
            params={"fields": "id,name,mimeType,parents"},
        ).json()
        if created.get("parents") != [parent]:
            fail("NEW_FOLDER_PARENT_MISMATCH")
        return created["id"]

    def read(self, item):
        r = self.request("GET", BASE + "/" + item, params={"alt": "media"})
        if len(r.content) > MAX_BYTES:
            fail("READBACK_TOO_LARGE")
        return r.content

    def save_immutable(self, parent, name, payload):
        if len(payload) > MAX_BYTES:
            fail("PAYLOAD_TOO_LARGE")
        found = self.children(parent, name)
        if len(found) > 1:
            fail("AMBIGUOUS_OBJECT")
        if found:
            if found[0]["mimeType"] != "application/json":
                fail("OBJECT_TYPE_COLLISION")
            file_id = found[0]["id"]
            if self.read(file_id) != payload:
                fail("IMMUTABLE_OBJECT_COLLISION")
            return file_id, "existing_verified"
        # Plain multipart upload. Never updates or deletes an existing object.
        boundary = "fbispilotboundary"
        meta = json.dumps({"name": name, "mimeType": "application/json",
                           "parents": [parent]})
        body = (
            "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
            + meta + "\r\n--" + boundary
            + "\r\nContent-Type: application/json\r\n\r\n"
        ).encode() + payload + ("\r\n--" + boundary + "--\r\n").encode()
        uploaded = self.request(
            "POST", "https://www.googleapis.com/upload/drive/v3/files",
            params={"uploadType": "multipart", "fields": "id,parents"},
            headers={"Content-Type": "multipart/related; boundary=" + boundary},
            data=body,
        ).json()
        file_id = uploaded["id"]
        if parent not in uploaded.get("parents", []):
            fail("UPLOADED_OUTSIDE_ALLOWLIST")
        if self.read(file_id) != payload:
            fail("UPLOAD_READBACK_MISMATCH")
        return file_id, "created_verified"


def main():
    drive = Drive()
    root = drive.metadata(ROOT)
    if root["mimeType"] != FOLDER_MIME or root.get("trashed") or root["name"] != "FBIS_Data":
        fail("ALLOWLIST_ROOT_MISMATCH")
    catalog = drive.folder(ROOT, "00_Catalog")
    pilot = drive.folder(catalog, "Drive_Pilot")
    # Small deterministic synthetic payload; no personal or provider data.
    sample = {"schema": "fbis-drive-archive-pilot-v1",
              "dataset": "synthetic-smoke",
              "records": [{"sport": "CBB", "source": "synthetic", "value": 1}],
              "productionAuthority": False, "sourceDeletionAuthorized": False}
    payload = (json.dumps(sample, sort_keys=True, separators=(",", ":")) + "\n").encode()
    sha = digest(payload)
    data_name = "synthetic-smoke-" + sha + ".json"
    data_id, data_action = drive.save_immutable(pilot, data_name, payload)
    manifest = {
        "schema": "fbis-drive-manifest-v1",
        "dataset": "synthetic-smoke",
        "folder": "FBIS_Data/00_Catalog/Drive_Pilot",
        "object": {"name": data_name, "id": data_id, "bytes": len(payload), "sha256": sha},
        "archiveReadbackVerified": True,
        "productionAuthority": False, "sourceDeletionAuthorized": False,
        "retentionReleaseAuthorized": False,
    }
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    manifest_id, manifest_action = drive.save_immutable(
        pilot, "manifest-" + digest(manifest_bytes) + ".json", manifest_bytes
    )
    # Independently fetch and validate object referenced by retrieved manifest.
    remote_manifest = json.loads(drive.read(manifest_id))
    remote_data = drive.read(remote_manifest["object"]["id"])
    if digest(remote_data) != remote_manifest["object"]["sha256"] or len(remote_data) != remote_manifest["object"]["bytes"]:
        fail("MANIFEST_READBACK_FAILED")
    print("DRIVE_ROOT_ALLOWLIST_OK")
    print("DRIVE_ARCHIVE_BYTES:", len(remote_data))
    print("DRIVE_DATA:", data_action)
    print("DRIVE_MANIFEST:", manifest_action)
    print("DRIVE_MANIFEST_SHA256:", digest(manifest_bytes))
    print("DRIVE_ARCHIVE_READBACK_SHA256_OK")
    print("FBIS_DRIVE_ARCHIVE_PILOT_PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never print Google API response bodies or secrets.
        print("FBIS_DRIVE_ARCHIVE_PILOT_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "")
        sys.exit(1)
