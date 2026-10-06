#!/usr/bin/env python3
import hashlib, io, json, os, re
from pathlib import Path
from urllib.request import Request, urlopen
import pandas as pd

START=int(os.getenv("CFB_ROSTER_START") or "2004")
END=int(os.getenv("CFB_ROSTER_END") or "2026")
ROSTER_BASE="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/cfb_rosters/parquet"
GAME_BASE="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/game_rosters/parquet"
OUT=Path(os.getenv("CFB_ROSTER_OUT") or "artifacts/cfb-player-directory")
UA={"User-Agent":"FBIS-CFB-Player-Directory/1.0"}
SOURCE="SPORTSDATAVERSE_ESPN_CFB_ROSTERS"

OUT.mkdir(parents=True,exist_ok=True)
observed=pd.Timestamp.now(tz="UTC").isoformat()

def download_parquet(url):
    req=Request(url,headers=UA)
    with urlopen(req,timeout=120) as r:
        return pd.read_parquet(io.BytesIO(r.read()))

def missing(v):
    if v is None: return True
    if isinstance(v,float): return pd.isna(v)
    return False

def scalar(v):
    if missing(v): return None
    if isinstance(v,(list,tuple,dict,set)):
        return json.dumps(v,sort_keys=True,separators=(",",":"),default=str)
    s=str(v).strip()
    return s if s else None

def pick(row,*cols):
    for c in cols:
        if c in row.index:
            v=scalar(row[c])
            if v is not None: return v
    return None

def num(v):
    if missing(v): return None
    try: return float(v)
    except Exception: return None

def integer(v):
    if missing(v): return None
    try: return int(str(v).strip())
    except Exception:
        try: return int(float(v))
        except Exception: return None

def esc(v):
    if v is None: return "NULL"
    return "'" + str(v).replace("'","''") + "'"

def sqlnum(v):
    return "NULL" if v is None else str(v)

def norm(v):
    return re.sub(r"\s+"," ",re.sub(r"[^a-z0-9\s]"," ",str(v or "").lower().replace("&"," and "))).strip()

def hid(*parts):
    return hashlib.sha256("|".join(map(str,parts)).encode()).hexdigest()[:40]

def team_id(v):
    x=integer(v)
    return f"cfb:espn:{x}" if x is not None else None

def player_identity(row,season):
    aid=integer(row.get("athlete_id"))
    if aid is not None:
        return f"cfb:espn-player:{aid}","ESPN",str(aid),"RESOLVED",1.0
    key=":".join([
        str(season),
        str(integer(row.get("team_id")) or "unknown-team"),
        norm(pick(row,"full_name","display_name","athlete_display_name","short_name") or "unknown"),
        str(pick(row,"jersey") or "unknown"),
        str(pick(row,"position_abbreviation","position") or "unknown")
    ])
    return f"cfb:provisional:{hid(key)}",None,None,"PROVISIONAL",0.4

def payload(row,timing):
    keys=[
      "athlete_id","athlete_uid","athlete_guid","first_name","middle_name","last_name",
      "full_name","display_name","athlete_display_name","short_name","nickname","slug",
      "team_id","team_location","team_name","team_abbreviation","team_display_name",
      "position_id","position","position_abbreviation","position_name","jersey","jersey_right",
      "experience_years","experience_display_value","experience_abbreviation",
      "height","display_height","weight","display_weight","date_of_birth","active",
      "cfbd_home_city","cfbd_home_state","cfbd_home_country","cfbd_recruit_ids"
    ]
    out={k:scalar(row[k]) for k in keys if k in row.index and scalar(row[k]) is not None}
    out.update(timing or {})
    return out

