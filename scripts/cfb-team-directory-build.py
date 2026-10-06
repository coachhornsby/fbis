#!/usr/bin/env python3
import hashlib, io, json, os
from pathlib import Path
from urllib.request import Request, urlopen
import pandas as pd

START=int(os.getenv("CFB_DIRECTORY_START") or "2001")
END=int(os.getenv("CFB_DIRECTORY_END") or "2026")
BASE="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/cfb_teams/parquet"
OUT=Path(os.getenv("CFB_DIRECTORY_SQL") or "artifacts/cfb-directory/cfb-team-directory.sql")
UA={"User-Agent":"FBIS-CFB-Directory/1.1"}

def esc(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return "NULL"
    return "'" + str(v).replace("'","''") + "'"
def num(v):
    try:
        if pd.isna(v): return "NULL"
        return str(float(v))
    except: return "NULL"
def norm(v):
    import re
    return re.sub(r"\s+"," ",re.sub(r"[^a-z0-9\s]"," ",str(v or "").lower().replace("&"," and "))).strip()
def hid(*parts):
    return hashlib.sha256("|".join(map(str,parts)).encode()).hexdigest()[:32]
def tid(team_id): return f"cfb:espn:{int(team_id)}"

OUT.parent.mkdir(parents=True,exist_ok=True)
observed=pd.Timestamp.now(tz="UTC").isoformat()
frames=[]
coverage=[]
for year in range(START,END+1):
    url=f"{BASE}/cfb_teams_{year}.parquet"
    req=Request(url,headers=UA)
    with urlopen(req,timeout=90) as r:
        df=pd.read_parquet(io.BytesIO(r.read()))
    if "season" not in df.columns: df["season"]=year
    df=df[df["team_id"].notna()].copy()
    frames.append(df)
    coverage.append({"season":year,"rows":int(len(df)),"url":url})
    print(f"SportsDataverse cfb_teams season={year} rows={len(df)}",flush=True)

all_df=pd.concat(frames,ignore_index=True,sort=False)
all_df["team_id"]=all_df["team_id"].astype("int64")
all_df=all_df.sort_values(["team_id","season"])
latest=all_df.groupby("team_id",as_index=False).tail(1)
current=all_df[all_df["season"]==END]
current_ids=set(current["team_id"].astype(int).tolist())

def pick(row,*cols):
    for c in cols:
        if c in row.index:
            v=row[c]
            if pd.notna(v) and str(v).strip(): return v
    return None

sql=["BEGIN TRANSACTION;"]
for _,r in latest.iterrows():
    eid=int(r["team_id"]); team=tid(eid)
    school=pick(r,"school","display_name","location","name") or f"ESPN Team {eid}"
    mascot=pick(r,"mascot","nickname")
    conf=pick(r,"conference_name","cfbd_conference")
    subdivision=pick(r,"division","classification") or "UNKNOWN"
    active=1 if eid in current_ids else 0
    source={k:(None if pd.isna(v) else v) for k,v in r.to_dict().items()}
    source_json=json.dumps(source,default=str,separators=(",",":"))
    sql.append(f"""INSERT INTO cfb_canonical_teams
(team_id,school_name,athletic_name,abbreviation,subdivision,current_conference,independent,city,state,country,home_venue_id,home_stadium,latitude,longitude,timezone,elevation_feet,active,identity_confidence,research_only,can_influence_projection,source_json,first_observed_at,last_observed_at,created_at,updated_at)
VALUES ({esc(team)},{esc(school)},{esc(mascot)},{esc(pick(r,"abbreviation"))},{esc(subdivision)},{esc(conf)},{0 if conf else 1},{esc(pick(r,"city","venue_city"))},{esc(pick(r,"state","venue_state"))},{esc(pick(r,"country_code") or "USA")},{esc(pick(r,"venue_id"))},{esc(pick(r,"venue_name"))},{num(pick(r,"latitude"))},{num(pick(r,"longitude"))},{esc(pick(r,"timezone"))},{num(pick(r,"elevation"))},{active},1.0,1,0,{esc(source_json)},{esc(observed)},{esc(observed)},{esc(observed)},{esc(observed)})
ON CONFLICT(team_id) DO UPDATE SET school_name=excluded.school_name,athletic_name=excluded.athletic_name,abbreviation=excluded.abbreviation,subdivision=excluded.subdivision,current_conference=excluded.current_conference,independent=excluded.independent,city=excluded.city,state=excluded.state,country=excluded.country,home_venue_id=excluded.home_venue_id,home_stadium=excluded.home_stadium,latitude=excluded.latitude,longitude=excluded.longitude,timezone=excluded.timezone,elevation_feet=excluded.elevation_feet,active=excluded.active,identity_confidence=1.0,research_only=1,can_influence_projection=0,source_json=excluded.source_json,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;""")
    pid=f"espn:{eid}"
    sql.append(f"""INSERT INTO cfb_team_provider_ids
(id,team_id,provider,provider_team_id,provider_team_name,effective_from,effective_to,observed_at,confidence,raw_json,created_at,updated_at)
VALUES ({esc(pid)},{esc(team)},'ESPN',{esc(eid)},{esc(school)},NULL,NULL,{esc(observed)},1.0,{esc(source_json)},{esc(observed)},{esc(observed)})
ON CONFLICT(id) DO UPDATE SET provider_team_name=excluded.provider_team_name,observed_at=excluded.observed_at,confidence=1.0,raw_json=excluded.raw_json,updated_at=excluded.updated_at;""")
    aliases=[pick(r,c) for c in ["school","display_name","short_display_name","location","name","abbreviation","alt_name1","alt_name2","alt_name3"]]
    for a in dict.fromkeys([str(x).strip() for x in aliases if x is not None and str(x).strip()]):
        na=norm(a)
        if not na: continue
        aid=f"alias:{hid(team,na,'SPORTSDATAVERSE_ESPN')}"
        sql.append(f"""INSERT INTO cfb_team_aliases
(id,team_id,alias,normalized_alias,alias_type,source,effective_from,effective_to,observed_at,confidence,created_at)
VALUES ({esc(aid)},{esc(team)},{esc(a)},{esc(na)},'NAME','SPORTSDATAVERSE_ESPN',NULL,NULL,{esc(observed)},1.0,{esc(observed)})
ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,normalized_alias=excluded.normalized_alias,observed_at=excluded.observed_at,confidence=1.0;""")
    oid=f"obs:{hid('SPORTSDATAVERSE_ESPN',eid,observed[:10])}"
    sql.append(f"""INSERT OR IGNORE INTO cfb_team_identity_observations
(id,team_id,provider,provider_team_id,school_name,conference_name,subdivision,payload_json,source_timestamp,observed_at,ingested_at,content_hash,supersedes_id,confidence,research_only,can_influence_projection)
VALUES ({esc(oid)},{esc(team)},'SPORTSDATAVERSE_ESPN',{esc(eid)},{esc(school)},{esc(conf)},{esc(subdivision)},{esc(source_json)},NULL,{esc(observed)},{esc(observed)},{esc(hid(source_json))},NULL,1.0,1,0);""")

# Compress consecutive season conference/subdivision states per stable ESPN team id.
for eid,g in all_df.groupby("team_id"):
    runs=[]; run=None
    for _,r in g.sort_values("season").iterrows():
        year=int(r["season"])
        conf=pick(r,"conference_name","cfbd_conference")
        sub=pick(r,"division","classification")
        independent=0 if conf else 1
        state=(str(conf) if conf is not None else None,str(sub) if sub is not None else None,independent)
        if run and run["state"]==state and year==run["end"]+1:
            run["end"]=year
        else:
            if run: runs.append(run)
            run={"state":state,"start":year,"end":year,"r":r}
    if run: runs.append(run)
    for run in runs:
        conf,sub,ind=run["state"]; r=run["r"]
        frm=f"{run['start']}-07-01T00:00:00Z"
        to=f"{run['end']+1}-07-01T00:00:00Z" if run["end"]<END else None
        team=tid(int(eid))
        mid=f"membership:{hid(team,frm,conf or 'INDEPENDENT',sub or 'UNKNOWN')}"
        raw=json.dumps({"season_start":run["start"],"season_end":run["end"],"conference":conf,"subdivision":sub,"source":"sportsdataverse/cfbfastR-cfb-data:cfb_teams"},separators=(",",":"))
        sql.append(f"""INSERT INTO cfb_conference_membership
(id,team_id,conference_id,conference_name,subdivision,independent,effective_from,effective_to,source,observed_at,confidence,raw_json,created_at)
VALUES ({esc(mid)},{esc(team)},{esc(pick(r,"conference_id"))},{esc(conf)},{esc(sub)},{ind},{esc(frm)},{esc(to)},'SPORTSDATAVERSE_ESPN_CFB_TEAMS',{esc(observed)},1.0,{esc(raw)},{esc(observed)})
ON CONFLICT(id) DO UPDATE SET conference_id=excluded.conference_id,conference_name=excluded.conference_name,subdivision=excluded.subdivision,independent=excluded.independent,effective_to=excluded.effective_to,observed_at=excluded.observed_at,confidence=1.0,raw_json=excluded.raw_json;""")
sql.append("COMMIT;")
OUT.write_text("\n".join(sql)+"\n")

qa={
 "generatedAt":observed,
 "source":"sportsdataverse/cfbfastR-cfb-data/cfb/cfb_teams/parquet",
 "sourceProvider":"ESPN enriched with CFBD-only fields",
 "startSeason":START,"endSeason":END,
 "seasonFiles":len(coverage),"annualTeamRows":int(len(all_df)),
 "canonicalTeams":int(all_df["team_id"].nunique()),
 "currentSeasonTeams":int(len(current)),
 "membershipRuns":sum(1 for s in sql if s.startswith("INSERT INTO cfb_conference_membership")),
 "coverage":coverage,
 "governance":{"overlayVersion":"FBIS-STATE-OVERLAY-v1","canInfluenceProjection":False,"canQualify":False,"canAuthorizeWager":False}
}
OUT.with_suffix(".qa.json").write_text(json.dumps(qa,indent=2)+"\n")
print(json.dumps({k:v for k,v in qa.items() if k!="coverage"},indent=2))
