#!/usr/bin/env python3
"""NFL-PRO v1.2 leakage-safe walk-forward.

Compares:
1) calibrated form prior
2) compact NFL-PRO v1.1 EPA/QB core
3) NFL-PRO v1.2 = v1.1 + lagged Next Gen tracking features
4) closing market benchmark (benchmark only; never a model input)
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA=Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
OUT=Path("artifacts/nfl-pro-v1-2"); OUT.mkdir(parents=True,exist_ok=True)
ALPHA=20.0
BLEND_GRID=[round(x,1) for x in np.arange(0,1.01,.1)]

MARGIN_V11=[
"diff_pregame_season_off_epa_per_play","diff_pregame_l5_off_epa_per_play",
"diff_pregame_season_pass_epa_per_play","diff_pregame_l5_pass_epa_per_play",
"diff_pregame_season_off_success_rate","diff_pregame_l5_off_success_rate",
"diff_pregame_season_def_off_epa_per_play","diff_pregame_l5_def_off_epa_per_play",
"diff_pregame_season_def_pass_epa_per_play","diff_pregame_l5_def_pass_epa_per_play",
"diff_pregame_season_early_down_epa","diff_pregame_l5_early_down_epa",
"diff_pregame_season_sack_rate","diff_pregame_l5_sack_rate",
"diff_pregame_qb_l5_qb_epa_game","rest_diff"]

TOTAL_BASES_V11=[
"pregame_season_off_epa_per_play","pregame_l5_off_epa_per_play",
"pregame_season_def_off_epa_per_play","pregame_l5_def_off_epa_per_play",
"pregame_season_pass_epa_per_play","pregame_l5_pass_epa_per_play",
"pregame_season_def_pass_epa_per_play","pregame_l5_def_pass_epa_per_play",
"pregame_season_off_success_rate","pregame_l5_off_success_rate",
"pregame_season_explosive_rate","pregame_l5_explosive_rate",
"pregame_season_neutral_pass_rate","pregame_l5_neutral_pass_rate"]
TOTAL_V11=[f"sum_{x}" for x in TOTAL_BASES_V11]+["temp","wind"]

NGS_BASES=[
"pregame_season_ngs_qb_cpoe","pregame_l5_ngs_qb_cpoe",
"pregame_season_ngs_time_to_throw","pregame_l5_ngs_time_to_throw",
"pregame_season_ngs_aggressiveness","pregame_l5_ngs_aggressiveness",
"pregame_season_ngs_ryoe_per_att","pregame_l5_ngs_ryoe_per_att",
"pregame_season_ngs_rush_efficiency","pregame_l5_ngs_rush_efficiency",
"pregame_season_ngs_separation","pregame_l5_ngs_separation",
"pregame_season_ngs_yac_oe","pregame_l5_ngs_yac_oe"]
MARGIN_V12=MARGIN_V11+[f"diff_{x}" for x in NGS_BASES]
TOTAL_V12=TOTAL_V11+[f"sum_{x}" for x in NGS_BASES]

def finite(v):
    try:
        x=float(v); return x if np.isfinite(x) else None
    except Exception: return None

def prep(df):
    d=df[df["game_type"].astype(str).eq("REG")].copy().sort_values(["season","week","gameday","game_id"])
    d["rest_diff"]=pd.to_numeric(d["home_rest"],errors="coerce")-pd.to_numeric(d["away_rest"],errors="coerce")
    for b in TOTAL_BASES_V11+NGS_BASES:
        hc,ac=f"home_{b}",f"away_{b}"
        if hc not in d.columns: d[hc]=np.nan
        if ac not in d.columns: d[ac]=np.nan
        d[f"sum_{b}"]=pd.to_numeric(d[hc],errors="coerce")+pd.to_numeric(d[ac],errors="coerce")
    for f in MARGIN_V12:
        if f not in d.columns: d[f]=np.nan
    return d

def baseline_for_season(d,season):
    prior=d[d.season==season-1]; cur=d[d.season==season].sort_values(["week","gameday","game_id"])
    pm={}
    for idx,g in prior.iterrows():
        hs,as_=finite(g.home_score),finite(g.away_score)
        if hs is None or as_ is None: continue
        for tm,pf,pa in [(g.home_team,hs,as_),(g.away_team,as_,hs)]:
            row=pm.setdefault(tm,[0,0.,0.]);row[0]+=1;row[1]+=pf;row[2]+=pa
    cm={};out=[]
    for idx,g in cur.iterrows():
        def rates(mp,tm):
            r=mp.get(tm);return None if not r or not r[0] else (r[1]/r[0],r[2]/r[0],r[0])
        hp,hc=rates(pm,g.home_team),rates(cm,g.home_team)
        ap,ac=rates(pm,g.away_team),rates(cm,g.away_team)
        bm=bt=np.nan
        if (hp or hc) and (ap or ac):
            lg=22.5
            def blend(pr,cu,n):
                if cu is None:return pr
                w=max(0,n)/(max(0,n)+8);return pr*(1-w)+cu*w
            ho=blend(hp[0] if hp else lg,hc[0] if hc else None,hc[2] if hc else 0)
            hd=blend(hp[1] if hp else lg,hc[1] if hc else None,hc[2] if hc else 0)
            ao=blend(ap[0] if ap else lg,ac[0] if ac else None,ac[2] if ac else 0)
            ad=blend(ap[1] if ap else lg,ac[1] if ac else None,ac[2] if ac else 0)
            hfa=0 if str(g.location).lower()=="neutral" else 1.5
            rh=ho+(ad-lg)+hfa/2;ra=ao+(hd-lg)-hfa/2
            bm=.5*(rh-ra);bt=rh+ra
        out.append((idx,bm,bt))
        hs,as_=finite(g.home_score),finite(g.away_score)
        if hs is not None and as_ is not None:
            for tm,pf,pa in [(g.home_team,hs,as_),(g.away_team,as_,hs)]:
                rr=cm.setdefault(tm,[0,0.,0.]);rr[0]+=1;rr[1]+=pf;rr[2]+=pa
    return pd.DataFrame(out,columns=["idx","base_margin","base_total"]).set_index("idx")

def fit_pipe(features,target,train):
    m=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=ALPHA))
    m.fit(train[features],train[target]);return m

def ridge_predictions(d,test_season,margin_features,total_features):
    tr=d[d.season<test_season];te=d[d.season==test_season]
    if len(tr)<500 or len(te)==0:return None
    mm=fit_pipe(margin_features,"home_margin",tr);tm=fit_pipe(total_features,"final_total",tr)
    return pd.DataFrame({"pro_margin":mm.predict(te[margin_features]),"pro_total":tm.predict(te[total_features])},index=te.index)

def fold_metrics(a,m,t):
    return {"n":int(len(a)),"marginMae":float(mean_absolute_error(a.home_margin,m)),
            "totalMae":float(mean_absolute_error(a.final_total,t)),
            "winnerAccuracy":float(accuracy_score(a.home_margin>0,m>0))}

def choose_weight(d,pro_by,baseline,test_season):
    scored=[]
    for w in BLEND_GRID:
        vals=[]
        for s in range(2017,test_season):
            if s not in pro_by:continue
            a=d[d.season==s];ix=a.index.intersection(pro_by[s].index).intersection(baseline.index)
            a=a.loc[ix];p=pro_by[s].loc[ix];b=baseline.loc[ix]
            ok=b.base_margin.notna()&b.base_total.notna();a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
            if len(a):vals.append(fold_metrics(a,w*p.pro_margin+(1-w)*b.base_margin,w*p.pro_total+(1-w)*b.base_total))
        if vals:
            mmae=np.mean([v["marginMae"] for v in vals]);tmae=np.mean([v["totalMae"] for v in vals]);acc=np.mean([v["winnerAccuracy"] for v in vals])
            scored.append({"weight":w,"objective":mmae+tmae-2*acc,"marginMae":mmae,"totalMae":tmae,"winnerAccuracy":acc})
    return min(scored,key=lambda x:x["objective"])

def export_fit(model,features):
    imp=model.named_steps["simpleimputer"];sc=model.named_steps["standardscaler"];rd=model.named_steps["ridge"]
    return {"features":features,"imputerMedian":[float(x) for x in imp.statistics_],"scalerMean":[float(x) for x in sc.mean_],
            "scalerScale":[float(x) for x in sc.scale_],"ridgeCoef":[float(x) for x in rd.coef_],"intercept":float(rd.intercept_),"alpha":ALPHA}

def build_oos(d,baseline,margin_features,total_features):
    pro_by={s:ridge_predictions(d,s,margin_features,total_features) for s in range(2017,2027)}
    pro_by={k:v for k,v in pro_by.items() if v is not None}
    rows=[];folds=[]
    for season in range(2018,2027):
        if season not in pro_by:continue
        choice=choose_weight(d,pro_by,baseline,season)
        a=d[d.season==season];ix=a.index.intersection(pro_by[season].index).intersection(baseline.index)
        a=a.loc[ix];p=pro_by[season].loc[ix];b=baseline.loc[ix]
        ok=b.base_margin.notna()&b.base_total.notna();a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
        w=choice["weight"];pm=w*p.pro_margin+(1-w)*b.base_margin;pt=w*p.pro_total+(1-w)*b.base_total
        folds.append({"season":season,"selectedProWeight":w,"metrics":fold_metrics(a,pm,pt)})
        rows.append(pd.DataFrame({"season":season,"game_id":a.game_id,"actual_margin":a.home_margin,"actual_total":a.final_total,"pro_weight":w,"margin":pm,"total":pt},index=a.index))
    return pd.concat(rows),folds,pro_by

def metrics_for(oos):
    a=pd.DataFrame({"home_margin":oos.actual_margin,"final_total":oos.actual_total})
    return fold_metrics(a,oos["margin"],oos["total"])

def main():
    d=prep(pd.read_csv(DATA,low_memory=False))
    baseline=pd.concat([baseline_for_season(d,s) for s in range(2016,2027)])
    v11,folds11,pro11=build_oos(d,baseline,MARGIN_V11,TOTAL_V11)
    v12,folds12,pro12=build_oos(d,baseline,MARGIN_V12,TOTAL_V12)
    ix=v11.index.intersection(v12.index)
    v11=v11.loc[ix];v12=v12.loc[ix]
    a=d.loc[ix]
    b=baseline.loc[ix]
    market_m=-pd.to_numeric(a.closing_home_spread,errors="coerce")
    market_t=pd.to_numeric(a.closing_total,errors="coerce")
    actual=pd.DataFrame({"home_margin":a.home_margin,"final_total":a.final_total})
    m11=metrics_for(v11);m12=metrics_for(v12)
    base=fold_metrics(actual,b.base_margin,b.base_total)
    market=fold_metrics(actual,market_m,market_t)
    beats11={"marginMae":m12["marginMae"]<m11["marginMae"],"totalMae":m12["totalMae"]<m11["totalMae"],"winnerAccuracy":m12["winnerAccuracy"]>m11["winnerAccuracy"]}
    beatsMarket={"marginMae":m12["marginMae"]<market["marginMae"],"totalMae":m12["totalMae"]<market["totalMae"],"winnerAccuracy":m12["winnerAccuracy"]>market["winnerAccuracy"]}

    tr=d[d.season<=2025]
    mm=fit_pipe(MARGIN_V12,"home_margin",tr);tm=fit_pipe(TOTAL_V12,"final_total",tr)
    current_choice=choose_weight(d,{k:v for k,v in pro12.items() if k<=2025},baseline,2026)
    fit={"modelId":"NFL-PRO-v1.2","role":"research","marketInformed":False,"canQualify":False,
         "compactProWeight":current_choice["weight"],"formPriorWeight":1-current_choice["weight"],
         "margin":export_fit(mm,MARGIN_V12),"total":export_fit(tm,TOTAL_V12),"trainedThroughSeason":2025,
         "featureFamilies":["EPA","QB","NextGen passing","NextGen rushing","NextGen receiving","weather/rest"]}

    report={"modelId":"NFL-PRO-v1.2","design":"regularized EPA/QB core + lagged Next Gen tracking + independent form prior",
            "sample":{"startSeason":2018,"endSeason":2026,"n":int(len(ix))},
            "featureCounts":{"v11Margin":len(MARGIN_V11),"v11Total":len(TOTAL_V11),"v12Margin":len(MARGIN_V12),"v12Total":len(TOTAL_V12)},
            "ridgeAlpha":ALPHA,"nestedBlendSelection":True,"v12":m12,"v11":m11,"baseline":base,"market":market,
            "deltas":{"marginMaeVsV11":m12["marginMae"]-m11["marginMae"],"totalMaeVsV11":m12["totalMae"]-m11["totalMae"],
                      "winnerAccuracyVsV11":m12["winnerAccuracy"]-m11["winnerAccuracy"],
                      "marginMaeVsMarket":m12["marginMae"]-market["marginMae"],"totalMaeVsMarket":m12["totalMae"]-market["totalMae"],
                      "winnerAccuracyVsMarket":m12["winnerAccuracy"]-market["winnerAccuracy"]},
            "beatsV11":beats11,"beatsMarket":beatsMarket,
            "promotionEvidencePass":bool(len(ix)>=400 and all(beats11.values())),
            "marketBeatAllThree":bool(all(beatsMarket.values())),
            "governance":"Research evidence only. Promotion requires all predeclared v1.1 comparisons plus prospective stability; market benchmark is never an input.",
            "foldsV11":folds11,"foldsV12":folds12}
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    (OUT/"frozen-fit-through-2025.json").write_text(json.dumps(fit,indent=2))
    pd.DataFrame({"season":a.season,"game_id":a.game_id,"actual_margin":a.home_margin,"actual_total":a.final_total,
                  "v11_margin":v11["margin"],"v11_total":v11["total"],"v12_margin":v12["margin"],"v12_total":v12["total"],
                  "market_margin":market_m,"market_total":market_t},index=ix).to_csv(OUT/"oos-predictions.csv",index=False)
    print(json.dumps(report,indent=2))

if __name__=="__main__": main()
