#!/usr/bin/env python3
"""
NFL-PROPS-v3 leakage-safe player weight validation.

Purpose
- Compare recent-five weights with 65% as the minimum.
- Compare opponent position-defense adjustment strengths.
- Evaluate next-game player-stat projections for the target role universe:
  QB1, RB1, WR1, WR2, TE1.
- No sportsbook/PrizePicks line is used as a projection input or validation label.

Important
- Role selection uses only prior-game usage.
- Player baselines use only games before the game being predicted.
- Opponent position-defense allowance uses only games before the game being predicted.
- Validation is conditional on the target-role player recording a game row; availability
  remains a separate production gate.
"""

from __future__ import annotations
import io, json, math
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import pandas as pd

SEASONS = list(range(2022, 2027))
WEIGHTS = [0.65,0.70,0.75,0.80,0.85,0.90]
DEF_STRENGTHS = [0.00,0.25,0.45,0.60,0.75]
RECENT_GAME_WEIGHTS = np.array([0.35,0.25,0.18,0.13,0.09], dtype=float)
OUT = Path("artifacts/nfl-props-v3-validation")
OUT.mkdir(parents=True, exist_ok=True)
URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"

ALIASES={"JAC":"JAX","LA":"LAR","STL":"LAR","SD":"LAC","OAK":"LV","WSH":"WAS"}
FIELDS=[
    "completions","attempts","passing_yards",
    "carries","rushing_yards",
    "targets","receptions","receiving_yards",
]
MARKETS={
    "passing_yards":("QB","passing_yards"),
    "passing_attempts":("QB","attempts"),
    "completions":("QB","completions"),
    "rushing_yards":("RB","rushing_yards"),
    "rushing_attempts":("RB","carries"),
    "receiving_yards":("REC","receiving_yards"),
    "receptions":("REC","receptions"),
}

def canon(x):
    s=str(x or "").strip().upper()
    return ALIASES.get(s,s)

def num(x):
    try:
        v=float(x)
        return v if math.isfinite(v) else np.nan
    except Exception:
        return np.nan

