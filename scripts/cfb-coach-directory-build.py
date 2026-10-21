#!/usr/bin/env python3
import argparse, hashlib, json, os, re, urllib.parse, urllib.request
from pathlib import Path
from datetime import datetime, timezone

BASE="https://api.collegefootballdata.com"
SOURCE="CFBD_COACHES"

def norm(s):
    return re.sub(r"\s+"," ",re.sub(r"[^a-z0-9]+"," ",str(s or "").lower())).strip()

def q(s):
    return "'" + str(s if s is not None else "").replace("'","''") + "'"

def fetch(year, token):
    url=BASE+"/coaches?"+urllib.parse.urlencode({"year":year})
    req=urllib.request.Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=60) as r:
        data=json.load(r)
    if isinstance(data,dict) and isinstance(data.get("data"),list): data=data["data"]
    if not isinstance(data,list): raise RuntimeError(f"unexpected CFBD coaches payload for {year}")
    return data

def team_expr(name):
    n=norm(name)
    low=str(name or "").strip().lower()
    return f"""COALESCE(
      (SELECT MIN(team_id) FROM cfb_team_aliases WHERE normalized_alias={q(n)}
       HAVING COUNT(DISTINCT team_id)=1),
      (SELECT MIN(team_id) FROM cfb_canonical_teams WHERE lower(trim(school_name))={q(low)}
       HAVING COUNT(*)=1)
    )"""

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--start",type=int,default=2004); ap.add_argument("--end",type=int,default=2026)
    ap.add_argument("--out",default="tmp/cfb-coaches")
    args=ap.parse_args()
    token=os.environ.get("CFBD_API_KEY","").strip()
    if not token: raise SystemExit("CFBD_API_KEY required")
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    observed=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    for year in range(args.start,args.end+1):
        rows=fetch(year,token); sql=["BEGIN TRANSACTION;"]
        assignments=0
        for coach in rows:
            pid=str(coach.get("id") or "").strip()
            if not pid: continue
            first=str(coach.get("firstName") or "").strip(); last=str(coach.get("lastName") or "").strip()
            display=(" ".join(x for x in [first,last] if x)).strip() or f"CFBD Coach {pid}"
            person=f"cfb:cfbd-staff:{pid}"
            raw=json.dumps(coach,separators=(",",":"),sort_keys=True)
            sql.append(f"""INSERT INTO cfb_canonical_staff(person_id,display_name,first_name,last_name,identity_status,identity_confidence,active,research_only,can_influence_projection,first_observed_at,last_observed_at,created_at,updated_at)
VALUES({q(person)},{q(display)},{q(first)},{q(last)},'RESOLVED',1.0,0,1,0,{q(observed)},{q(observed)},{q(observed)},{q(observed)})
ON CONFLICT(person_id) DO UPDATE SET display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;""")
            sql.append(f"""INSERT INTO cfb_staff_provider_ids(id,person_id,provider,provider_person_id,observed_at,confidence,raw_json,created_at,updated_at)
VALUES({q('cfbd:'+pid)},{q(person)},'CFBD',{q(pid)},{q(observed)},1.0,{q(raw)},{q(observed)},{q(observed)})
ON CONFLICT(provider,provider_person_id) DO UPDATE SET person_id=excluded.person_id,observed_at=excluded.observed_at,raw_json=excluded.raw_json,updated_at=excluded.updated_at;""")
            alias=norm(display)
            sql.append(f"""INSERT OR IGNORE INTO cfb_staff_aliases(id,person_id,alias,normalized_alias,source,observed_at,confidence,created_at)
VALUES({q('cfbd:'+pid+':name')},{q(person)},{q(display)},{q(alias)},'CFBD',{q(observed)},1.0,{q(observed)});""")
            seasons=coach.get("seasons") or []
            season_rows=[s for s in seasons if int(s.get("year") or -1)==year]
            for s in season_rows:
                school=str(s.get("school") or "").strip()
                if not school: continue
                aid=hashlib.sha256(f"{person}|{school}|HEAD_COACH|{year}|{SOURCE}".encode()).hexdigest()[:32]
                # CFBD /coaches is season-grain. Do not invent intra-season transition dates.
                sql.append(f"""INSERT INTO cfb_staff_role_assignments(id,person_id,team_id,source_team_name,role,season,effective_from,effective_to,temporal_precision,interim,explicit_play_caller,pit_resolvable,temporal_confidence,source,source_timestamp,observed_at,raw_json,research_only,can_influence_projection,created_at,updated_at)
VALUES({q(aid)},{q(person)},{team_expr(school)},{q(school)},'HEAD_COACH',{year},NULL,NULL,'SEASON',0,NULL,0,0.60,{q(SOURCE)},NULL,{q(observed)},{q(json.dumps(s,separators=(",",":"),sort_keys=True))},1,0,{q(observed)},{q(observed)})
ON CONFLICT(person_id,source_team_name,role,season,source) DO UPDATE SET team_id=excluded.team_id,observed_at=excluded.observed_at,raw_json=excluded.raw_json,updated_at=excluded.updated_at;""")
                assignments+=1
        sql.append(f"""INSERT INTO cfb_staff_source_coverage(source,season,source_rows,canonical_staff,role_assignments,resolved_team_assignments,unresolved_team_assignments,pit_resolvable_assignments,pit_unresolved_assignments,observed_at)
SELECT {q(SOURCE)},{year},{len(rows)},
 COUNT(DISTINCT person_id),COUNT(*),
 SUM(CASE WHEN team_id IS NOT NULL THEN 1 ELSE 0 END),
 SUM(CASE WHEN team_id IS NULL THEN 1 ELSE 0 END),
 SUM(CASE WHEN pit_resolvable=1 THEN 1 ELSE 0 END),
 SUM(CASE WHEN pit_resolvable=0 THEN 1 ELSE 0 END),{q(observed)}
FROM cfb_staff_role_assignments WHERE source={q(SOURCE)} AND season={year}
ON CONFLICT(source,season) DO UPDATE SET source_rows=excluded.source_rows,canonical_staff=excluded.canonical_staff,role_assignments=excluded.role_assignments,resolved_team_assignments=excluded.resolved_team_assignments,unresolved_team_assignments=excluded.unresolved_team_assignments,pit_resolvable_assignments=excluded.pit_resolvable_assignments,pit_unresolved_assignments=excluded.pit_unresolved_assignments,observed_at=excluded.observed_at;""")
        sql.append("COMMIT;")
        (out/f"season-{year}.sql").write_text("\n".join(sql))
        print(json.dumps({"season":year,"sourceRows":len(rows),"assignments":assignments}))
    (out/"finalize.sql").write_text(f"""UPDATE cfb_canonical_staff SET active=CASE WHEN person_id IN (SELECT DISTINCT person_id FROM cfb_staff_role_assignments WHERE season={args.end}) THEN 1 ELSE 0 END, updated_at=datetime('now');\n""")

if __name__=="__main__": main()
