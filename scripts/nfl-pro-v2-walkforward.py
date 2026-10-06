#!/usr/bin/env python3
"""NFL-PRO-v2: matchup-specific, market-independent, chronological research model."""
import json
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA=Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
V11=Path("artifacts/nfl-pro-v1-1/oos-predictions.csv")
OUT=Path("artifacts/nfl-pro-v2"); OUT.mkdir(parents=True,exist_ok=True)
ALPHAS=[5,10,20,40,80]
BASES=["off_epa_per_play","off_success_rate","pass_epa_per_play","pass_success_rate","rush_epa_per_play",
"rush_success_rate","explosive_rate","early_down_epa","third_down_success_rate","turnover_rate","sack_rate",
"neutral_pass_rate","qb_epa_per_dropback","cpoe"]
PERIODS=["pregame_season_","pregame_l5_"]

def n(s): return pd.to_numeric(s,errors="coerce")
def add_matchups(d):
    d=d.copy()
    d["rest_diff"]=n(d.home_rest)-n(d.away_rest)
    d["hfa"]=np.where(d.location.astype(str).str.lower().eq("neutral"),0.0,1.0)
    d["adverse_weather"]=((n(d.wind)>=15)|(n(d.temp)<=32)).astype(float)
    d["divisional"]=n(d.get("div_game",0)).fillna(0)
    for p in PERIODS:
      for b in BASES:
        ho=f"home_{p}{b}"; ao=f"away_{p}{b}"; hd=f"home_{p}def_{b}"; ad=f"away_{p}def_{b}"
        if all(c in d for c in [ho,ao,hd,ad]):
          # offense vs opposing defense; lower defensive EPA allowed is better, so subtract defense.
          d[f"home_match_{p}{b}"]=n(d[ho])-n(d[ad])
          d[f"away_match_{p}{b}"]=n(d[ao])-n(d[hd])
          d[f"diff_match_{p}{b}"]=d[f"home_match_{p}{b}"]-d[f"away_match_{p}{b}"]
          d[f"sum_match_{p}{b}"]=d[f"home_match_{p}{b}"]+d[f"away_match_{p}{b}"]
    # QB state uses only shifted rolling QB production already present in the training artifact.
    for p in ["pregame_qb_l5_qb_epa_game","pregame_qb_l5_qb_cpoe_game"]:
      h=f"home_{p}"; a=f"away_{p}"
      if h in d and a in d: d[f"diff_{p}"]=n(d[h])-n(d[a])
    return d

def feature_sets(d):
    margin=[c for c in d if c.startswith("diff_match_")]
    total=[c for c in d if c.startswith("sum_match_")]
    margin += [c for c in ["diff_pregame_qb_l5_qb_epa_game","diff_pregame_qb_l5_qb_cpoe_game","rest_diff","hfa","divisional"] if c in d]
    total += [c for c in ["adverse_weather","divisional"] if c in d]
    # retain compact independent strength anchors; no market columns.
    margin += [c for c in d if c.startswith("diff_pregame_") and any(x in c for x in ["off_epa_per_play","pass_epa_per_play","rush_epa_per_play","off_success_rate","explosive_rate","sack_rate"])]
    total += [c for c in d if c.startswith(("home_pregame_","away_pregame_")) and any(x in c for x in ["off_epa_per_play","pass_epa_per_play","rush_epa_per_play","explosive_rate","neutral_pass_rate"])]
    return list(dict.fromkeys(margin)),list(dict.fromkeys(total))

def model(alpha): return make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=alpha))
def tune(train,features,target):
    seasons=sorted(train.season.unique()); val=seasons[-1]; tr=train[train.season<val]; va=train[train.season==val]
    best=None
    for a in ALPHAS:
      m=model(a);m.fit(tr[features],n(tr[target])); pred=m.predict(va[features]); score=mean_absolute_error(n(va[target]),pred)
      if best is None or score<best[0]:best=(score,a)
    return best[1]
def metrics(a,pm,pt):
    return {"n":int(len(a)),"marginMae":float(mean_absolute_error(a.home_margin,pm)),
      "totalMae":float(mean_absolute_error(a.final_total,pt)),"winnerAccuracy":float(accuracy_score(a.home_margin>0,np.asarray(pm)>0))}
