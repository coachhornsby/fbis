#!/usr/bin/env python3
import io, json, os, urllib.request
from pathlib import Path
import pandas as pd

START=int(os.getenv("CFB_CONTEXT_START","2004"))
END=int(os.getenv("CFB_CONTEXT_END","2026"))
BASE="https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
OUT=Path("artifacts/cfb-context"); OUT.mkdir(parents=True,exist_ok=True)

SETS={
 "ratings_weekly":("cfb_ratings_weekly","cfb_ratings_weekly_{year}.parquet",2004),
 "fpi_weekly":("cfb_fpi_weekly","cfb_fpi_weekly_{year}.parquet",2005),
 "team_talent":("cfb_team_talent","cfb_team_talent_{year}.parquet",2005),
 "returning_production":("cfb_returning_production","cfb_returning_production_{year}.parquet",2005),
 "recruits":("cfb_recruits","cfb_recruits_{year}.parquet",2002),
 "recruiting_proj":("cfb_recruiting_proj","cfb_recruiting_proj_{year}.parquet",2016),
}

def fetch(tag,tpl,year):
    url=f"{BASE}/{tag}/{tpl.format(year=year)}"
    req=urllib.request.Request(url,headers={"User-Agent":"FBIS-CFB-Context/1.0"})
    with urllib.request.urlopen(req,timeout=120) as r:
        return pd.read_parquet(io.BytesIO(r.read())),url

def main():
    status={}; frames={k:[] for k in SETS}; schemas={}
    for name,(tag,tpl,floor) in SETS.items():
        status[name]=[]
        for year in range(max(floor,START if name!="recruits" else floor),END+1):
            try:
                df,url=fetch(tag,tpl,year)
                if "season" not in df.columns: df["season"]=year
                df["fbis_source_year"]=year
                frames[name].append(df)
                status[name].append({"season":year,"rows":len(df),"ok":True,"url":url})
                schemas.setdefault(name,sorted(df.columns.tolist()))
            except Exception as e:
                status[name].append({"season":year,"rows":0,"ok":False,"error":str(e)})
        if frames[name]:
            all_df=pd.concat(frames[name],ignore_index=True,sort=False)
            all_df.to_parquet(OUT/f"cfb_{name}_history.parquet",index=False)
            # CSV only for modest tables. Weekly ratings/FPI are still small enough.
            all_df.to_csv(OUT/f"cfb_{name}_history.csv",index=False)
    summary={
      "generatedAt":pd.Timestamp.utcnow().isoformat(),
      "requestedSeasons":[START,END],
      "datasets":{},
      "schemas":schemas,
      "temporalPolicy":{
        "ratings_weekly":"For game in week W, use only a snapshot explicitly dated/through week < W or captured pre-kickoff. Never use final-season ratings retrospectively.",
        "fpi_weekly":"Use only historically captured pregame weekly snapshot; ESPN may overwrite slots, so snapshot identity matters.",
        "team_talent":"Season/preseason context.",
        "returning_production":"Preseason context.",
        "recruits":"Use classes known before the target season/game; do not use future class outcomes.",
        "recruiting_proj":"Use only projection published before target season/game."
      }
    }
    for name,items in status.items():
        ok=[x for x in items if x.get("ok") and x.get("rows",0)>0]
        summary["datasets"][name]={
          "first":ok[0]["season"] if ok else None,
          "last":ok[-1]["season"] if ok else None,
          "seasons":len(ok),
          "rows":sum(x["rows"] for x in ok),
          "failedSeasons":[x["season"] for x in items if not x.get("ok")],
        }
    (OUT/"cfb_program_context_qa.json").write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2))
    if summary["datasets"]["ratings_weekly"]["seasons"]<15:
        raise RuntimeError("weekly ratings coverage unexpectedly thin")
    if summary["datasets"]["team_talent"]["seasons"]<15 or summary["datasets"]["returning_production"]["seasons"]<15:
        raise RuntimeError("program context coverage unexpectedly thin")

if __name__=="__main__":main()
