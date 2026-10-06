#!/usr/bin/env python3
"""CFB-FBIS-v4 research challenger.

Football-specific, market-independent walk-forward ensemble:
- broad shifted PBP-derived advanced team state
- explicit offense/defense matchup interactions
- QB, explosiveness, drive/finishing, situational, special-teams and roster/program context
- Ridge + HistGradientBoosting ensemble selected/tuned inside each training fold
- market used only after frozen predictions for ATS/O-U evaluation
"""
from __future__ import annotations
import json,re,math
from pathlib import Path
import numpy as np,pandas as pd
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error,accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
V3=Path("artifacts/cfb-final/model/cfb_v3_oos_predictions.csv")
OUT=Path("artifacts/cfb-final/model-v4");OUT.mkdir(parents=True,exist_ok=True)
RIDGE_ALPHAS=[10,30,100,300]
GB_L2=[1.0,3.0,10.0]
MAX_BASE=90
MIN_COV=.28
BAD=re.compile(r"(market|benchmark|cfbd|spread|odds|moneyline|winner|score|margin|final_total|home_favorite|ats)",re.I)
FAMILIES={
 "qb":re.compile(r"(qb_|qbr|passer|passing|completion|interception|sack)",re.I),
 "explosive":re.compile(r"(explos|big_play|long_)",re.I),
 "drive":re.compile(r"(drive|red.?zone|scoring|points_per|field.?position)",re.I),
 "situational":re.compile(r"(situ_|third|fourth|early|standard|passing_down|success)",re.I),
 "rush_trench":re.compile(r"(rush|line.?yard|stuff|havoc|pressure)",re.I),
 "special":re.compile(r"(st_|special|kick|punt|field.?goal)",re.I),
 "turnover":re.compile(r"(turnover|interception|fumble)",re.I),
 "program":re.compile(r"(ctx_.*(fpi|rating|talent|returning|recruit))",re.I),
}

def num(s):return pd.to_numeric(s,errors="coerce")

def football_candidates(d,kind):
 prefixes=("diff_pregame_","diff_ctx_") if kind=="margin" else ("sum_pregame_","sum_ctx_")
 cols=[c for c in d.columns if c.startswith(prefixes) and not BAD.search(c)]
 extra=["neutral_site","diff_pregame_rest_days" if kind=="margin" else "sum_pregame_rest_days"]
 return sorted(set(cols+[c for c in extra if c in d]))

def select(train,cands,target,maxn=MAX_BASE):
 y=num(train[target]);sc=[]
 for c in cands:
  x=num(train[c]);m=x.notna()&y.notna();cov=float(m.mean())
  if cov<MIN_COV or m.sum()<300:continue
  corr=x[m].corr(y[m])
  if np.isfinite(corr):sc.append((abs(corr),c))
 sc.sort(reverse=True)
 chosen=[]
 # reserve representation across football families before filling by train-only correlation
 for _,rx in FAMILIES.items():
  fam=[(s,c) for s,c in sc if rx.search(c)]
  for s,c in fam[:4]:
   if c not in chosen:chosen.append(c)
 for s,c in sc:
  if len(chosen)>=maxn:break
  if c in chosen:continue
  x=num(train[c]);keep=True
  for q in chosen:
   pair=pd.concat([x,num(train[q])],axis=1).dropna()
   if len(pair)>500 and abs(pair.iloc[:,0].corr(pair.iloc[:,1]))>.975:
    keep=False;break
  if keep:chosen.append(c)
 return chosen[:maxn]

