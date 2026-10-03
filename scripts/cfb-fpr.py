#!/usr/bin/env python3
"""FBIS Power Rating (FPR) — leakage-safe weekly CFB power system.

FPR is independent of betting markets and external poll/rating targets. It uses only
shifted pregame football state already present in the canonical FBIS CFB dataset.
Ratings are expressed in expected neutral-field points versus an average FBS team.

Outputs:
- weekly-fpr.csv: FPR/FPR-O/FPR-D snapshots for every team-game
- game-fpr.csv: home/away FPR and neutral-field FPR margin for each game
- report.json: true walk-forward predictive validation
"""
from __future__ import annotations
import json,re
from pathlib import Path
import numpy as np,pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error,accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
OUT=Path("artifacts/cfb-final/fpr");OUT.mkdir(parents=True,exist_ok=True)
ALPHAS=[10,30,100,300]
BAD=re.compile(r"(market|benchmark|cfbd|spread|odds|moneyline|winner|score|margin|final_total|ats|ctx_fpi|ctx_rating)",re.I)
SIGNAL=re.compile(r"(epa|ppa|success|explos|pass|rush|qbr|completion|sack|havoc|pressure|line.?yard|stuff|drive|red.?zone|third|fourth|turnover|interception|fumble|special|kick|punt|field.?goal|returning|talent|recruit)",re.I)

def n(x):return pd.to_numeric(x,errors="coerce")

def side_features(d,side):
 p=(side+"_pregame_",side+"_ctx_")
 return [c for c in d if c.startswith(p) and SIGNAL.search(c) and not BAD.search(c)]

def select(train,cols,target,maxn=55):
 y=n(train[target]);sc=[]
 for c in cols:
  x=n(train[c]);m=x.notna()&y.notna()
  if m.mean()<.30 or m.sum()<300:continue
  r=x[m].corr(y[m])
  if np.isfinite(r):sc.append((abs(r),c))
 sc.sort(reverse=True);out=[]
 for _,c in sc:
  if len(out)>=maxn:break
  x=n(train[c]);ok=True
  for q in out:
   z=pd.concat([x,n(train[q])],axis=1).dropna()
   if len(z)>500 and abs(z.iloc[:,0].corr(z.iloc[:,1]))>.975:ok=False;break
  if ok:out.append(c)
 return out

def fit(train,cols,target,a):
 return make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=a)).fit(train[cols],n(train[target]))

def tune(train,cols,target):
 seasons=sorted(train.season.unique());v=seasons[-1];tr=train[train.season<v];va=train[train.season==v]
 return min(ALPHAS,key=lambda a:mean_absolute_error(n(va[target]),fit(tr,cols,target,a).predict(va[cols])))

def neutralize(x,season):
 z=pd.Series(x,index=season.index,dtype=float)
 return z-z.groupby(season).transform("mean")


def stabilize_weekly(raw):
 """Convert game-state estimates into stable point-in-time team power ratings.

 Uses only information available before each game. A team's new raw football-state
 estimate is shrunk toward its own prior rating and an opponent-adjusted result
 residual from completed earlier games. No polls, market lines, or external ratings.
 """
 state={}; out=[]
 raw=raw.sort_values(["season","week","game_id"]).copy()
 for season,sg in raw.groupby("season",sort=True):
  # Carry prior-season terminal strength with heavy regression to average.
  prev={k:v for k,v in state.items()}
  state={}
  games={}
  for week,wg in sg.groupby("week",sort=True):
   # Snapshot ratings BEFORE this week's games.
   for _,r in wg.iterrows():
    for side in ("home","away"):
     tid=r[f"{side}_id"]; rawf=float(r[f"{side}_fpr"])
     old=state.get(tid)
     if old is None:
      prior=.45*prev.get(tid,0.0)
      rating=.55*rawf+.45*prior
      gp=0
     else:
      gp=games.get(tid,0)
      # More early-season shrinkage; latest feature state cannot whipsaw rating.
      wraw=min(.28,.14+.025*gp)
      rating=(1-wraw)*old+wraw*rawf
     r[f"{side}_stable_fpr"]=rating
     r[f"{side}_games_prior"]=gp
   out.append(r.copy())
   # Update after completed games using opponent-adjusted neutral result residual.
   for _,r in wg.iterrows():
    h,a=r.home_id,r.away_id
    hr=state.get(h,float(r.home_stable_fpr)); ar=state.get(a,float(r.away_stable_fpr))
    # conservative HFA only for result-residual update, never poll/market derived
    neutral_result=float(r.actual_margin)-2.5
    expected=hr-ar
    resid=np.clip(neutral_result-expected,-28,28)
    k=.10
    state[h]=hr+k*resid/2; state[a]=ar-k*resid/2
    games[h]=games.get(h,0)+1;games[a]=games.get(a,0)+1
  # terminal states become next-season priors
 return pd.DataFrame(out)

