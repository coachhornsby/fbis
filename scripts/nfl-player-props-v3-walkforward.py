#!/usr/bin/env python3
import io, json, math
from pathlib import Path
from urllib.request import Request, urlopen
import pandas as pd
import numpy as np

START=2023
EVAL_START=2024
END=2026
OUT=Path("artifacts/nfl-player-props-v3")
OUT.mkdir(parents=True,exist_ok=True)
URL="https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv"

RECENT_GAME_WEIGHTS=np.array([0.35,0.25,0.18,0.13,0.09],dtype=float)
RECENT_WEIGHTS=[0.65,0.70,0.75,0.80,0.85,0.90]
PRIOR_WEIGHTS=[0.05,0.10,0.15]
MATCHUP_STRENGTHS=[0.0,0.25,0.45,0.65]
CAPS=(0.86,1.14)

ALIASES={"JAC":"JAX","LA":"LAR","STL":"LAR","SD":"LAC","OAK":"LV","WSH":"WAS"}
FIELDS=["completions","attempts","passing_yards","carries","rushing_yards","targets","receptions","receiving_yards"]
MARKETS={
 "QB":["passing_yards","attempts","completions","rushing_yards","carries"],
 "RB":["rushing_yards","carries","receiving_yards","receptions"],
 "WR":["receiving_yards","receptions"],
 "TE":["receiving_yards","receptions"],
}
ROLE_LIMIT={"QB":1,"RB":1,"WR":2,"TE":1}

def canon(x):
    s=str(x or "").strip().upper()
    return ALIASES.get(s,s)