def add_matchups(d):
 d=d.copy()
 # Explicit football interaction pairs, only when both source stems exist.
 pairs=[
  ("pass","def"),("passing","def"),("rush","def"),("rushing","def"),
  ("explos","def"),("sack","def"),("success","def"),("drive","def"),
  ("third","def"),("red","def"),("line","def"),("havoc","off"),
 ]
 homes=[c for c in d if c.startswith("home_pregame_")]
 aways=[c for c in d if c.startswith("away_pregame_")]
 # Pair home and away versions of the same shifted metric to encode style/strength interaction.
 stems={c[len("home_"):]:c for c in homes}
 for stem,hc in list(stems.items()):
  ac="away_"+stem
  if ac not in d:continue
  lc=stem.lower()
  if not any(k in lc for k in ["epa","ppa","success","explos","pass","rush","sack","havoc","drive","third","red","line","qbr","completion","turnover","punt","kick"]):continue
  h=num(d[hc]);a=num(d[ac])
  d["ix_match__"+stem]=h*a
 # Context x current-state interactions; bounded to interpretable high-value families.
 diff_cur=[c for c in d if c.startswith("diff_pregame_") and any(k in c.lower() for k in ["epa","ppa","success","explos","pass","rush","sack","drive","qbr"])]
 diff_ctx=[c for c in d if c.startswith("diff_ctx_") and any(k in c.lower() for k in ["fpi","rating","talent","returning"])]
 for a in diff_cur[:24]:
  for b in diff_ctx[:8]:d["ix_margin__"+a+"__X__"+b]=num(d[a])*num(d[b])
 sum_cur=[c for c in d if c.startswith("sum_pregame_") and any(k in c.lower() for k in ["epa","ppa","success","explos","pass","rush","drive"])]
 sum_ctx=[c for c in d if c.startswith("sum_ctx_") and any(k in c.lower() for k in ["fpi","rating","talent","returning"])]
 for a in sum_cur[:20]:
  for b in sum_ctx[:6]:d["ix_total__"+a+"__X__"+b]=num(d[a])*num(d[b])
 return d

def ridge(train,features,target,alpha):
 return make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=alpha)).fit(train[features],num(train[target]))

def gb(train,features,target,l2):
 return make_pipeline(SimpleImputer(strategy="median"),HistGradientBoostingRegressor(max_iter=180,learning_rate=.045,max_leaf_nodes=15,min_samples_leaf=35,l2_regularization=l2,random_state=41)).fit(train[features],num(train[target]))

def tune(train,features,target):
 seasons=sorted(train.season.unique())
 vs=seasons[-1];fit=train[train.season<vs];val=train[train.season==vs]
 best=None
 for a in RIDGE_ALPHAS:
  m=ridge(fit,features,target,a);p=m.predict(val[features]);mae=mean_absolute_error(num(val[target]),p)
  if best is None or mae<best[0]:best=(mae,"ridge",a,p)
 for l2 in GB_L2:
  m=gb(fit,features,target,l2);p=m.predict(val[features]);mae=mean_absolute_error(num(val[target]),p)
  if best is None or mae<best[0]:best=(mae,"gb",l2,p)
 # Also test simple Ridge/GB ensemble using independently best members.
 br=min((mean_absolute_error(num(val[target]),ridge(fit,features,target,a).predict(val[features])),a) for a in RIDGE_ALPHAS)
 bg=min((mean_absolute_error(num(val[target]),gb(fit,features,target,l).predict(val[features])),l) for l in GB_L2)
 rp=ridge(fit,features,target,br[1]).predict(val[features]);gp=gb(fit,features,target,bg[1]).predict(val[features])
 for w in [.25,.5,.75]:
  p=w*rp+(1-w)*gp;mae=mean_absolute_error(num(val[target]),p)
  if mae<best[0]:best=(mae,"ensemble",(br[1],bg[1],w),p)
 return best[1],best[2]

def fit_predict(train,test,features,target,spec):
 kind,param=spec
 if kind=="ridge":return ridge(train,features,target,param).predict(test[features])
 if kind=="gb":return gb(train,features,target,param).predict(test[features])
 a,l,w=param
 return w*ridge(train,features,target,a).predict(test[features])+(1-w)*gb(train,features,target,l).predict(test[features])

def metrics(a,pm,pt):
 return {"n":int(len(a)),"marginMae":float(mean_absolute_error(a.actual_margin,pm)),"totalMae":float(mean_absolute_error(a.actual_total,pt)),"winnerAccuracy":float(accuracy_score(a.actual_margin>0,np.asarray(pm)>0))}