coverage=[]
for season in range(START,END+1):
    roster_url=f"{ROSTER_BASE}/cfb_rosters_{season}.parquet"
    game_url=f"{GAME_BASE}/game_rosters_{season}.parquet"
    roster=download_parquet(roster_url)
    game=download_parquet(game_url)

    # Canonical season roster should already be one row per season/team/athlete.
    if "season" not in roster.columns: roster["season"]=season
    roster=roster.copy()
    if "team_id" in roster.columns:
        roster=roster[roster["team_id"].notna()].copy()

    timing={}
    game_rows=len(game)
    needed=[c for c in ["team_id","athlete_id","week","game_id"] if c in game.columns]
    if {"team_id","athlete_id"}.issubset(needed):
        g=game[needed].copy()
        g=g[g["team_id"].notna() & g["athlete_id"].notna()].copy()
        for c in ["team_id","athlete_id","week","game_id"]:
            if c in g.columns: g[c]=pd.to_numeric(g[c],errors="coerce")
        g=g.sort_values([c for c in ["week","game_id"] if c in g.columns])
        for (tid,aid),grp in g.groupby(["team_id","athlete_id"],dropna=True):
            first=grp.iloc[0]; last=grp.iloc[-1]
            timing[(int(tid),int(aid))]={
              "first_game_id": str(int(first["game_id"])) if "game_id" in grp.columns and pd.notna(first["game_id"]) else None,
              "first_week": int(first["week"]) if "week" in grp.columns and pd.notna(first["week"]) else None,
              "last_game_id": str(int(last["game_id"])) if "game_id" in grp.columns and pd.notna(last["game_id"]) else None,
              "last_week": int(last["week"]) if "week" in grp.columns and pd.notna(last["week"]) else None,
              "game_observations": int(len(grp))
            }

    sql=[
      f"DELETE FROM cfb_roster_membership WHERE source={esc(SOURCE)} AND season={season};"
    ]
    distinct_players=set()
    distinct_teams=set()
    provisional=0
    stable=0

    for _,r in roster.iterrows():
        tid_raw=integer(r.get("team_id"))
        tid=team_id(tid_raw)
        pid,provider,provider_pid,status,confidence=player_identity(r,season)
        if status=="PROVISIONAL": provisional+=1
        else: stable+=1
        distinct_players.add(pid)
        if tid: distinct_teams.add(tid)

        names=[pick(r,c) for c in ["full_name","display_name","athlete_display_name","short_name"]]
        canonical=next((x for x in names if x), None) or f"Unknown player {provider_pid or pid[-12:]}"
        first=pick(r,"first_name")
        middle=pick(r,"middle_name")
        last=pick(r,"last_name")
        position=pick(r,"position","position_name")
        position_abbrev=pick(r,"position_abbreviation")
        jersey=pick(r,"jersey")
        class_year=pick(r,"experience_display_value","experience_abbreviation")
        height=num(r.get("height"))
        weight=num(r.get("weight"))
        active=1 if season==END and scalar(r.get("active")) not in ("False","false","0") else 0
        tm=timing.get((tid_raw,integer(r.get("athlete_id")))) if tid_raw is not None and integer(r.get("athlete_id")) is not None else None
        tm=tm or {}
        games=integer(r.get("games_rostered")) or tm.get("game_observations")
        raw=payload(r,tm)
        raw_json=json.dumps(raw,sort_keys=True,separators=(",",":"),default=str)
        content_hash=hashlib.sha256(raw_json.encode()).hexdigest()
        effective_from=f"{season}-07-01T00:00:00Z"
        effective_to=f"{season+1}-07-01T00:00:00Z"

        sql.append(f"""INSERT INTO cfb_canonical_players
(player_id,canonical_name,first_name,middle_name,last_name,current_position,active,identity_status,identity_confidence,first_observed_at,last_observed_at,research_only,can_influence_projection,source_json,created_at,updated_at)
VALUES ({esc(pid)},{esc(canonical)},{esc(first)},{esc(middle)},{esc(last)},{esc(position)},{active},{esc(status)},{confidence},{esc(observed)},{esc(observed)},1,0,{esc(raw_json)},{esc(observed)},{esc(observed)})
ON CONFLICT(player_id) DO UPDATE SET
canonical_name=excluded.canonical_name,first_name=COALESCE(excluded.first_name,cfb_canonical_players.first_name),middle_name=COALESCE(excluded.middle_name,cfb_canonical_players.middle_name),last_name=COALESCE(excluded.last_name,cfb_canonical_players.last_name),current_position=COALESCE(excluded.current_position,cfb_canonical_players.current_position),active=MAX(cfb_canonical_players.active,excluded.active),identity_status=CASE WHEN cfb_canonical_players.identity_status='RESOLVED' THEN 'RESOLVED' ELSE excluded.identity_status END,identity_confidence=MAX(COALESCE(cfb_canonical_players.identity_confidence,0),COALESCE(excluded.identity_confidence,0)),last_observed_at=excluded.last_observed_at,research_only=1,can_influence_projection=0,source_json=excluded.source_json,updated_at=excluded.updated_at;""")

        if provider and provider_pid:
            provider_row=json.dumps({"athlete_id":provider_pid,"name":canonical},separators=(",",":"))
            sql.append(f"""INSERT INTO cfb_player_provider_ids
(id,player_id,provider,provider_player_id,provider_name,effective_from,effective_to,observed_at,confidence,raw_json,created_at,updated_at)
VALUES ({esc('espn:'+provider_pid)},{esc(pid)},'ESPN',{esc(provider_pid)},{esc(canonical)},NULL,NULL,{esc(observed)},1.0,{esc(provider_row)},{esc(observed)},{esc(observed)})
ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,provider_name=excluded.provider_name,observed_at=excluded.observed_at,confidence=1.0,raw_json=excluded.raw_json,updated_at=excluded.updated_at;""")

        for alias in dict.fromkeys([x for x in names if x]):
            na=norm(alias)
            if not na: continue
            aid=f"alias:{hid(pid,na,SOURCE)}"
            sql.append(f"""INSERT INTO cfb_player_aliases
(id,player_id,alias,normalized_alias,alias_type,source,effective_from,effective_to,observed_at,confidence,created_at)
VALUES ({esc(aid)},{esc(pid)},{esc(alias)},{esc(na)},'NAME',{esc(SOURCE)},NULL,NULL,{esc(observed)},{confidence},{esc(observed)})
ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,normalized_alias=excluded.normalized_alias,observed_at=excluded.observed_at,confidence=excluded.confidence;""")

        mid=f"membership:{hid(pid,tid or 'UNKNOWN_TEAM',season,SOURCE)}"
        sql.append(f"""INSERT INTO cfb_roster_membership
(id,player_id,team_id,provider_team_id,season,position,position_abbreviation,jersey,class_year,height,weight,first_game_id,first_week,last_game_id,last_week,games_rostered,effective_from,effective_to,source,source_timestamp,observed_at,ingested_at,confidence,raw_json,research_only,can_influence_projection)
VALUES ({esc(mid)},{esc(pid)},{esc(tid)},{esc(tid_raw)},{season},{esc(position)},{esc(position_abbrev)},{esc(jersey)},{esc(class_year)},{sqlnum(height)},{sqlnum(weight)},{esc(tm.get('first_game_id'))},{sqlnum(tm.get('first_week'))},{esc(tm.get('last_game_id'))},{sqlnum(tm.get('last_week'))},{sqlnum(games)},{esc(effective_from)},{esc(effective_to)},{esc(SOURCE)},NULL,{esc(observed)},{esc(observed)},{confidence},{esc(raw_json)},1,0)
ON CONFLICT(player_id,team_id,season,source) DO UPDATE SET
position=excluded.position,position_abbreviation=excluded.position_abbreviation,jersey=excluded.jersey,class_year=excluded.class_year,height=excluded.height,weight=excluded.weight,first_game_id=excluded.first_game_id,first_week=excluded.first_week,last_game_id=excluded.last_game_id,last_week=excluded.last_week,games_rostered=excluded.games_rostered,observed_at=excluded.observed_at,ingested_at=excluded.ingested_at,confidence=excluded.confidence,raw_json=excluded.raw_json,research_only=1,can_influence_projection=0;""")

        oid=f"rosterobs:{hid(SOURCE,season,tid_raw,provider_pid or pid,content_hash)}"
        sql.append(f"""INSERT OR IGNORE INTO cfb_roster_observations
(id,player_id,team_id,provider,provider_player_id,provider_team_id,season,position,jersey,class_year,first_game_id,first_week,last_game_id,last_week,games_rostered,payload_json,source_timestamp,observed_at,ingested_at,content_hash,confidence,research_only,can_influence_projection)
VALUES ({esc(oid)},{esc(pid)},{esc(tid)},'ESPN',{esc(provider_pid)},{esc(tid_raw)},{season},{esc(position)},{esc(jersey)},{esc(class_year)},{esc(tm.get('first_game_id'))},{sqlnum(tm.get('first_week'))},{esc(tm.get('last_game_id'))},{sqlnum(tm.get('last_week'))},{sqlnum(games)},{esc(raw_json)},NULL,{esc(observed)},{esc(observed)},{esc(content_hash)},{confidence},1,0);""")

    shard=OUT/f"cfb-player-directory-{season}.sql"
    shard.write_text("\n".join(sql)+"\n")
    cov={
      "season":season,
      "rosterRows":int(len(roster)),
      "stableIdRows":stable,
      "provisionalRows":provisional,
      "distinctCanonicalPlayers":len(distinct_players),
      "distinctTeams":len(distinct_teams),
      "gameRosterRows":int(game_rows),
      "timedMemberships":len(timing),
      "rosterUrl":roster_url,
      "gameRosterUrl":game_url,
      "sqlFile":str(shard)
    }
    coverage.append(cov)
    print(json.dumps(cov),flush=True)

