#!/usr/bin/env python3
"""
FBIS NFL PrizePicks historical backtest.

Free source:
  enkday/prizepicks-data-mirror git history, data/prizepicks-nfl.json

What this does:
1) Reconstructs historical daily PrizePicks NFL snapshots from git history.
2) Keeps the latest standard pregame line observed before game start for each
   player/game/stat.
3) Matches each line to nflverse schedule + weekly player results.
4) Reconstructs NFL-PLAYER-PROJ-v3 using only information available before the
   predicted game:
      65% weighted recent five
      25% current-season mean
      10% prior-season mean
      opponent position-defense factor strength 0.45
5) Restricts to QB1, RB1, WR1, WR2, TE1 based only on prior usage.
6) Grades MORE/LESS against the historical PrizePicks line.

This validates directional betting performance against actual historical
PrizePicks lines. It does not claim slip ROI because PrizePicks payouts depend
on card type, leg count, correlated-pick rules and promo terms.
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

MIRROR_DIR=Path(os.environ.get("PP_MIRROR_DIR","/tmp/prizepicks-data-mirror"))
OUT=Path("artifacts/nfl-prizepicks-history")
OUT.mkdir(parents=True,exist_ok=True)

RECENT_GAME_WEIGHTS=np.array([.35,.25,.18,.13,.09],dtype=float)
RECENT_WEIGHT=.65
CURRENT_WEIGHT=.25
PRIOR_WEIGHT=.10
DEF_STRENGTH=.45

TEAM_ALIASES={
 "JAC":"JAX","LA":"LAR","STL":"LAR","SD":"LAC","OAK":"LV","WSH":"WAS",
}
TEAM_NAME_TO_CODE={
 "arizona cardinals":"ARI","atlanta falcons":"ATL","baltimore ravens":"BAL",
 "buffalo bills":"BUF","carolina panthers":"CAR","chicago bears":"CHI",
 "cincinnati bengals":"CIN","cleveland browns":"CLE","dallas cowboys":"DAL",
 "denver broncos":"DEN","detroit lions":"DET","green bay packers":"GB",
 "houston texans":"HOU","indianapolis colts":"IND","jacksonville jaguars":"JAX",
 "kansas city chiefs":"KC","las vegas raiders":"LV","los angeles chargers":"LAC",
 "los angeles rams":"LAR","miami dolphins":"MIA","minnesota vikings":"MIN",
 "new england patriots":"NE","new orleans saints":"NO","new york giants":"NYG",
 "new york jets":"NYJ","philadelphia eagles":"PHI","pittsburgh steelers":"PIT",
 "san francisco 49ers":"SF","seattle seahawks":"SEA","tampa bay buccaneers":"TB",
 "tennessee titans":"TEN","washington commanders":"WAS",
}

STAT_MAP={
 "pass yards":"passing_yards",
 "passing yards":"passing_yards",
 "pass attempts":"attempts",
 "passing attempts":"attempts",
 "pass completions":"completions",
 "passing completions":"completions",
 "completions":"completions",
 "rush yards":"rushing_yards",
 "rushing yards":"rushing_yards",
 "rush attempts":"carries",
 "rushing attempts":"carries",
 "carries":"carries",
 "receiving yards":"receiving_yards",
 "rec yards":"receiving_yards",
 "receptions":"receptions",
 "rec receptions":"receptions",
}
FIELD_TO_MARKET={
 "passing_yards":"passing_yards",
 "attempts":"passing_attempts",
 "completions":"completions",
 "rushing_yards":"rushing_yards",
 "carries":"rushing_attempts",
 "receiving_yards":"receiving_yards",
 "receptions":"receptions",
}
FIELDS=list(FIELD_TO_MARKET.keys())

STATS_URL="https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
GAMES_URL="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

def norm_text(v):
    s=unicodedata.normalize("NFKD",str(v or "")).encode("ascii","ignore").decode("ascii")
    s=s.lower().replace("’","'").replace(".","")
    s=re.sub(r"[^a-z0-9]+"," ",s).strip()
    return s

def norm_team(v,name=None):
    s=str(v or "").strip().upper()
    s=TEAM_ALIASES.get(s,s)
    if s:return s
    return TEAM_NAME_TO_CODE.get(norm_text(name),"")

def read_csv_url(url):
    req=Request(url,headers={"User-Agent":"FBIS-PrizePicks-history/1.0"})
    with urlopen(req,timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def run_git(*args):
    return subprocess.check_output(["git","-C",str(MIRROR_DIR),*args],text=True,stderr=subprocess.DEVNULL)

def parse_ts(v):
    try:
        return pd.Timestamp(v)
    except Exception:
        return pd.NaT

def extract_snapshots():
    log=run_git("log","--format=%H|%cI","--","data/prizepicks-nfl.json")
    commits=[]
    for line in log.splitlines():
        if "|" not in line:continue
        sha,dt=line.split("|",1)
        commits.append((sha,dt))
    rows=[]
    failures=[]
    for sha,commit_time in commits:
        try:
            raw=run_git("show",f"{sha}:data/prizepicks-nfl.json")
            doc=json.loads(raw)
            snap_ts=parse_ts(doc.get("scrapedAt") or commit_time)
            for p in doc.get("props") or []:
                if str(p.get("sport") or "").upper()!="NFL":continue
                if str(p.get("status") or "").lower() not in ("pre_game","pregame",""):continue
                if str(p.get("oddsType") or "standard").lower()!="standard":continue
                stat_raw=str(p.get("stat") or "").strip()
                field=STAT_MAP.get(norm_text(stat_raw))
                if not field:continue
                line_val=pd.to_numeric(p.get("line"),errors="coerce")
                if pd.isna(line_val):continue
                start_ts=parse_ts(p.get("startTimeIso") or p.get("startTimeCST") or p.get("startTime"))
                fetched_ts=parse_ts(p.get("providerFetchedAt")) if p.get("providerFetchedAt") else snap_ts
                if pd.isna(start_ts) or pd.isna(fetched_ts):continue
                # Strict temporal rule: source observation must precede game start.
                try:
                    if fetched_ts.tzinfo is None and start_ts.tzinfo is not None:
                        fetched_ts=fetched_ts.tz_localize("UTC")
                    if start_ts.tzinfo is None and fetched_ts.tzinfo is not None:
                        start_ts=start_ts.tz_localize("UTC")
                    if fetched_ts >= start_ts:continue
                except Exception:
                    continue
                team=norm_team(p.get("teamCode"),p.get("Team"))
                opp=norm_team(p.get("opponentCode"),p.get("Opponent"))
                if not team or not opp:continue
                rows.append({
                    "source_sha":sha,
                    "snapshot_time":snap_ts.isoformat() if not pd.isna(snap_ts) else commit_time,
                    "provider_fetched_at":fetched_ts.isoformat(),
                    "start_time":start_ts.isoformat(),
                    "start_date":str(p.get("startDateCST") or "")[:10],
                    "game_id_pp":str(p.get("gameId") or ""),
                    "projection_id":str(p.get("projectionId") or ""),
                    "player_id_pp":str(p.get("playerId") or ""),
                    "player":str(p.get("player") or "").strip(),
                    "player_key":norm_text(p.get("player")),
                    "team":team,
                    "opponent":opp,
                    "stat_raw":stat_raw,
                    "field":field,
                    "market":FIELD_TO_MARKET[field],
                    "line":float(line_val),
                    "_fetched":fetched_ts,
                })
        except Exception as e:
            failures.append({"sha":sha,"error":str(e)[:300]})
    if not rows:
        raise RuntimeError("No usable PrizePicks NFL historical rows extracted")
    df=pd.DataFrame(rows)
    # Last pregame observation is closest available approximation of closing PP line.
    key=["game_id_pp","player_key","field"]
    df=df.sort_values("_fetched").drop_duplicates(key,keep="last").drop(columns=["_fetched"])
    return df,commits,failures

def load_games():
    g=read_csv_url(GAMES_URL)
    g=g[pd.to_numeric(g["season"],errors="coerce").isin([2025,2026])].copy()
    g["season"]=pd.to_numeric(g["season"],errors="coerce").astype(int)
    g["week"]=pd.to_numeric(g["week"],errors="coerce")
    g["gameday"]=pd.to_datetime(g["gameday"],errors="coerce").dt.date.astype(str)
    g["home_team"]=g["home_team"].map(lambda x:norm_team(x))
    g["away_team"]=g["away_team"].map(lambda x:norm_team(x))
    if "game_type" in g:
        g=g[g["game_type"].astype(str).eq("REG")].copy()
    return g

def attach_game_keys(lines,games):
    pair={}
    for r in games.itertuples(index=False):
        pair.setdefault(tuple(sorted((r.home_team,r.away_team))),[]).append(r)
    out=[]
    for r in lines.itertuples(index=False):
        candidates=pair.get(tuple(sorted((r.team,r.opponent))),[])
        best=None;best_delta=999
        for g in candidates:
            try:
                delta=abs((pd.Timestamp(r.start_date)-pd.Timestamp(g.gameday)).days)
            except Exception:
                delta=999
            if delta<best_delta:
                best,best_delta=g,delta
        d=r._asdict()
        if best is not None and best_delta<=2:
            d.update({"season":int(best.season),"week":float(best.week),"nfl_game_id":str(best.game_id),"schedule_date":best.gameday,"game_match_delta_days":best_delta})
        else:
            d.update({"season":np.nan,"week":np.nan,"nfl_game_id":"","schedule_date":"","game_match_delta_days":np.nan})
        out.append(d)
    return pd.DataFrame(out)

def load_stats():
    frames=[];status=[]
    for season in [2025,2026]:
        try:
            d=read_csv_url(STATS_URL.format(season=season))
            if "season" not in d:d["season"]=season
            d["season"]=pd.to_numeric(d["season"],errors="coerce").fillna(season).astype(int)
            d["week"]=pd.to_numeric(d["week"],errors="coerce")
            st=d["season_type"] if "season_type" in d else pd.Series("REG",index=d.index)
            d=d[st.astype(str).str.upper().eq("REG")].copy()
            idcol="player_id" if "player_id" in d else ("player_id_name" if "player_id_name" in d else "player_name")
            namecol="player_display_name" if "player_display_name" in d else ("player_name" if "player_name" in d else idcol)
            poscol="position" if "position" in d else "position_group"
            d["pid"]=d[idcol].astype(str); d["player"]=d[namecol].astype(str); d["player_key"]=d["player"].map(norm_text)
            d["pos"]=d[poscol].astype(str).str.upper(); d["team"]=d["team"].map(norm_team); d["opponent_team"]=d["opponent_team"].map(norm_team)
            for f in FIELDS:
                d[f]=pd.to_numeric(d[f],errors="coerce").fillna(0.0) if f in d else 0.0
            d=d[d.pos.isin(["QB","RB","WR","TE"]) & d.week.notna()].copy()
            frames.append(d[["season","week","team","opponent_team","pid","player","player_key","pos"]+FIELDS])
            status.append({"season":season,"rows":int(len(d)),"status":"ok"})
        except Exception as e:
            status.append({"season":season,"rows":0,"status":"failed","error":str(e)})
    if not frames:raise RuntimeError("No nflverse player stats")
    return pd.concat(frames,ignore_index=True).sort_values(["pid","season","week"]).reset_index(drop=True),status

def add_pregame_player_features(d):
    x=d.copy();g=x.groupby("pid",sort=False)
    for f in FIELDS:
        lags=[g[f].shift(i) for i in range(1,6)]
        den=sum(lag.notna().astype(float)*RECENT_GAME_WEIGHTS[i] for i,lag in enumerate(lags))
        num=sum(lag.fillna(0)*RECENT_GAME_WEIGHTS[i] for i,lag in enumerate(lags))
        x[f"recent_{f}"]=num/den.replace(0,np.nan)
        x[f"current_{f}"]=x.groupby(["pid","season"],sort=False)[f].transform(lambda s:s.shift(1).expanding().mean())
        x[f"sigma_{f}"]=x.groupby("pid",sort=False)[f].transform(lambda s:s.shift(1).rolling(8,min_periods=3).std())
    prior=x.groupby(["pid","season"],as_index=False)[FIELDS].mean()
    prior["season"]=prior["season"]+1
    prior=prior.rename(columns={f:f"prior_{f}" for f in FIELDS})
    x=x.merge(prior,on=["pid","season"],how="left")
    x["role_score"]=np.select(
        [x.pos.eq("QB"),x.pos.eq("RB"),x.pos.isin(["WR","TE"])],
        [x.recent_attempts*2+x.recent_carries*.2,
         x.recent_carries+x.recent_targets*.8 if "recent_targets" in x else x.recent_carries,
         x.recent_receptions*1.0 + x.recent_receiving_yards/20.0],
        default=np.nan,
    )
    x["rank"]=x.groupby(["season","week","team","pos"])["role_score"].rank(method="first",ascending=False)
    x["target_role"]=""
    x.loc[x.pos.eq("QB") & x["rank"].eq(1),"target_role"]="QB1"
    x.loc[x.pos.eq("RB") & x["rank"].eq(1),"target_role"]="RB1"
    x.loc[x.pos.eq("WR") & x["rank"].eq(1),"target_role"]="WR1"
    x.loc[x.pos.eq("WR") & x["rank"].eq(2),"target_role"]="WR2"
    x.loc[x.pos.eq("TE") & x["rank"].eq(1),"target_role"]="TE1"
    return x

def add_defense_features(x):
    # Full position-group production allowed to each defense per game.
    agg=x.groupby(["season","week","opponent_team","pos"],as_index=False)[FIELDS].sum().rename(columns={"opponent_team":"defense"})
    agg=agg.sort_values(["defense","pos","season","week"]).reset_index(drop=True)
    for f in FIELDS:
        agg[f"def_cur_{f}"]=agg.groupby(["defense","pos","season"],sort=False)[f].transform(lambda s:s.shift(1).expanding().mean())
    prior=agg.groupby(["defense","pos","season"],as_index=False)[FIELDS].mean()
    prior["season"]=prior["season"]+1
    prior=prior.rename(columns={f:f"def_prior_{f}" for f in FIELDS})
    agg=agg.merge(prior,on=["defense","pos","season"],how="left")
    agg["def_n"]=agg.groupby(["defense","pos","season"]).cumcount()
    for f in FIELDS:
        w=agg.def_n/(agg.def_n+8)
        cur=agg[f"def_cur_{f}"]; prv=agg[f"def_prior_{f}"]
        agg[f"def_allowed_{f}"]=np.where(cur.notna()&prv.notna(),prv*(1-w)+cur*w,cur.fillna(prv))
        agg[f"league_{f}"]=agg.groupby(["season","week","pos"])[f"def_allowed_{f}"].transform("mean")
    keep=["season","week","defense","pos"]+[f"def_allowed_{f}" for f in FIELDS]+[f"league_{f}" for f in FIELDS]
    return x.merge(agg[keep],left_on=["season","week","opponent_team","pos"],right_on=["season","week","defense","pos"],how="left")

def blend_row(r,field):
    vals=[
        (getattr(r,f"recent_{field}"),RECENT_WEIGHT),
        (getattr(r,f"current_{field}"),CURRENT_WEIGHT),
        (getattr(r,f"prior_{field}"),PRIOR_WEIGHT),
    ]
    vals=[(float(v),w) for v,w in vals if pd.notna(v)]
    if not vals:return np.nan
    den=sum(w for _,w in vals)
    return sum(v*w for v,w in vals)/den

def build_projection_table(stats):
    x=add_defense_features(add_pregame_player_features(stats))
    rows=[]
    for r in x[x.target_role.ne("")].itertuples(index=False):
        for f in FIELDS:
            # Position-market compatibility.
            if f.startswith("passing") or f in ("attempts","completions"):
                if r.pos!="QB":continue
            elif f in ("carries","rushing_yards"):
                if r.pos!="RB":continue
            elif f in ("receiving_yards","receptions"):
                if r.pos not in ("WR","TE"):continue
            base=blend_row(r,f)
            if pd.isna(base):continue
            allowed=getattr(r,f"def_allowed_{f}")
            league=getattr(r,f"league_{f}")
            factor=1.0
            if pd.notna(allowed) and pd.notna(league) and league>0:
                factor=max(.86,min(1.14,1+(allowed/league-1)*DEF_STRENGTH))
            projection=max(0.0,base*factor)
            sigma=getattr(r,f"sigma_{f}")
            rows.append({
                "season":int(r.season),"week":float(r.week),"team":r.team,"opponent":r.opponent_team,
                "player_key":r.player_key,"player_nflverse":r.player,"position":r.pos,"target_role":r.target_role,
                "field":f,"market":FIELD_TO_MARKET[f],"projection":projection,"base_projection":base,
                "def_factor":factor,"sigma":float(sigma) if pd.notna(sigma) else np.nan,
                "actual":float(getattr(r,f)),
            })
    return pd.DataFrame(rows)

def join_and_grade(lines,projections):
    m=lines.dropna(subset=["season","week"]).copy()
    m["season"]=m.season.astype(int);m["week"]=m.week.astype(float)
    keys=["season","week","team","player_key","field"]
    j=m.merge(projections,on=keys,how="inner",suffixes=("_pp","_model"))
    if j.empty:return j
    j["edge"]=j.projection-j.line
    j["model_side"]=np.where(j.edge>0,"MORE",np.where(j.edge<0,"LESS","PASS"))
    j["result_side"]=np.where(j.actual>j.line,"MORE",np.where(j.actual<j.line,"LESS","PUSH"))
    j["hit"]=np.where(j.result_side.eq("PUSH"),np.nan,(j.model_side==j.result_side).astype(float))
    j["abs_edge"]=j.edge.abs()
    j["z_edge"]=np.where(pd.to_numeric(j.sigma,errors="coerce")>0,j.edge/j.sigma,np.nan)
    j["abs_z"]=j.z_edge.abs()
    return j

def summarize(j):
    graded=j[j.hit.notna() & j.model_side.ne("PASS")].copy()
    def pack(g):
        return {
            "n":int(len(g)),
            "hits":int(g.hit.sum()) if len(g) else 0,
            "hitRate":float(g.hit.mean()) if len(g) else None,
            "meanAbsEdge":float(g.abs_edge.mean()) if len(g) else None,
            "meanAbsZ":float(g.abs_z.mean()) if len(g) and g.abs_z.notna().any() else None,
        }
    markets={m:pack(g) for m,g in graded.groupby("market")}
    sides={s:pack(g) for s,g in graded.groupby("model_side")}
    roles={s:pack(g) for s,g in graded.groupby("target_role")}
    zcuts={}
    for z in [.25,.5,.75,1.0,1.25,1.5,2.0]:
        zcuts[str(z)]=pack(graded[graded.abs_z>=z])
    # Absolute edge bins are market-specific in scale; expose within market.
    market_z={}
    for m,g in graded.groupby("market"):
        market_z[m]={}
        for z in [.5,.75,1.0,1.25,1.5]:
            market_z[m][str(z)]=pack(g[g.abs_z>=z])
    return {
        "overall":pack(graded),
        "markets":markets,
        "sides":sides,
        "roles":roles,
        "zThresholds":zcuts,
        "marketZThresholds":market_z,
    }

def main():
    if not MIRROR_DIR.exists():
        raise RuntimeError(f"Mirror repo missing: {MIRROR_DIR}")
    lines,commits,failures=extract_snapshots()
    games=load_games()
    lines=attach_game_keys(lines,games)
    stats,status=load_stats()
    projections=build_projection_table(stats)
    joined=join_and_grade(lines,projections)
    report={
        "model":"NFL-PLAYER-PROJ-v3",
        "lineSource":"enkday/prizepicks-data-mirror git history",
        "sourceCost":"free",
        "sourceCommitCount":len(commits),
        "sourceFirstCommit":commits[-1][1] if commits else None,
        "sourceLastCommit":commits[0][1] if commits else None,
        "sourceFailures":len(failures),
        "historicalUniqueLines":int(len(lines)),
        "scheduleMatchedLines":int(lines.season.notna().sum()),
        "scheduleMatchRate":float(lines.season.notna().mean()) if len(lines) else 0,
        "nflverseStatus":status,
        "projectionRows":int(len(projections)),
        "joinedModelLineRows":int(len(joined)),
        "gradedRows":int(joined.hit.notna().sum()) if len(joined) else 0,
        "configuration":{"recentWeight":RECENT_WEIGHT,"currentWeight":CURRENT_WEIGHT,"priorWeight":PRIOR_WEIGHT,"recentGameWeights":RECENT_GAME_WEIGHTS.tolist(),"defenseStrength":DEF_STRENGTH},
        "summary":summarize(joined) if len(joined) else {},
        "temporalIntegrity":"Each PrizePicks observation must precede game start. Player baselines, target-role ranks and opponent-defense features use only prior games.",
        "lineSelection":"Latest observed standard PrizePicks pregame line before start time for each player/game/stat.",
        "roiCaveat":"Hit rate is measurable. Slip ROI is not claimed because historical card construction, payout mode, promotions and correlation rules are not fully reconstructed.",
    }
    lines.to_csv(OUT/"historical-prizepicks-lines.csv",index=False)
    projections.to_csv(OUT/"historical-v3-projections.csv",index=False)
    joined.to_csv(OUT/"graded-v3-vs-prizepicks.csv",index=False)
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