def betting(p,prefix="v4"):
 out={}
 for market,model,actual in [("spread",prefix+"_margin","actual_margin"),("total",prefix+"_total","actual_total")]:
  mk="market_margin" if market=="spread" else "market_total"
  x=p.dropna(subset=[model,mk,actual]).copy();x["edge"]=num(x[model])-num(x[mk]);x=x[x.edge.abs()>1e-12]
  result=num(x[actual])-num(x[mk]);x["grade"]=np.where(np.isclose(result,0),"P",np.where(np.sign(x.edge)==np.sign(result),"W","L"))
  segs={}
  for name,z in [("all",x),("discoveryThrough2024",x[x.season<=2024]),("holdout2025_2026",x[x.season>=2025])]:
   rows=[]
   for t in [0,1,2,3,4,5,6,7,8,10]:
    q=z[z.edge.abs()>=t];w=int((q.grade=="W").sum());l=int((q.grade=="L").sum());push=int((q.grade=="P").sum())
    rows.append({"minEdge":t,"bets":len(q),"wins":w,"losses":l,"pushes":push,"winRate":w/(w+l) if w+l else None})
   segs[name]=rows
  out[market]=segs
 return out

def main():
 d=pd.read_csv(DATA,low_memory=False);d=d[num(d.home_score).notna()&num(d.away_score).notna()].copy()
 d["season"]=num(d.season).astype(int);d["actual_margin"]=num(d.home_margin);d["actual_total"]=num(d.final_total)
 d=add_matchups(d)
 rows=[];folds=[]
 for season in range(2010,2027):
  tr=d[d.season<season];te=d[d.season==season]
  if len(tr)<2500 or len(te)==0:continue
  mc=football_candidates(d,"margin")+[c for c in d if c.startswith(("ix_match__","ix_margin__"))]
  tc=football_candidates(d,"total")+[c for c in d if c.startswith(("ix_match__","ix_total__"))]
  mf=select(tr,mc,"actual_margin");tf=select(tr,tc,"actual_total")
  ms=tune(tr,mf,"actual_margin");ts=tune(tr,tf,"actual_total")
  pm=fit_predict(tr,te,mf,"actual_margin",ms);pt=fit_predict(tr,te,tf,"actual_total",ts)
  rows.append(pd.DataFrame({"season":season,"game_id":te.game_id,"actual_margin":te.actual_margin,"actual_total":te.actual_total,
   "v4_margin":pm,"v4_total":pt,"market_margin":-num(te.benchmark_home_spread),"market_total":num(te.benchmark_total)}))
  folds.append({"season":season,"trainN":len(tr),"testN":len(te),"marginFeatures":mf,"totalFeatures":tf,"marginModel":str(ms),"totalModel":str(ts)})
 p=pd.concat(rows,ignore_index=True)
 old=pd.read_csv(V3).rename(columns={"model_margin":"v3_margin","model_total":"v3_total"})
 p=p.merge(old[["game_id","v3_margin","v3_total"]],on="game_id",how="inner")
 m4=metrics(p,p.v4_margin,p.v4_total);m3=metrics(p,p.v3_margin,p.v3_total)
 mk=p.dropna(subset=["market_margin","market_total"]);market=metrics(mk,mk.market_margin,mk.market_total);m4mk=metrics(mk,mk.v4_margin,mk.v4_total)
 hold=p[p.season>=2025];h4=metrics(hold,hold.v4_margin,hold.v4_total);h3=metrics(hold,hold.v3_margin,hold.v3_total)
 report={"modelId":"CFB-FBIS-v4-research","role":"research","marketInformed":False,"canQualify":False,
  "design":"football-specific broad shifted advanced state + matchup/context interactions + train-fold-selected Ridge/HistGradientBoosting ensemble",
  "sample":{"n":len(p),"startSeason":int(p.season.min()),"endSeason":int(p.season.max())},
  "v4":m4,"v3":m3,"marketPairedV4":m4mk,"market":market,"holdout2025_2026":{"v4":h4,"v3":h3},
  "beatsV3AllThree":bool(m4["marginMae"]<m3["marginMae"] and m4["totalMae"]<m3["totalMae"] and m4["winnerAccuracy"]>m3["winnerAccuracy"]),
  "betting":betting(p),"folds":folds,
  "governance":"Research only. Market excluded from feature construction, selection, tuning and fit. Betting lines exposed only after frozen OOS predictions."}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));p.to_csv(OUT/"oos-predictions.csv",index=False)
 print(json.dumps({k:v for k,v in report.items() if k not in ["folds","betting"]},indent=2))
 print(json.dumps({"holdoutBetting":{m:report["betting"][m]["holdout2025_2026"] for m in ["spread","total"]}},indent=2))
if __name__=="__main__":main()
