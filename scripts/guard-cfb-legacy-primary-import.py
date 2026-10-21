#!/usr/bin/env python3
"""Block legacy PRIMARY-only CFB manual imports after D1 cutover.

A manual directory import into the full PRIMARY cannot be reconciled safely
by count-only shadow sync once sport mode is active. Reject until the operator
has explicitly converted that importer to write CFB_DB and preserve any
PRIMARY-owned governance controls separately.
"""
import pathlib
import sys
import tomllib

def guard(wrangler_path):
    with open(wrangler_path, "rb") as f:
        cfg = tomllib.load(f)
    vars_prod = cfg.get("env", {}).get("production", {}).get("vars", {})
    mode = str(vars_prod.get("SPORT_DB_MODE_CFB", "shadow")).lower()
    if mode == "sport":
        raise RuntimeError(
            "CFB_PRIMARY_IMPORT_BLOCKED_AFTER_SPORT_CUTOVER: "
            "route CFB-owned SQL to fbis-cfb and shared governance to PRIMARY "
            "before running this manual importer"
        )
    if mode != "shadow":
        raise RuntimeError("CFB_IMPORT_MODE_UNKNOWN:" + mode)
    return True

if __name__ == "__main__":
    try:
        guard(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "wrangler.toml"))
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print("CFB_PRIMARY_IMPORT_ALLOWED_PRE_CUTOVER")
