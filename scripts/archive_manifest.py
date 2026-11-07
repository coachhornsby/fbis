"""Stable batch manifests, including read-only compatibility with legacy receipts.

Callers serialize a batch's writes (the manual workflows use concurrency groups).
No existing manifest is ever changed or deleted.
"""
import copy
import hashlib
import json

BASE = "https://www.googleapis.com/drive/v3/files"


def stable_manifest(manifest, collection):
    result = copy.deepcopy(manifest)
    for record in result[collection]:
        if "status" in record:
            if record["status"] not in ("created_verified", "existing_verified"):
                raise RuntimeError("MANIFEST_OPERATION_STATUS_INVALID")
            del record["status"]
    return result


def encode(manifest):
    return (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()


def save_batch_manifest(drive, parent, prefix, manifest, collection):
    """Reuse one byte-verified legacy manifest or create one stable manifest.

    A changed batch is a conflict, not a license to add another manifest with the
    same audit prefix. Lookup is bounded and refuses incomplete result sets.
    """
    stable = stable_manifest(manifest, collection)
    safe = prefix.replace("\\", "\\\\").replace("'", "\\'")
    safe_parent = parent.replace("\\", "\\\\").replace("'", "\\'")
    response = drive.request("GET", BASE, params={
        "q": f"'{safe_parent}' in parents and name contains '{safe}' and trashed = false",
        "fields": "nextPageToken,files(id,name,mimeType,parents,trashed)",
        "pageSize": 100, "spaces": "drive",
    }).json()
    if response.get("nextPageToken"):
        raise RuntimeError("MANIFEST_SCAN_PAGINATION")
    found = [item for item in response["files"] if item["name"].startswith(prefix)]
    if len(found) > 1:
        raise RuntimeError("AMBIGUOUS_BATCH_MANIFEST")
    if found:
        item = found[0]
        if item["mimeType"] != "application/json" or item.get("trashed") or parent not in item.get("parents", []):
            raise RuntimeError("MANIFEST_METADATA_COLLISION")
        data = drive.read(item["id"])
        expected_name = prefix + hashlib.sha256(data).hexdigest() + ".json"
        if item["name"] != expected_name:
            raise RuntimeError("MANIFEST_NAME_HASH_MISMATCH")
        if encode(stable_manifest(json.loads(data), collection)) != encode(stable):
            raise RuntimeError("IMMUTABLE_BATCH_MANIFEST_COLLISION")
        return item["id"], "existing_verified"
    data = encode(stable)
    return drive.save_immutable(parent, prefix + hashlib.sha256(data).hexdigest() + ".json", data)
