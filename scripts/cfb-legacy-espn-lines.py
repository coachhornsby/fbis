#!/usr/bin/env python3
import json, math, os, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import pandas as pd
import numpy as np

IN=Path("artifacts/cfb-history/cfb_game_training_full_history.csv")
OUT=Path("artifacts/cfb-legacy-espn"); OUT.mkdir(parents=True,exist_ok=True)
START=int(os.getenv("CFB_LEGACY_LINE_START","2002"))
END=int(os.getenv("CFB_LEGACY_LINE_END","2012"))
BASE="https://raw.githubusercontent.com/saiemgilani/pbp-data/main/data/cfb/{season}/{game_id}.json"

def norm_team(s):
    return " ".join(str(s or "").lower().replace("&","and").replace("-"," ").split())

def finite(v):
    try:
        x=float(v)
        return x if np.isfinite(x) else None
    except Exception:
        return None

def competitor_info(obj):
    comps=((obj.get("gameInfo") or {}).get("competitors") or [])
    out={}
    for c in comps:
        side=str(c.get("homeAway") or "").lower()
        team=c.get("team") or {}
        out[side]={
            "name":team.get("location") or team.get("displayName") or team.get("name"),
            "score":finite(c.get("score")),
        }
    return out

def pickcenter_total(obj):
    pc=obj.get("pickcenter") or []
    if not isinstance(pc,list): return None
    for row in pc:
        for key in ("overUnder","over_under","total","line"):
            v=finite(row.get(key)) if isinstance(row,dict) else None
            if v is not None and 10<=v<=120: return v
    return None

def fetch_row(rec):
    gid=str(rec["game_id"])
    season=int(rec["season"])
    url=BASE.format(season=season,game_id=gid)
    try:
        req=urllib.request.Request(url,headers={"User-Agent":"FBIS-CFB-Legacy-Lines/1.0"})
        with urllib.request.urlopen(req,timeout=30) as r:
            obj=json.loads(r.read())
        spread=finite(obj.get("homeTeamSpread"))
        if spread is not None and abs(spread)>80: spread=None
        total=pickcenter_total(obj)
        comp=competitor_info(obj)
        h=comp.get("home") or {}; a=comp.get("away") or {}
        # Fail closed when archive identity conflicts with target record.
        h_ok=not h.get("name") or norm_team(h.get("name")) in norm_team(rec.get("home_team")) or norm_team(rec.get("home_team")) in norm_team(h.get("name"))
        a_ok=not a.get("name") or norm_team(a.get("name")) in norm_team(rec.get("away_team")) or norm_team(rec.get("away_team")) in norm_team(a.get("name"))
        score_ok=True
        hs=finite(rec.get("home_score")); ass=finite(rec.get("away_score"))
        if h.get("score") is not None and hs is not None: score_ok &= abs(h["score"]-hs)<0.1
        if a.get("score") is not None and ass is not None: score_ok &= abs(a["score"]-ass)<0.1
        identity_ok=bool(h_ok and a_ok and score_ok)
        return {
            "game_id":gid,"season":season,
            "legacy_espn_home_spread":spread if identity_ok else None,
            "legacy_espn_total":total if identity_ok else None,
            "legacy_home_team":h.get("name"),"legacy_away_team":a.get("name"),
            "identity_ok":1 if identity_ok else 0,
            "source_url":url,"status":"ok" if identity_ok else "identity_mismatch",
        }
    except Exception as e:
        return {"game_id":gid,"season":season,"legacy_espn_home_spread":None,"legacy_espn_total":None,
                "legacy_home_team":None,"legacy_away_team":None,"identity_ok":0,
                "source_url":url,"status":f"error:{type(e).__name__}"}

def main():
    df=pd.read_csv(IN,low_memory=False)
    cand=df[(df.season>=START)&(df.season<=END)].copy()
    # Prefer archive only for games where CFBD did not already supply a real line.
    if "market_home_spread_median" in cand:
        existing=pd.to_numeric(cand["market_home_spread_median"],errors="coerce")
        cand=cand[existing.isna()]
    rows=[]
    with ThreadPoolExecutor(max_workers=32) as ex:
        futs=[ex.submit(fetch_row,r) for r in cand.to_dict("records")]
        for i,f in enumerate(as_completed(futs),1):
            rows.append(f.result())
            if i%500==0: print(json.dumps({"processed":i,"total":len(futs)}),flush=True)
    out=pd.DataFrame(rows)
    out.to_csv(OUT/"cfb_legacy_espn_lines_2002_2012.csv",index=False)
    qa={
      "source":"saiemgilani/pbp-data archived ESPN game JSON",
      "seasons":[START,END],
      "candidateGames":int(len(cand)),
      "archiveRows":int(len(out)),
      "identityPass":int((out.identity_ok==1).sum()) if len(out) else 0,
      "validSpreads":int(out.legacy_espn_home_spread.notna().sum()) if len(out) else 0,
      "validTotals":int(out.legacy_espn_total.notna().sum()) if len(out) else 0,
      "statusCounts":out.status.value_counts().to_dict() if len(out) else {},
      "policy":"Archive is fallback-only. A spread/total is accepted only after game identity validation; CFBD provider medians retain priority."
    }
    (OUT/"cfb_legacy_espn_lines_qa.json").write_text(json.dumps(qa,indent=2))
    print(json.dumps(qa,indent=2))
if __name__=="__main__": main()
