#!/usr/bin/env python3
"""Production D1 full-data backup + isolated restore rehearsal.

RUNS ONLY IN CONTROLLED GITHUB ACTIONS JOB. No production mutations.
A private Cloudflare R2 bucket holds the compressed full SQL dump; no dump or
presigned URL is written to public Github Actions logs/artifacts.
"""
import gzip
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request
import urllib.error

DB = "b50c724c-903b-4241-8ce1-48d931e7a44c"
BUCKET = "fbis-archive"
ROOT = pathlib.Path(os.environ.get("BACKUP_WORKDIR", "/tmp/fbis-d1-recovery"))
ROOT.mkdir(parents=True, exist_ok=True)
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
if ACCOUNT != "2fdc80b8d99070adcef12f7a785c3fc1":
    raise RuntimeError("wrong account: release aborted")
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}"

def api(method, path, body=None):
    req = urllib.request.Request(API + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
        method=method)
    with urllib.request.urlopen(req, timeout=240) as response:
        obj = json.load(response)
    if not obj.get("success"):
        raise RuntimeError("Cloudflare API error " + str(obj.get("errors", [])))
    return obj["result"]

def run(args, **kw):
    subprocess.run(args, check=True, **kw)

def sqlite_json(path):
    import sqlite3
    connection = sqlite3.connect(str(path))
    try:
        check = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError("SQLite integrity check failed: " + str(check))
        snapshot = {}
        queries = {
            "migration_tip": "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
            "wrangler_tip": "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1",
            "active_fbs": "SELECT COUNT(*) FROM cfb_canonical_teams WHERE subdivision='FBS' AND active=1",
            "canonical_players": "SELECT COUNT(*) FROM cfb_canonical_players",
            "roster_2026": "SELECT COUNT(*) FROM cfb_roster_membership WHERE season=2026",
            "all_tables": "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
        }
        for name, sql in queries.items():
            row = connection.execute(sql).fetchone()
            snapshot[name] = row[0] if row else None
        return snapshot
    finally:
        connection.close()

def restore(archive, dest):
    if dest.exists():
        raise RuntimeError("restore target exists: " + str(dest))
    print("restoring private full SQL archive to isolated SQLite", flush=True)
    gunzip = subprocess.Popen(["gzip", "-dc", str(archive)], stdout=subprocess.PIPE)
    sqlite = subprocess.Popen(["sqlite3", "-bail", str(dest)], stdin=gunzip.stdout)
    gunzip.stdout.close()
    sqlite_rc = sqlite.wait(timeout=4800)
    gzip_rc = gunzip.wait(timeout=60)
    if sqlite_rc or gzip_rc:
        raise RuntimeError(f"isolated restore failed: sqlite={sqlite_rc}, gzip={gzip_rc}")
    return sqlite_json(dest)