def main():
    d=pd.read_csv(DATA,low_memory=False);d=d[d.game_type.astype(str).eq("REG")].copy()
    d["season"]=n(d.season).astype(int);d["home_margin"]=n(d.home_margin);d["final_total"]=n(d.final_total);d=add_matchups(d)
    mf,tf=feature_sets(d)
    if len(mf)<20 or len(tf)<20: raise RuntimeError(f"insufficient v2 features margin={len(mf)} total={len(tf)}")
    rows=[];folds=[]
    for season in range(2018,2027):
      tr=d[d.season<season];te=d[d.season==season]
      if len(tr)<500 or len(te)==0:continue
      ma=tune(tr,mf,"home_margin");ta=tune(tr,tf,"final_total")
      mm=model(ma);tm=model(ta);mm.fit(tr[mf],tr.home_margin);tm.fit(tr[tf],tr.final_total)
      pm=mm.predict(te[mf]);pt=tm.predict(te[tf])
      folds.append({"season":season,"marginAlpha":ma,"totalAlpha":ta,"v2":metrics(te,pm,pt)})
      rows.append(pd.DataFrame({"season":season,"game_id":te.game_id,"actual_margin":te.home_margin,"actual_total":te.final_total,
        "v2_margin":pm,"v2_total":pt,"market_margin":-n(te.closing_home_spread),"market_total":n(te.closing_total)}))
    o=pd.concat(rows,ignore_index=True); v=pd.read_csv(V11)
    p=o.merge(v[["game_id","v11_margin","v11_total"]],on="game_id",how="inner")
    a=pd.DataFrame({"home_margin":p.actual_margin,"final_total":p.actual_total})
    v2=metrics(a,p.v2_margin,p.v2_total);v11=metrics(a,p.v11_margin,p.v11_total)
    mk=p.dropna(subset=["market_margin","market_total"]);am=pd.DataFrame({"home_margin":mk.actual_margin,"final_total":mk.actual_total})
    market=metrics(am,mk.market_margin,mk.market_total);v2m=metrics(am,mk.v2_margin,mk.v2_total)
    # uncertainty proxy: expanding prior residual SD, strictly prior seasons.
    p["margin_abs_error"]=(p.actual_margin-p.v2_margin).abs();p["total_abs_error"]=(p.actual_total-p.v2_total).abs()
    p["margin_uncertainty"]=np.nan;p["total_uncertainty"]=np.nan
    for s in sorted(p.season.unique()):
      prior=p[p.season<s]
      if len(prior)>=200:
        p.loc[p.season==s,"margin_uncertainty"]=(prior.actual_margin-prior.v2_margin).std()
        p.loc[p.season==s,"total_uncertainty"]=(prior.actual_total-prior.v2_total).std()
    beats={"marginMae":v2["marginMae"]<v11["marginMae"],"totalMae":v2["totalMae"]<v11["totalMae"],"winnerAccuracy":v2["winnerAccuracy"]>v11["winnerAccuracy"]}
    report={"modelId":"NFL-PRO-v2","role":"research","design":"matchup-specific offense-vs-opponent-defense Ridge with shifted QB state and context; market excluded",
      "sample":{"n":len(p),"startSeason":int(p.season.min()),"endSeason":int(p.season.max())},"featureCounts":{"margin":len(mf),"total":len(tf)},
      "v2":v2,"v11":v11,"marketPairedV2":v2m,"market":market,
      "deltasVsV11":{"marginMae":v2["marginMae"]-v11["marginMae"],"totalMae":v2["totalMae"]-v11["totalMae"],"winnerAccuracy":v2["winnerAccuracy"]-v11["winnerAccuracy"]},
      "deltasVsMarket":{"marginMae":v2m["marginMae"]-market["marginMae"],"totalMae":v2m["totalMae"]-market["totalMae"],"winnerAccuracy":v2m["winnerAccuracy"]-market["winnerAccuracy"]},
      "beatsV11AllThree":bool(all(beats.values())),"beatsV11":beats,"canQualify":False,
      "knownGap":"Historical injury/declared-starter and OL-continuity feeds are not present in the canonical dataset; no postgame starter identity was backfilled as a pregame feature.",
      "folds":folds}
    (OUT/"report.json").write_text(json.dumps(report,indent=2));p.to_csv(OUT/"oos-predictions.csv",index=False)
    print(json.dumps({k:v for k,v in report.items() if k!="folds"},indent=2))
if __name__=="__main__":main()