final_sql=f"""
UPDATE cfb_canonical_players SET active=0;
UPDATE cfb_canonical_players
SET active=1
WHERE player_id IN (SELECT DISTINCT player_id FROM cfb_roster_membership WHERE season={END});

DELETE FROM cfb_roster_source_coverage WHERE source='{SOURCE}';
INSERT INTO cfb_roster_source_coverage
(season,source,roster_rows,distinct_players,distinct_teams,resolved_team_rows,orphan_team_rows,provisional_players,game_roster_rows,source_file,observed_at)
SELECT
  m.season,
  '{SOURCE}',
  COUNT(*),
  COUNT(DISTINCT m.player_id),
  COUNT(DISTINCT m.team_id),
  SUM(CASE WHEN t.team_id IS NOT NULL THEN 1 ELSE 0 END),
  SUM(CASE WHEN t.team_id IS NULL THEN 1 ELSE 0 END),
  COUNT(DISTINCT CASE WHEN p.identity_status='PROVISIONAL' THEN p.player_id END),
  MAX(COALESCE(m.games_rostered,0)),
  'sportsdataverse/cfbfastR-cfb-data/cfb/cfb_rosters/parquet',
  '{observed}'
FROM cfb_roster_membership m
LEFT JOIN cfb_canonical_teams t ON t.team_id=m.team_id
LEFT JOIN cfb_canonical_players p ON p.player_id=m.player_id
WHERE m.source='{SOURCE}'
GROUP BY m.season;
"""
(OUT/"cfb-player-directory-finalize.sql").write_text(final_sql.strip()+"\n")

qa={
 "generatedAt":observed,
 "source":SOURCE,
 "startSeason":START,
 "endSeason":END,
 "seasonFiles":len(coverage),
 "totalRosterRows":sum(x["rosterRows"] for x in coverage),
 "totalGameRosterRows":sum(x["gameRosterRows"] for x in coverage),
 "totalProvisionalRows":sum(x["provisionalRows"] for x in coverage),
 "coverage":coverage,
 "governance":{"overlayVersion":"FBIS-STATE-OVERLAY-v1","canInfluenceProjection":False,"canQualify":False,"canAuthorizeWager":False}
}
(OUT/"qa.json").write_text(json.dumps(qa,indent=2)+"\n")
print(json.dumps({k:v for k,v in qa.items() if k!="coverage"},indent=2))
