#!/usr/bin/env python3
import io, json
from collections import defaultdict
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

START=2024
EVAL_START=2025
END=2026
OUT=Path("artifacts/nfl-player-props-v3")
OUT.mkdir(parents=True,exist_ok=True)
URL="https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv"

RECENT_GAME_WEIGHTS=np.array([0.35,0.25,0.18,0.13,0.09],dtype=float)
RECENT_WEIGHTS=[0.65,0.70,0.75,0.80,0.85,0.90]
PRIOR_WEIGHTS=[0.05,0.10,0.15]
MATCHUP_STRENGTHS=[0.0,0.25,0.45,0.65]
CAP_LO,CAP_HI=0.86,1.14
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
    req=Request(URL.format(year=year),headers={"User-Agent":"FBIS-NFL-props-v3-validation/2.0"})
    with urlopen(req,timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def num(v):
    try:
        x=float(v)
        return x if np.isfinite(x) else np.nan
    except Exception:
        return np.nan

def wmean(values,weights=None):
    vals=np.array([num(v) for v in values],dtype=float)
    ok=np.isfinite(vals)
    if not ok.any(): return np.nan
    if weights is None: return float(vals[ok].mean())
    w=np.array(weights[:len(vals)],dtype=float)
    return float(np.average(vals[ok],weights=w[ok]))

def recent(hist,field):
    rows=hist[-5:][::-1]
    return wmean([r.get(field) for r in rows],RECENT_GAME_WEIGHTS)

def season_avg(hist,season,field):
    return wmean([r.get(field) for r in hist if int(r["season"])==season])

def prior_avg(hist,season,field):
    return wmean([r.get(field) for r in hist if int(r["season"])==season-1])

def blend(parts):
    good=[(num(v),float(w)) for v,w in parts if np.isfinite(num(v)) and float(w)>0]
    if not good:return np.nan
    sw=sum(w for _,w in good)
    return sum(v*w for v,w in good)/sw

def usage(hist,pos):
    if not hist:return -1e9
    a=recent(hist,"attempts"); c=recent(hist,"carries"); t=recent(hist,"targets"); rec=recent(hist,"receptions")
    a=0 if not np.isfinite(a) else a
    c=0 if not np.isfinite(c) else c
    t=0 if not np.isfinite(t) else t
    rec=0 if not np.isfinite(rec) else rec
    if pos=="QB": return a+0.2*c
    if pos=="RB": return c+0.8*t
    return 2*t+rec

def role_map(team_players,player_hist,last_team):
    out={}
    for team,pids in team_players.items():
        for pos,n in ROLE_LIMIT.items():
            cand=[]
            for pid in pids:
                h=player_hist.get(pid,[])
                if not h or last_team.get(pid)!=team: continue
                if str(h[-1].get("position","")).upper()!=pos: continue
                cand.append((usage(h,pos),pid))
            cand.sort(reverse=True)
            for rank,(_,pid) in enumerate(cand[:n],1):
                out[(team,pid)]=(pos,rank)
    return out

def allowed_ratio(def_hist,league_hist,defense,pos,field,season):
    d=def_hist.get((defense,pos,field),[])
    l=league_hist.get((pos,field),[])
    dcur=[v for s,v in d if s==season]; dprev=[v for s,v in d if s==season-1]
    lcur=[v for s,v in l if s==season]; lprev=[v for s,v in l if s==season-1]
    dw=len(dcur)/(len(dcur)+6) if dcur else 0
    lw=len(lcur)/(len(lcur)+6) if lcur else 0
    da=blend([(wmean(dcur),dw),(wmean(dprev),1-dw)])
    la=blend([(wmean(lcur),lw),(wmean(lprev),1-lw)])
    if not np.isfinite(da) or not np.isfinite(la) or la<=0:return 1.0
    return float(da/la)

def factor(ratio,strength):
    return float(np.clip(1+(ratio-1)*strength,CAP_LO,CAP_HI))

def main():
    frames=[]
    for y in range(START,END+1):
        try:
            d=fetch(y)
            frames.append(d)
            print(f"download {y}: {len(d)}",flush=True)
        except Exception as e:
            print(f"download {y} failed: {e}",flush=True)
    if not frames: raise RuntimeError("no weekly player data")
    df=pd.concat(frames,ignore_index=True)
    if "season_type" in df.columns:
        df=df[df.season_type.astype(str).str.upper().eq("REG")].copy()
    for c in ["season","week"]+FIELDS:
        if c not in df.columns:df[c]=np.nan
        df[c]=pd.to_numeric(df[c],errors="coerce")
    df["team"]=df["team"].map(canon)
    df["opponent_team"]=df["opponent_team"].map(canon)
    df["position"]=df["position"].astype(str).str.upper()
    df=df[df.position.isin(ROLE_LIMIT)].copy()
    idcol="player_id" if "player_id" in df.columns else "player_display_name"
    namecol="player_display_name" if "player_display_name" in df.columns else idcol
    df["_pid"]=df[idcol].astype(str)
    df["_name"]=df[namecol].astype(str)
    df=df.sort_values(["season","week","team","_pid"])

    configs=[]
    for rw in RECENT_WEIGHTS:
        for pw in PRIOR_WEIGHTS:
            sw=round(1-rw-pw,2)
            if sw<0: continue
            for ms in MATCHUP_STRENGTHS:
                configs.append((rw,sw,pw,ms))

    player_hist=defaultdict(list)
    team_players=defaultdict(set)
    last_team={}
    def_hist=defaultdict(list)
    league_hist=defaultdict(list)
    records=[]
    role_slots=0
    role_hits=0

    for (season,week),wk in df.groupby(["season","week"],sort=True):
        season=int(season); week=int(week)
        roles=role_map(team_players,player_hist,last_team)
        if season>=EVAL_START:
            role_slots += len(roles)
            actual_by_key={(r.team,r._pid):r for r in wk.itertuples(index=False)}
            for (team,pid),(pos,rank) in roles.items():
                rr=actual_by_key.get((team,pid))
                if rr is None: continue
                role_hits+=1
                h=player_hist.get(pid,[])
                if len(h)<2: continue
                role=("WR"+str(rank)) if pos=="WR" else pos+"1"
                for market in MARKETS[pos]:
                    actual=num(getattr(rr,market,np.nan))
                    if not np.isfinite(actual):continue
                    rv=recent(h,market)
                    sv=season_avg(h,season,market)
                    pv=prior_avg(h,season,market)
                    ratio=allowed_ratio(def_hist,league_hist,canon(rr.opponent_team),pos,market,season)
                    for rw,sw,pw,ms in configs:
                        base=blend([(rv,rw),(sv,sw),(pv,pw)])
                        if not np.isfinite(base):continue
                        pred=base*factor(ratio,ms)
                        records.append({
                          "season":season,"week":week,"team":team,"opponent":canon(rr.opponent_team),
                          "player_id":pid,"player":rr._name,"position":pos,"role":role,"market":market,
                          "actual":actual,"projection":pred,"error":pred-actual,"abs_error":abs(pred-actual),
                          "recent_weight":rw,"season_weight":sw,"prior_weight":pw,"matchup_strength":ms,
                          "recent_games":min(5,len(h)),"current_season_games":sum(1 for x in h if int(x["season"])==season),
                          "opponent_ratio":ratio
                        })

        # Update opponent positional allowances only after scoring the week.
        for (defense,pos),g in wk.groupby(["opponent_team","position"]):
            defense=canon(defense)
            for field in FIELDS:
                val=float(pd.to_numeric(g[field],errors="coerce").fillna(0).sum())
                def_hist[(defense,pos,field)].append((season,val))
                league_hist[(pos,field)].append((season,val))

        # Update player histories only after scoring the week.
        for rr in wk.itertuples(index=False):
            row={"season":season,"week":week,"team":rr.team,"opponent_team":canon(rr.opponent_team),
                 "position":rr.position,"name":rr._name}
            for field in FIELDS:row[field]=num(getattr(rr,field,np.nan))
            player_hist[rr._pid].append(row)
            team_players[rr.team].add(rr._pid)
            last_team[rr._pid]=rr.team

    out=pd.DataFrame(records)
    if out.empty: raise RuntimeError("no validation rows")

    keys=["recent_weight","season_weight","prior_weight","matchup_strength"]
    summary=(out.groupby(keys).agg(
        n=("actual","size"),
        mae=("abs_error","mean"),
        rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),
        bias=("error","mean")
    ).reset_index())
    market=(out.groupby(keys+["market"]).agg(
        n=("actual","size"),mae=("abs_error","mean"),mean_actual=("actual","mean")
    ).reset_index())
    market["nmae"]=market["mae"]/market["mean_actual"].replace(0,np.nan)
    eq=(market.groupby(keys).agg(equal_market_nmae=("nmae","mean"),markets=("market","nunique")).reset_index())
    summary=summary.merge(eq,on=keys).sort_values(["equal_market_nmae","mae"]).reset_index(drop=True)

    by_market=(out.groupby(["market"]+keys).agg(
        n=("actual","size"),mae=("abs_error","mean"),
        rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),
        bias=("error","mean")
    ).reset_index())
    best_market=by_market.sort_values(["market","mae"]).groupby("market").head(1)

    by_pm=(out.groupby(["position","market"]+keys).agg(
        n=("actual","size"),mae=("abs_error","mean"),
        rmse=("error",lambda x:float(np.sqrt(np.mean(np.square(x))))),
        bias=("error","mean")
    ).reset_index())
    best_pm=by_pm.sort_values(["position","market","mae"]).groupby(["position","market"]).head(1)

    # Strongest recent robustness slice: current 2026 data where available.
    r26=out[out.season==2026]
    robust=(r26.groupby(keys).agg(n=("actual","size"),mae=("abs_error","mean")).reset_index().sort_values("mae")) if len(r26) else pd.DataFrame()

    baseline=summary[(summary.recent_weight==0.65)&(summary.season_weight==0.25)&(summary.prior_weight==0.10)&(summary.matchup_strength==0.45)]
    best=summary.iloc[0].to_dict()
    report={
      "modelId":"NFL-PLAYER-PROJ-v3-validation",
      "design":"incremental leakage-safe walk-forward; statistical roles selected before each week",
      "seasons":[int(out.season.min()),int(out.season.max())],
      "observations":int(len(out)),
      "uniquePlayers":int(out.player_id.nunique()),
      "roleSlots":int(role_slots),
      "roleActualHitRate":float(role_hits/role_slots) if role_slots else None,
      "configsTested":int(len(summary)),
      "recentWeightFloor":0.65,
      "recentWeights":RECENT_WEIGHTS,
      "priorWeights":PRIOR_WEIGHTS,
      "matchupStrengths":MATCHUP_STRENGTHS,
      "bestGlobal":best,
      "productionCandidate652510x045":baseline.iloc[0].to_dict() if len(baseline) else None,
      "bestByMarket":best_market.to_dict(orient="records"),
      "bestByPositionMarket":best_pm.to_dict(orient="records"),
      "current2026Top10":robust.head(10).to_dict(orient="records") if len(robust) else [],
      "temporalIntegrity":"Role selection, player form, season averages, prior-season averages, and opponent allowances are all frozen before each projected week and updated only after scoring that week.",
      "marketLines":"No historical PrizePicks line is used. This validates projection-number accuracy, not pick'em ROI."
    }
    summary.to_csv(OUT/"config-summary.csv",index=False)
    best_market.to_csv(OUT/"best-by-market.csv",index=False)
    best_pm.to_csv(OUT/"best-by-position-market.csv",index=False)
    if len(robust):robust.to_csv(OUT/"current-2026-summary.csv",index=False)
    out.to_csv(OUT/"oos-predictions.csv",index=False)
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
