#!/usr/bin/env python3
"""Build historical CFB conference membership from the public SportsDataverse cfb_groups release."""
from __future__ import annotations
import io, json, os, urllib.request
from pathlib import Path
from datetime import datetime, timezone
import pandas as pd

START=int(os.getenv("CFB_CONF_START","2004"))
END=int(os.getenv("CFB_CONF_END","2026"))
BASE="https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfb_groups"
OUT=Path("artifacts/cfb-conference"); OUT.mkdir(parents=True,exist_ok=True)

def fetch(name):
    url=f"{BASE}/{name}.parquet"
    req=urllib.request.Request(url,headers={"User-Agent":"FBIS-CFB-Conference/2.0"})
    with urllib.request.urlopen(req,timeout=180) as r:
        raw=r.read()
    return pd.read_parquet(io.BytesIO(raw)),url

def norm_id(v):
    if pd.isna(v): return None
    try:return str(int(float(v)))
    except Exception:return str(v).strip()

def main():
    teams,team_url=fetch("cfb_team_group_seasons")
    groups,group_url=fetch("cfb_group_seasons")
    teams["season"]=pd.to_numeric(teams["season"],errors="coerce").astype("Int64")
    groups["season"]=pd.to_numeric(groups["season"],errors="coerce").astype("Int64")
    teams=teams[(teams.season>=START)&(teams.season<=END)].copy()
    groups=groups[(groups.season>=START)&(groups.season<=END)].copy()
    teams["team_id"]=teams["team_id"].map(norm_id)

    conf=groups[groups["level"].astype(str).str.lower().eq("conference")].copy()
    conf=conf.rename(columns={
        "group_id":"conference_id",
        "name":"conference_name",
        "short_name":"conference_short_name",
        "abbreviation":"conference_abbreviation",
        "parent_group_id":"conference_parent_group_id",
    })
    keep=[c for c in ["season","conference_id","conference_name","conference_short_name","conference_abbreviation","conference_parent_group_id"] if c in conf.columns]
    conf=conf[keep].drop_duplicates(["season","conference_id"])
    out=teams.merge(conf,on=["season","conference_id"],how="left")

    out["classification"]=out["subdivision_id"].astype(str).str.replace("cfb:","",regex=False).str.upper()
    out.loc[out["subdivision_id"].isna(),"classification"]=None
    out["conference_source"]="SportsDataverse cfb_groups"
    out["conference_source_url"]=team_url

    # Retain only one row per team-season-id source. ESPN ids are authoritative
    # for joining the ESPN/SportsDataverse schedule; CFBD-only ids remain archived.
    dup=int(out.duplicated(["season","team_id","team_id_source"]).sum())
    espn=out[out["team_id_source"].astype(str).str.lower().eq("espn")].copy()
    espn_dups=int(espn.duplicated(["season","team_id"]).sum())
    if espn_dups:
        raise RuntimeError(f"duplicate ESPN team-season memberships: {espn_dups}")

    out.to_parquet(OUT/"cfb_team_season_conference_all_sources_2004_2026.parquet",index=False)
    out.to_csv(OUT/"cfb_team_season_conference_all_sources_2004_2026.csv",index=False)
    espn.to_parquet(OUT/"cfb_team_season_conference_espn_2004_2026.parquet",index=False)
    espn.to_csv(OUT/"cfb_team_season_conference_espn_2004_2026.csv",index=False)
    conf.to_parquet(OUT/"cfb_conference_names_by_season_2004_2026.parquet",index=False)

    by_season=[]
    for season,g in espn.groupby("season"):
        by_season.append({
            "season":int(season),
            "teams":int(len(g)),
            "withConference":int(g["conference_id"].notna().sum()),
            "fbs":int(g["classification"].eq("FBS").sum()),
            "fcs":int(g["classification"].eq("FCS").sum()),
            "sourcesAgreeTrue":int(g.get("sources_agree",pd.Series(dtype=bool)).fillna(False).eq(True).sum()) if "sources_agree" in g else 0,
            "sourcesAgreeFalse":int(g.get("sources_agree",pd.Series(dtype=bool)).fillna(False).eq(False).sum()) if "sources_agree" in g else 0,
        })
    qa={
        "generatedAt":datetime.now(timezone.utc).isoformat(),
        "requestedSeasons":[START,END],
        "allSourceRows":int(len(out)),
        "espnTeamSeasonRows":int(len(espn)),
        "duplicateRowsAllSources":dup,
        "duplicateEspnTeamSeasons":espn_dups,
        "firstSeason":int(espn.season.min()) if len(espn) else None,
        "lastSeason":int(espn.season.max()) if len(espn) else None,
        "espnRowsWithConference":int(espn["conference_id"].notna().sum()),
        "conferenceCoveragePct":round(float(espn["conference_id"].notna().mean()*100),3) if len(espn) else 0,
        "source":"SportsDataverse cfb_groups public bulk release",
        "sourceUrls":[team_url,group_url],
        "policy":"Per-season membership only; never backfilled from current alignment. ESPN team IDs used for schedule joins. Source agreement and notes retained.",
        "bySeason":by_season,
    }
    (OUT/"qa.json").write_text(json.dumps(qa,indent=2))
    if qa["firstSeason"]!=START or qa["lastSeason"]!=END:
        raise RuntimeError(f"conference season coverage incomplete: {qa}")
    if qa["conferenceCoveragePct"]<95:
        raise RuntimeError(f"team-season conference coverage below 95%: {qa['conferenceCoveragePct']}")
    print(json.dumps(qa,indent=2))

if __name__=="__main__":main()