def fetch(year):
    req=Request(URL.format(year=year),headers={"User-Agent":"FBIS-NFL-props-v3-validation/1.0"})
    with urlopen(req,timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def weighted_recent(hist,field):
    vals=[]
    for _,r in hist.sort_values(["season","week"],ascending=False).head(5).iterrows():
        vals.append(pd.to_numeric(r.get(field),errors="coerce"))
    if not vals:return np.nan
    vals=np.array(vals,dtype=float)
    w=RECENT_GAME_WEIGHTS[:len(vals)]
    ok=np.isfinite(vals)
    return float(np.average(vals[ok],weights=w[ok])) if ok.any() else np.nan

def usage_score(hist,pos):
    if hist.empty:return -1e9
    a=weighted_recent(hist,"attempts"); c=weighted_recent(hist,"carries"); t=weighted_recent(hist,"targets")
    a=0 if not np.isfinite(a) else a; c=0 if not np.isfinite(c) else c; t=0 if not np.isfinite(t) else t
    if pos=="QB":return a + c*0.2
    if pos=="RB":return c + t*0.8
    return t*2.0 + weighted_recent(hist,"receptions") if np.isfinite(weighted_recent(hist,"receptions")) else t*2.0

def blend(parts):
    good=[(v,w) for v,w in parts if np.isfinite(v) and w>0]
    if not good:return np.nan
    sw=sum(w for _,w in good)
    return sum(v*w for v,w in good)/sw

def build_game_position_allowed(df):
    # Actual production allowed in each team/week to each offensive position.
    rows=[]
    for (season,week,opp,pos),g in df.groupby(["season","week","opponent_team","position"],dropna=True):
        if pos not in ROLE_LIMIT:continue
        d={"season":int(season),"week":int(week),"defense":canon(opp),"position":pos}
        for f in FIELDS:d[f]=pd.to_numeric(g[f],errors="coerce").fillna(0).sum()
        rows.append(d)
    return pd.DataFrame(rows)

def defense_ratio(def_hist, defense, pos, field, season, week):
    dh=def_hist[(def_hist.defense==defense)&(def_hist.position==pos)&(((def_hist.season==season)&(def_hist.week<week))|(def_hist.season<season))]
    lh=def_hist[(def_hist.position==pos)&(((def_hist.season==season)&(def_hist.week<week))|(def_hist.season<season))]
    dcur=dh[dh.season==season][field].mean()
    dprev=dh[dh.season==season-1][field].mean()
    lcur=lh[lh.season==season][field].mean()
    lprev=lh[lh.season==season-1][field].mean()
    dg=len(dh[dh.season==season].week.unique())
    lg=len(lh[lh.season==season].week.unique())
    dw=dg/(dg+6) if dg>=0 else 0
    lw=lg/(lg+6) if lg>=0 else 0
    da=blend([(dcur,dw),(dprev,1-dw)])
    la=blend([(lcur,lw),(lprev,1-lw)])
    if not np.isfinite(da) or not np.isfinite(la) or la<=0:return 1.0
    return float(da/la)

def factor_from_ratio(ratio,strength):
    return float(np.clip(1+(ratio-1)*strength,*CAPS))

def main():
    frames=[]
    for y in range(START,END+1):
        try:
            d=fetch(y); d["source_season"]=y; frames.append(d)
            print(f"{y}: {len(d)} rows",flush=True)
        except Exception as e:
            print(f"{y}: failed {e}",flush=True)
    if not frames:raise RuntimeError("no player weekly data")
    df=pd.concat(frames,ignore_index=True)
    for c in ["season","week"]+FIELDS:
        if c not in df.columns:df[c]=np.nan
        df[c]=pd.to_numeric(df[c],errors="coerce")
    if "season_type" in df.columns:df=df[df.season_type.astype(str).str.upper().eq("REG")]
    df["team"]=df["team"].map(canon)
    df["opponent_team"]=df["opponent_team"].map(canon)
    df["position"]=df["position"].astype(str).str.upper()
    df=df[df.position.isin(ROLE_LIMIT)]
    idcol="player_id" if "player_id" in df.columns else "player_display_name"
    namecol="player_display_name" if "player_display_name" in df.columns else idcol
    df["_pid"]=df[idcol].astype(str)
    df["_name"]=df[namecol].astype(str)

    allowed=build_game_position_allowed(df)
    configs=[]
    for rw in RECENT_WEIGHTS:
        for pw in PRIOR_WEIGHTS:
            sw=round(1-rw-pw,2)
            if sw<0:continue
            for ms in MATCHUP_STRENGTHS:
                configs.append((rw,sw,pw,ms))

    records=[]
    # pre-compute target roles for every team/week from strictly prior observations.
    weeks=df[df.season>=EVAL_START][["season","week","team"]].drop_duplicates().sort_values(["season","week","team"])
    roles={}
    for season,week,team in weeks.itertuples(index=False):
        prior=df[(df.team==team)&(((df.season==season)&(df.week<week))|(df.season<season))]
        picks=[]
        for pos,n in ROLE_LIMIT.items():
            cand=[]
            for pid,g in prior[prior.position==pos].groupby("_pid"):
                cand.append((usage_score(g,pos),pid))
            cand.sort(reverse=True)
            picks.extend([(pid,pos,i+1) for i,(_,pid) in enumerate(cand[:n])])
        roles[(int(season),int(week),team)]={pid:(pos,rank) for pid,pos,rank in picks}

    eval_rows=df[df.season>=EVAL_START].sort_values(["season","week","team","_pid"])
    ratio_cache={}
    for _,r in eval_rows.iterrows():
        season,week,team=int(r.season),int(r.week),r.team
        target=roles.get((season,week,team),{})
        if r._pid not in target:continue
        pos,rank=target[r._pid]
        role=("WR"+str(rank)) if pos=="WR" else pos+"1"
        hist=df[(df._pid==r._pid)&(((df.season==season)&(df.week<week))|(df.season<season))].sort_values(["season","week"])
        cur=hist[hist.season==season]
        prev=hist[hist.season==season-1]
        if len(hist)<2:continue
        for field in MARKETS[pos]:
            actual=pd.to_numeric(r[field],errors="coerce")
            if not np.isfinite(actual):continue
            recent=weighted_recent(hist,field)
            season_avg=pd.to_numeric(cur[field],errors="coerce").mean()
            prior_avg=pd.to_numeric(prev[field],errors="coerce").mean()
            rk=(season,week,canon(r.opponent_team),pos,field)
            if rk not in ratio_cache:
                ratio_cache[rk]=defense_ratio(allowed,canon(r.opponent_team),pos,field,season,week)
            ratio=ratio_cache[rk]
            for rw,sw,pw,ms in configs:
                base=blend([(recent,rw),(season_avg,sw),(prior_avg,pw)])
                if not np.isfinite(base):continue
                mf=factor_from_ratio(ratio,ms)
                pred=base*mf
                records.append({
                    "season":season,"week":week,"team":team,"opponent":canon(r.opponent_team),
                    "player_id":r._pid,"player":r._name,"position":pos,"role":role,"market":field,
                    "actual":float(actual),"projection":float(pred),"error":float(pred-actual),"abs_error":float(abs(pred-actual)),
                    "recent_weight":rw,"season_weight":sw,"prior_weight":pw,"matchup_strength":ms,
                    "recent_games":min(5,len(hist)),"current_season_games":len(cur)
                })
    out=pd.DataFrame(records)
    if out.empty:raise RuntimeError("no validation rows produced")
    grp=out.groupby(["recent_weight","season_weight","prior_weight","matchup_strength"])
    summary=grp.agg(n=("actual","size"),mae=("abs_error","mean"),rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),bias=("error","mean")).reset_index()
    # normalized MAE: calculate within-market error / mean actual, then average markets equally.
    m=out.groupby(["recent_weight","season_weight","prior_weight","matchup_strength","market"]).agg(n=("actual","size"),mae=("abs_error","mean"),mean_actual=("actual","mean")).reset_index()
    m["nmae"]=m["mae"]/m["mean_actual"].replace(0,np.nan)
    eq=m.groupby(["recent_weight","season_weight","prior_weight","matchup_strength"]).agg(equal_market_nmae=("nmae","mean"),markets=("market","nunique")).reset_index()
    summary=summary.merge(eq,on=["recent_weight","season_weight","prior_weight","matchup_strength"])
    summary=summary.sort_values(["equal_market_nmae","mae"]).reset_index(drop=True)
    best=summary.iloc[0].to_dict()

    # best config by market and by position+market
    by_market=(out.groupby(["market","recent_weight","season_weight","prior_weight","matchup_strength"])
        .agg(n=("actual","size"),mae=("abs_error","mean"),rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),bias=("error","mean")).reset_index())
    best_market=by_market.sort_values(["market","mae"]).groupby("market").head(1)
    by_pm=(out.groupby(["position","market","recent_weight","season_weight","prior_weight","matchup_strength"])
        .agg(n=("actual","size"),mae=("abs_error","mean"),rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),bias=("error","mean")).reset_index())
    best_pm=by_pm.sort_values(["position","market","mae"]).groupby(["position","market"]).head(1)

    # hold out 2025+ ranking for robustness
    recent_oos=out[out.season>=2025]
    robust=(recent_oos.groupby(["recent_weight","season_weight","prior_weight","matchup_strength"])
      .agg(n=("actual","size"),mae=("abs_error","mean")).reset_index().sort_values("mae"))

    summary.to_csv(OUT/"config-summary.csv",index=False)
    best_market.to_csv(OUT/"best-by-market.csv",index=False)
    best_pm.to_csv(OUT/"best-by-position-market.csv",index=False)
    robust.to_csv(OUT/"recent-2025plus-summary.csv",index=False)
    out.to_csv(OUT/"oos-predictions.csv",index=False)

    report={
      "modelId":"NFL-PLAYER-PROJ-v3-validation",
      "design":"strictly pregame target-role walk-forward; QB1/RB1/WR1/WR2/TE1 only",
      "seasons":[int(out.season.min()),int(out.season.max())],
      "observations":int(len(out)),
      "players":int(out.player_id.nunique()),
      "configsTested":int(len(summary)),
      "recentWeightFloor":0.65,
      "recentWeights":RECENT_WEIGHTS,
      "priorWeights":PRIOR_WEIGHTS,
      "matchupStrengths":MATCHUP_STRENGTHS,
      "bestGlobal":best,
      "bestByMarket":best_market.to_dict(orient="records"),
      "bestByPositionMarket":best_pm.to_dict(orient="records"),
      "recent2025PlusTop10":robust.head(10).to_dict(orient="records"),
      "temporalIntegrity":"Every player baseline, role selection, and opponent allowance uses only games prior to the game being projected.",
      "marketLines":"No historical PrizePicks line is used here; this validates player-number accuracy, not wagering ROI.",
    }
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=="__main__":main()
