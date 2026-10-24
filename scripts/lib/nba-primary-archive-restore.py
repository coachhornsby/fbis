#!/usr/bin/env python3
"""Offline, independent SQLite restoration of a frozen NBA PRIMARY table archive.
No access to a live database or Cloudflare credentials.
"""
import json
import sqlite3
import sys
from pathlib import Path

def main():
    manifest = json.loads(Path(sys.argv[1]).read_text())
    name = manifest["table"]
    columns = manifest["columns"]
    if not name.replace("_", "").isalnum() or not all(c.replace("_", "").isalnum() for c in columns):
        raise ValueError("INVALID_TABLE_OR_COLUMN_NAME")
    con = sqlite3.connect(":memory:")
    con.execute("PRAGMA foreign_keys=OFF")
    con.execute(manifest["schema"])
    quoted = lambda x: '"' + x.replace('"', '""') + '"'
    placeholders = ",".join("?" for _ in range(len(columns)+1))
    insert = "INSERT INTO " + quoted(name) + "(rowid," + ",".join(map(quoted,columns)) + ") VALUES(" + placeholders + ")"
    restored = 0
    for part in manifest["parts"]:
        package = json.loads(Path(part["localFile"]).read_text())
        if package["table"] != name or package["columns"] != columns:
            raise ValueError("PACKAGE_SCHEMA_DRIFT")
        rows = package["rows"]
        if len(rows) != part["count"]:
            raise ValueError("PACKAGE_COUNT_DRIFT")
        for row in rows:
            values = [int(row["__fbis_rowid"])] + [row[c] for c in columns]
            con.execute(insert, values)
            found = con.execute("SELECT CAST(rowid AS TEXT) AS __fbis_rowid,* FROM " + quoted(name) + " WHERE rowid=?", (int(row["__fbis_rowid"]),)).fetchone()
            if found is None:
                raise ValueError("RESTORE_MISSING_ROW")
            got = dict(zip(["__fbis_rowid"] + columns, found))
            if got != row:
                raise ValueError("RESTORE_FULL_FIELD_MISMATCH")
            restored += 1
    if restored != manifest["sourceFrozenCount"]:
        raise ValueError("RESTORE_TABLE_COUNT_MISMATCH")
    if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("RESTORE_INTEGRITY_FAILED")
    actual = con.execute("SELECT COUNT(*) FROM " + quoted(name)).fetchone()[0]
    if actual != restored:
        raise ValueError("RESTORE_DUPLICATE_ROWS")
    print(json.dumps({"ok":True,"table":name,"restoredRows":restored,"columns":len(columns),"fullFieldParity":True,"sqliteIntegrity":"ok","sourceRowsDeleted":0}))

if __name__ == "__main__":
    main()