def read_csv(url):
    req=Request(url,headers={"User-Agent":"FBIS-nfl-props-validation/1.0"})
    with urlopen(req,timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def load():
    frames=[]
    status=[]
    for season in SEASONS:
        url=URL.format(season=season)
        try:
            d=read_csv(url)
            d["season"]=pd.to_numeric(d.get("season",season),errors="coerce").fillna(season).astype(int)
            d["week"]=pd.to_numeric(d["week"],errors="coerce")
            d=d[d.get("season_type","REG").astype(str).str.upper().eq("REG")].copy()
            d["team"]=d["team"].map(canon)
            d["opponent_team"]=d["opponent_team"].map(canon)
            idcol="player_id" if "player_id" in d.columns else ("player_id_name" if "player_id_name" in d.columns else "player_name")
            namecol="player_display_name" if "player_display_name" in d.columns else ("player_name" if "player_name" in d.columns else idcol)
            poscol="position" if "position" in d.columns else "position_group"
            d["pid"]=d[idcol].astype(str)
            d["pname"]=d[namecol].astype(str)
            d["pos"]=d[poscol].astype(str).str.upper()
            for f in FIELDS:
                d[f]=pd.to_numeric(d[f],errors="coerce").fillna(0.0) if f in d.columns else 0.0
            d=d[d["pos"].isin(["QB","RB","WR","TE"]) & d["week"].notna()].copy()
            frames.append(d[["season","week","team","opponent_team","pid","pname","pos"]+FIELDS])
            status.append({"season":season,"rows":int(len(d)),"status":"ok"})
        except Exception as e:
            status.append({"season":season,"rows":0,"status":"failed","error":str(e)})
    if not frames:
        raise RuntimeError("No player-week data loaded")
    d=pd.concat(frames,ignore_index=True)
    d=d.sort_values(["season","week","team","pid"]).reset_index(drop=True)
    return d,status

def weighted_recent(hist, field):
    vals=pd.to_numeric(hist[field],errors="coerce").dropna().tail(5).to_numpy()[::-1]
    if len(vals)==0:return np.nan
    w=RECENT_GAME_WEIGHTS[:len(vals)]
    return float(np.dot(vals,w)/w.sum())

def simple_mean(hist, field):
    v=pd.to_numeric(hist[field],errors="coerce")
    return float(v.mean()) if v.notna().any() else np.nan

def role_score(hist,pos):
    if hist.empty:return -1e9
    recent=hist.tail(5)
    if pos=="QB":
        return float(recent["attempts"].mean())*2 + float(recent["carries"].mean())*.2
    if pos=="RB":
        return float(recent["carries"].mean()) + float(recent["targets"].mean())*.8
    return float(recent["targets"].mean())*2 + float(recent["receptions"].mean())

def target_roles(history, team, season, week):
    eligible=history[(history.team==team)&((history.season<season)|((history.season==season)&(history.week<week)))]
    if eligible.empty:return {}
    scores=[]
    for pid,g in eligible.groupby("pid"):
        pos=str(g.iloc[-1].pos)
        scores.append((pid,pos,role_score(g,pos)))
    role={}
    for pos,label,count in [("QB","QB",1),("RB","RB",1),("WR","WR",2),("TE","TE",1)]:
        arr=sorted([x for x in scores if x[1]==pos],key=lambda x:x[2],reverse=True)[:count]
        for i,(pid,_,_) in enumerate(arr,1):
            role[pid]=f"{label}{i}"
    return role

def defense_prior(d, defense, pos, field, season, week):
    prior=d[(d.opponent_team==defense)&((d.season<season)|((d.season==season)&(d.week<week)))&(d.pos==pos)]
    if prior.empty:return np.nan,np.nan
    # Sum production allowed to the full position group within each prior game.
    gp=prior.groupby(["season","week","team"],as_index=False)[field].sum()
    allowed=float(gp[field].mean()) if len(gp) else np.nan

    league=d[((d.season<season)|((d.season==season)&(d.week<week)))&(d.pos==pos)]
    if league.empty:return allowed,np.nan
    lg=league.groupby(["season","week","opponent_team"],as_index=False)[field].sum()
    lgavg=float(lg[field].mean()) if len(lg) else np.nan
    return allowed,lgavg

def components(d,pid,season,week,field):
    hist=d[(d.pid==pid)&((d.season<season)|((d.season==season)&(d.week<week)))].sort_values(["season","week"])
    if hist.empty:return np.nan,np.nan,np.nan,0
    recent=weighted_recent(hist,field)
    cur=simple_mean(hist[hist.season==season],field)
    prior=simple_mean(hist[hist.season==season-1],field)
    return recent,cur,prior,min(5,len(hist))

def blend(recent,cur,prior,w_recent):
    # Preserve the v3 25:10 current/prior ratio inside the remaining mass.
    rem=1-w_recent
    w_cur=rem*(25/35)
    w_prior=rem*(10/35)
    parts=[(recent,w_recent),(cur,w_cur),(prior,w_prior)]
    present=[(v,w) for v,w in parts if pd.notna(v)]
    if not present:return np.nan
    den=sum(w for _,w in present)
    return sum(float(v)*w for v,w in present)/den

def build_examples(d):
    rows=[]
    game_keys=d[["season","week","team","opponent_team"]].drop_duplicates().sort_values(["season","week","team"])
    for g in game_keys.itertuples(index=False):
        roles=target_roles(d,g.team,int(g.season),float(g.week))
        if not roles:continue
        actual=d[(d.season==g.season)&(d.week==g.week)&(d.team==g.team)]
        amap={r.pid:r for r in actual.itertuples(index=False)}
        for pid,role in roles.items():
            if pid not in amap:continue  # availability is a separate production gate
            a=amap[pid]
            pos=str(a.pos)
            for market,(mpos,field) in MARKETS.items():
                if mpos=="QB" and pos!="QB":continue
                if mpos=="RB" and pos!="RB":continue
                if mpos=="REC" and pos not in ("WR","TE"):continue
                recent,cur,prior,n_recent=components(d,pid,int(g.season),float(g.week),field)
                if pd.isna(recent):continue
                allowed,league=defense_prior(d,g.opponent_team,pos,field,int(g.season),float(g.week))
                rows.append({
                    "season":int(g.season),"week":int(g.week),"team":g.team,"opponent":g.opponent_team,
                    "pid":pid,"player":a.pname,"position":pos,"role":role,"market":market,"field":field,
                    "actual":float(getattr(a,field)),"recent":recent,"current":cur,"prior":prior,
                    "recent_games":n_recent,"opp_allowed":allowed,"league_allowed":league,
                })
    return pd.DataFrame(rows)

def score(ex):
    results=[]
    predictions=[]
    for wr in WEIGHTS:
        for ds in DEF_STRENGTHS:
            tmp=[]
            for r in ex.itertuples(index=False):
                base=blend(r.recent,r.current,r.prior,wr)
                if pd.isna(base):continue
                factor=1.0
                if pd.notna(r.opp_allowed) and pd.notna(r.league_allowed) and r.league_allowed>0:
                    ratio=r.opp_allowed/r.league_allowed
                    factor=max(.82,min(1.18,1+(ratio-1)*ds))
                pred=max(0.0,base*factor)
                tmp.append((r,pred,factor))
                predictions.append({
                    "recent_weight":wr,"def_strength":ds,"season":r.season,"week":r.week,"team":r.team,
                    "opponent":r.opponent,"player":r.player,"position":r.position,"role":r.role,
                    "market":r.market,"actual":r.actual,"prediction":pred,"def_factor":factor,
                })
            td=pd.DataFrame([{
                "market":r.market,"position":r.position,"actual":r.actual,"prediction":p
            } for r,p,_ in tmp])
            market_rows=[]
            for m,g in td.groupby("market"):
                err=g.prediction-g.actual
                mae=float(err.abs().mean())
                rmse=float(np.sqrt(np.mean(err**2)))
                mean_actual=float(g.actual.mean())
                nmae=mae/max(mean_actual,1.0)
                bias=float(err.mean())
                market_rows.append((m,len(g),mae,rmse,nmae,bias))
            if not market_rows:continue
            # Equal market weighting prevents high-volume QB markets from dominating.
            objective=float(np.mean([x[4] for x in market_rows]))
            results.append({
                "recent_weight":wr,"current_weight":(1-wr)*25/35,"prior_weight":(1-wr)*10/35,
                "def_strength":ds,"n":int(len(td)),"objective_mean_relative_mae":objective,
                "markets":{
                    m:{"n":int(n),"mae":mae,"rmse":rmse,"relativeMae":nmae,"bias":bias}
                    for m,n,mae,rmse,nmae,bias in market_rows
                }
            })
    results.sort(key=lambda x:x["objective_mean_relative_mae"])
    return results,pd.DataFrame(predictions)

def main():
    d,status=load()
    ex=build_examples(d)
    if len(ex)<500:raise RuntimeError(f"insufficient examples: {len(ex)}")
    results,preds=score(ex)
    best=results[0]
    # Stability: report rank by season using the same grid.
    seasonal={}
    for season,g in ex.groupby("season"):
        if len(g)<50:continue
        rr,_=score(g)
        seasonal[str(season)]=rr[:5]
    report={
        "model":"NFL-PLAYER-PROJ-v3-weight-validation",
        "createdUtc":pd.Timestamp.utcnow().isoformat(),
        "seasonsRequested":SEASONS,
        "sourceStatus":status,
        "examples":int(len(ex)),
        "roles":["QB1","RB1","WR1","WR2","TE1"],
        "recentWeightGrid":WEIGHTS,
        "defenseStrengthGrid":DEF_STRENGTHS,
        "recentGameWeights":RECENT_GAME_WEIGHTS.tolist(),
        "objective":"Equal-weight mean across markets of MAE / max(mean actual,1). Lower is better.",
        "best":best,
        "top10":results[:10],
        "seasonalTop5":seasonal,
        "temporalIntegrity":"All player, role and opponent-defense features are restricted to games before the predicted game.",
        "availabilityNote":"Validation is conditional on the selected target-role player recording a game row; production availability gate remains separate.",
        "marketNote":"No PrizePicks/sportsbook line is used. This validates projection architecture, not historical pick-em profitability.",
    }
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    ex.to_csv(OUT/"examples.csv",index=False)
    preds.to_csv(OUT/"predictions-grid.csv",index=False)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
