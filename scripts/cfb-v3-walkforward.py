#!/usr/bin/env python3
import json, re
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
OUT=Path("artifacts/cfb-final/model"); OUT.mkdir(parents=True,exist_ok=True)
ALPHAS=[1,3,10,30,100,300]
MAX_FEATURES=28
MIN_COVERAGE=.35
PRUNE_CORR=.94

def numeric(s):return pd.to_numeric(s,errors="coerce")

def candidate_cols(df,kind):
    if kind=="margin":
        cols=[c for c in df.columns if c.startswith(("diff_pregame_","diff_ctx_"))]
        extra=["neutral_site","diff_pregame_rest_days"]
    else:
        cols=[c for c in df.columns if c.startswith(("sum_pregame_","sum_ctx_"))]
        extra=["neutral_site","sum_pregame_rest_days"]
    bad=re.compile(r"(market|benchmark|cfbd|spread|odds|moneyline|winner|score|margin|final_total|home_favorite)",re.I)
    return sorted(set([c for c in cols+extra if c in df.columns and not bad.search(c)]))

def select_features(train,candidates,target,max_features=MAX_FEATURES):
    y=numeric(train[target])
    scored=[]
    for c in candidates:
        x=numeric(train[c]);mask=x.notna()&y.notna()
        cov=mask.mean()
        if cov<MIN_COVERAGE or mask.sum()<300:continue
        corr=x[mask].corr(y[mask])
        if not np.isfinite(corr):continue
        scored.append((abs(corr),c,float(corr),float(cov)))
    scored.sort(reverse=True)
    chosen=[]
    for _,c,corr,cov in scored:
        if len(chosen)>=max_features:break
        x=numeric(train[c])
        too_close=False
        for q in chosen:
            pair=pd.concat([x,numeric(train[q])],axis=1).dropna()
            if len(pair)>300 and abs(pair.iloc[:,0].corr(pair.iloc[:,1]))>=PRUNE_CORR:
                too_close=True;break
        if not too_close:chosen.append(c)
    return chosen,scored

def fit_model(train,features,target,alpha):
    return make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=alpha)).fit(train[features],numeric(train[target]))

def tune(train,features,target):
    seasons=sorted(train.season.dropna().astype(int).unique())
    if len(seasons)<2:return 30
    val_season=seasons[-1]
    fit=train[train.season<val_season];val=train[train.season==val_season]
    best=None
    for a in ALPHAS:
        model=fit_model(fit,features,target,a)
        pred=model.predict(val[features]);score=mean_absolute_error(numeric(val[target]),pred)
        if best is None or score<best[0]:best=(score,a)
    return best[1]

def metrics(a,pm,pt):
    ok=np.isfinite(pm)&np.isfinite(pt)&np.isfinite(a.home_margin)&np.isfinite(a.final_total)
    aa=a.loc[ok];m=np.asarray(pm)[ok];t=np.asarray(pt)[ok]
    return {"n":int(len(aa)),"marginMae":float(mean_absolute_error(aa.home_margin,m)),
            "totalMae":float(mean_absolute_error(aa.final_total,t)),
            "winnerAccuracy":float(accuracy_score(aa.home_margin>0,m>0))}

def export_model(model,features):
    imp=model.named_steps["simpleimputer"];sc=model.named_steps["standardscaler"];rd=model.named_steps["ridge"]
    return {"features":features,"imputerMedian":[float(x) for x in imp.statistics_],
            "scalerMean":[float(x) for x in sc.mean_],"scalerScale":[float(x) for x in sc.scale_],
            "ridgeCoef":[float(x) for x in rd.coef_],"intercept":float(rd.intercept_),"alpha":float(rd.alpha)}