def main():
 d=pd.read_csv(DATA,low_memory=False);d=d[n(d.home_score).notna()&n(d.away_score).notna()].copy()
 d["season"]=n(d.season).astype(int);d["home_pts"]=n(d.home_score);d["away_pts"]=n(d.away_score);d["actual_margin"]=d.home_pts-d.away_pts
 # Side-specific scoring targets let offense and defense become distinct latent point ratings.
 rows=[];folds=[]
 for season in range(2010,2027):
  tr=d[d.season<season];te=d[d.season==season]
  if len(tr)<2500 or len(te)==0:continue
  hf=select(tr,side_features(d,"home"),"home_pts");af=select(tr,side_features(d,"away"),"away_pts")
  # Defense models use the same side state to estimate points allowed.
  hd=select(tr,side_features(d,"home"),"away_pts");ad=select(tr,side_features(d,"away"),"home_pts")
  ha=tune(tr,hf,"home_pts");aa=tune(tr,af,"away_pts");hda=tune(tr,hd,"away_pts");ada=tune(tr,ad,"home_pts")
  hop=fit(tr,hf,"home_pts",ha).predict(te[hf]);aop=fit(tr,af,"away_pts",aa).predict(te[af])
  hallow=fit(tr,hd,"away_pts",hda).predict(te[hd]);aallow=fit(tr,ad,"home_pts",ada).predict(te[ad])
  # Convert expected scoring/allowing into neutral-centered point-strength components.
  base=float(pd.concat([tr.home_pts,tr.away_pts]).mean())
  ho=hop-base;ao=aop-base
  hdv=base-hallow;adv=base-aallow
  # Overall rating is equal offense/defense contribution; no home field is embedded.
  hfpr=.5*(ho+hdv);afpr=.5*(ao+adv)
  g=pd.DataFrame({"season":season,"week":te.week,"game_id":te.game_id,
   "home_id":te.home_id,"away_id":te.away_id,"home_team":te.get("home_team"),"away_team":te.get("away_team"),
   "home_fpr_o":ho,"home_fpr_d":hdv,"home_fpr":hfpr,"away_fpr_o":ao,"away_fpr_d":adv,"away_fpr":afpr,
   "fpr_neutral_margin":hfpr-afpr,"actual_margin":te.actual_margin})
  rows.append(g);folds.append({"season":season,"trainN":len(tr),"testN":len(te),"homeOffFeatures":hf,"awayOffFeatures":af,"homeDefFeatures":hd,"awayDefFeatures":ad})
 g=pd.concat(rows,ignore_index=True)
 # Calibrate raw FPR differential to actual neutral-margin scale using prior seasons only.
 calibrated=[]
 for season in sorted(g.season.unique()):
  hist=g[g.season<season];cur=g[g.season==season].copy()
  if len(hist)>=1000:
   X=hist[["fpr_neutral_margin"]];y=hist.actual_margin
   m=Ridge(alpha=30).fit(X,y);cur["fpr_projected_margin"]=m.predict(cur[["fpr_neutral_margin"]])
  else:cur["fpr_projected_margin"]=cur.fpr_neutral_margin
  calibrated.append(cur)
 g=pd.concat(calibrated,ignore_index=True)
 # Apply the point-in-time stabilization layer before publishing or validating FPR-v2.
 # Preserve raw model state for diagnostics; all v2 overall ratings/margins use stable state.
 g=stabilize_weekly(g)
 g["raw_fpr_neutral_margin"]=g["fpr_neutral_margin"]
 g["home_fpr"]=g["home_stable_fpr"]
 g["away_fpr"]=g["away_stable_fpr"]
 g["fpr_neutral_margin"]=g["home_fpr"]-g["away_fpr"]
 # Recalibrate the stabilized differential using prior seasons only.
 stable_cal=[]
 for season in sorted(g.season.unique()):
  hist=g[g.season<season];cur=g[g.season==season].copy()
  if len(hist)>=1000:
   m=Ridge(alpha=30).fit(hist[["fpr_neutral_margin"]],hist.actual_margin)
   cur["fpr_projected_margin"]=m.predict(cur[["fpr_neutral_margin"]])
  else:cur["fpr_projected_margin"]=cur.fpr_neutral_margin
  stable_cal.append(cur)
 g=pd.concat(stable_cal,ignore_index=True)
 overall={"n":len(g),"marginMae":float(mean_absolute_error(g.actual_margin,g.fpr_projected_margin)),
          "winnerAccuracy":float(accuracy_score(g.actual_margin>0,g.fpr_projected_margin>0))}
 hold=g[g.season>=2025]
 holdm={"n":len(hold),"marginMae":float(mean_absolute_error(hold.actual_margin,hold.fpr_projected_margin)),
        "winnerAccuracy":float(accuracy_score(hold.actual_margin>0,hold.fpr_projected_margin>0))}
 # Team-game snapshot table.
 h=g[["season","week","game_id","home_id","home_team","home_fpr_o","home_fpr_d","home_fpr"]].rename(columns={"home_id":"team_id","home_team":"team","home_fpr_o":"fpr_o","home_fpr_d":"fpr_d","home_fpr":"fpr"})
 a=g[["season","week","game_id","away_id","away_team","away_fpr_o","away_fpr_d","away_fpr"]].rename(columns={"away_id":"team_id","away_team":"team","away_fpr_o":"fpr_o","away_fpr_d":"fpr_d","away_fpr":"fpr"})
 weekly=pd.concat([h,a],ignore_index=True).sort_values(["season","week","team"])
 weekly.to_csv(OUT/"weekly-fpr.csv",index=False);g.to_csv(OUT/"game-fpr.csv",index=False)
 report={"system":"FBIS Power Rating","version":"FPR-v2-research","marketInformed":False,"canQualify":False,
  "units":"stable neutral-field points versus average team; raw football-state offense/defense plus prior shrinkage, smoothing and opponent-adjusted result updates",
  "externalRatingTargetsExcluded":["FPI","SP+","SRS","Elo","CORE","polls","betting market"],
  "overall":overall,"holdout2025_2026":holdm,"folds":folds,
  "governance":"Every rating is point-in-time. Base models train only on earlier seasons; stability updates use only prior team state and completed earlier-game opponent-adjusted results. Polls, market and external ratings are excluded."}
 (OUT/"report.json").write_text(json.dumps(report,indent=2))
 print(json.dumps({k:v for k,v in report.items() if k!="folds"},indent=2))
if __name__=="__main__":main()