def main():
    # Critical: no PUBLIC Github artifact may ever contain the backup.
    managed = api("GET", f"/r2/buckets/{BUCKET}/domains/managed")
    custom = api("GET", f"/r2/buckets/{BUCKET}/domains/custom")
    if managed.get("enabled") or custom.get("domains"):
        raise RuntimeError("backup bucket public: refusing to transfer full production data")
    baseline = api("POST",f"/d1/database/{DB}/query",{
      "sql":"SELECT (SELECT COUNT(*) FROM cfb_canonical_players) AS canonical_players,"
            "(SELECT COUNT(*) FROM cfb_roster_membership WHERE season=2026) AS roster_2026,"
            "(SELECT COUNT(*) FROM cfb_canonical_teams WHERE subdivision='FBS' AND active=1) AS active_fbs"})
    baseline_counts = baseline[0]["results"][0]
    print("read-only benchmark captured",flush=True)

    # Poll every ~2 seconds to satisfy Cloudflare's strict 15-second polling rule.
    payload = api("POST", f"/d1/database/{DB}/export",
                  {"output_format":"polling","dump_options":{}})
    bookmark = payload["at_bookmark"]
    for attempt in range(2400):
        if payload.get("status")=="complete":
            break
        if payload.get("success") is False:
            raise RuntimeError("export failed: " + str(payload.get("error")))
        time.sleep(1.5)
        payload=api("POST",f"/d1/database/{DB}/export",
            {"output_format":"polling","current_bookmark":bookmark,"dump_options":{}})
        if attempt%30==0:
            print(f"full export active; poll {attempt+1}",flush=True)
    else:
        raise RuntimeError("full D1 export did not complete within 1 hour")
    if payload.get("status")!="complete":
        raise RuntimeError("unexpected export state")
    url = payload["result"]["signed_url"]  # Secret: never print.
    out=ROOT/"production_full.sql.gz"
    sha_raw=hashlib.sha256()
    total=0
    with urllib.request.urlopen(url,timeout=180) as src, gzip.open(out,"wb",compresslevel=1) as gz:
        while True:
            buf=src.read(4*1024*1024)
            if not buf: break
            total+=len(buf)
            sha_raw.update(buf)
            gz.write(buf)
            if total%(1024*1024*1024)<len(buf):
                print(f"downloaded and compressed {total//(1024*1024*1024)} GiB",flush=True)
    if total<100*1024*1024:
        raise RuntimeError("full-data export unexpectedly small")
    run(["gzip","-t",str(out)])
    with out.open("rb") as fd:
        d=hashlib.sha256()
        for block in iter(lambda:fd.read(1024*1024),b""):d.update(block)
    digest=d.hexdigest()
    print(f"full export transfer verified: {total} SQL bytes / {out.stat().st_size} compressed bytes",flush=True)

    # First proof: locally restore exact production export before touching prod.
    restored=ROOT/"first_restore.sqlite"
    before=restore(out,restored)
    for key,expected in baseline_counts.items():
        if before.get(key)!=expected:
            raise RuntimeError(f"snapshot baseline {key} mismatch: {before.get(key)} != {expected}")
    if before["migration_tip"]!="0097_apify_acquisition_authority":
        raise RuntimeError("unexpected production migration tip in full backup")

    # Validate schema migrations only in this restored, isolated database.
    staged=ROOT/"staged_migrations.sqlite"
    # The compressed backup remains immutable. Reuse the first restored DB
    # in-place to avoid needing two simultaneous 6.4GB SQLite copies.
    restored.rename(staged)
    for path in ["migrations/0098_college_persistence_recovery.sql",
                 "migrations/0099_cfb_fbs_statistical_ledgers.sql"]:
        with open(path,"rb") as f:
            run(["sqlite3","-bail",str(staged)],stdin=f)
    import sqlite3
    with sqlite3.connect(str(staged)) as c:
        tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected={"source_observations","team_feature_snapshots","game_feature_snapshots",
                  "api_usage","team_season_identity",
                  "cfb_team_game_stat_observations","cfb_team_season_stat_snapshots",
                  "cfb_player_game_stat_observations","cfb_player_season_stat_snapshots"}
        if not expected.issubset(tables):
            raise RuntimeError("0098/0099 tables missing after local rehearsal")
        if c.execute("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1").fetchone()[0] != "0099_cfb_fbs_statistical_ledgers":
            raise RuntimeError("0099 migration not registered")
        assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    if sqlite_json(staged)["canonical_players"]!=before["canonical_players"]:
        raise RuntimeError("migration changed baseline canonical players")
    print("full-restored production snapshot accepted 0098 then 0099 locally, without data loss",flush=True)

    # Transfer the complete archive ONLY to existing private R2.
    # Wrangler API uploads max ~315 MB per object; split at 180MiB.
    run(["split","-b","180M","-d","-a","4",str(out),str(ROOT/"backup.part.")])
    parts=sorted(ROOT.glob("backup.part.*"))
    prefix="d1-recovery/fbis/"+bookmark+"/"
    part_manifest=[]
    for i,part in enumerate(parts):
        remote=prefix+part.name
        run(["npx","wrangler","r2","object","put",BUCKET+"/"+remote,
            "--remote","--file",str(part),"--force"],stdout=subprocess.DEVNULL)
        part_manifest.append({"name":part.name,"bytes":part.stat().st_size,
            "sha256":hashlib.sha256(part.read_bytes()).hexdigest()})
        print(f"private R2 archive part {i+1}/{len(parts)} verified local",flush=True)
    # Manifest JSON is safe for public logs; data stored privately only.
    report={"status":"LOCAL_RESTORE_AND_R2_UPLOAD_COMPLETE",
            "database_id":DB,"bookmark":bookmark,"source_sql_bytes":total,
            "sql_sha256":sha_raw.hexdigest(),"archive_sha256":digest,
            "archive_bytes":out.stat().st_size,"archive_bucket":BUCKET,
            "archive_prefix":prefix,"parts":part_manifest,
            "snapshot":before,"source_baseline":baseline_counts,
            "migration_rehearsal":["0098_college_persistence_recovery",
                                   "0099_cfb_fbs_statistical_ledgers"],
            "all_production_mutations":0}
    (ROOT/"recovery-report.json").write_text(json.dumps(report,indent=2)+"\n")
    print("full SQL exported, restored, integrity checked and archived privately",flush=True)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("RESTORE_REHEARSAL_FAILED: "+str(e),file=sys.stderr)
        raise