def main():
    d=pd.read_csv(DATA,low_memory=False)
    d=d[(numeric(d.home_score).notna())&(numeric(d.away_score).notna())].copy()
    d["home_margin"]=numeric(d.home_margin);d["final_total"]=numeric(d.final_total)
    d["season"]=numeric(d.season).astype(int);d["week"]=numeric(d.week)
    margin_candidates=candidate_cols(d,"margin");total_candidates=candidate_cols(d,"total")
    folds=[];rows=[]
    for season in range(2010,2027):
        train=d[d.season<season];test=d[d.season==season]
        if len(train)<2500 or len(test)==0:continue
        mf,mscore=select_features(train,margin_candidates,"home_margin")
        tf,tscore=select_features(train,total_candidates,"final_total")
        if len(mf)<5 or len(tf)<5:continue
        ma=tune(train,mf,"home_margin");ta=tune(train,tf,"final_total")
        mm=fit_model(train,mf,"home_margin",ma);tm=fit_model(train,tf,"final_total",ta)
        pm=mm.predict(test[mf]);pt=tm.predict(test[tf])
        model_metrics=metrics(test,pm,pt)
        spread=numeric(test.benchmark_home_spread);total=numeric(test.benchmark_total)
        market_mask=spread.notna()&total.notna()
        market_metrics=None;paired_model=None
        if market_mask.any():
            mt=test.loc[market_mask]
            market_metrics=metrics(mt,-spread.loc[market_mask].values,total.loc[market_mask].values)
            paired_model=metrics(mt,pm[market_mask.values],pt[market_mask.values])
        folds.append({"season":season,"trainN":len(train),"testN":len(test),
                      "marginFeatures":mf,"totalFeatures":tf,"marginAlpha":ma,"totalAlpha":ta,
                      "model":model_metrics,"pairedModelVsMarket":paired_model,"market":market_metrics})
        rows.append(pd.DataFrame({"season":season,"game_id":test.game_id,"actual_margin":test.home_margin,
             "actual_total":test.final_total,"model_margin":pm,"model_total":pt,
             "market_margin":-spread,"market_total":total},index=test.index))
    oos=pd.concat(rows,ignore_index=True)
    overall=metrics(pd.DataFrame({"home_margin":oos.actual_margin,"final_total":oos.actual_total}),oos.model_margin,oos.model_total)
    paired=oos[oos.market_margin.notna()&oos.market_total.notna()]
    paired_model=metrics(pd.DataFrame({"home_margin":paired.actual_margin,"final_total":paired.actual_total}),paired.model_margin,paired.model_total)
    market=metrics(pd.DataFrame({"home_margin":paired.actual_margin,"final_total":paired.actual_total}),paired.market_margin,paired.market_total)

    # Frozen current research fit uses completed history through 2025 only.
    train=d[d.season<=2025]
    mf,_=select_features(train,margin_candidates,"home_margin");tf,_=select_features(train,total_candidates,"final_total")
    ma=tune(train,mf,"home_margin");ta=tune(train,tf,"final_total")
    mm=fit_model(train,mf,"home_margin",ma);tm=fit_model(train,tf,"final_total",ta)
    frozen={"modelId":"CFB-FBIS-v3-research","role":"research","canQualify":False,"marketInformed":False,
            "trainedThroughSeason":2025,"margin":export_model(mm,mf),"total":export_model(tm,tf)}
    report={"modelId":"CFB-FBIS-v3-research","method":"train-only feature screening + collinearity pruning + nested chronological Ridge tuning",
            "sample":{"startSeason":int(oos.season.min()),"endSeason":int(oos.season.max()),"n":len(oos)},
            "overall":overall,"marketPairedN":len(paired),"pairedModel":paired_model,"market":market,
            "deltasVsMarket":{"marginMae":paired_model["marginMae"]-market["marginMae"],
                              "totalMae":paired_model["totalMae"]-market["totalMae"],
                              "winnerAccuracy":paired_model["winnerAccuracy"]-market["winnerAccuracy"]},
            "folds":folds,"governance":"Research only. Market excluded from feature selection/model fit. No wager authorization."}
    (OUT/"cfb_v3_walkforward_report.json").write_text(json.dumps(report,indent=2))
    (OUT/"cfb_v3_frozen_through_2025.json").write_text(json.dumps(frozen,indent=2))
    oos.to_csv(OUT/"cfb_v3_oos_predictions.csv",index=False)
    print(json.dumps({k:v for k,v in report.items() if k!="folds"},indent=2))
if __name__=="__main__":main()
