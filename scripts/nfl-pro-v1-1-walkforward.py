#!/usr/bin/env python3
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
OUT=Path("artifacts/nfl-pro-v1-1"); OUT.mkdir(parents=True,exist_ok=True)
ALPHA=20.0
BLEND_GRID=[round(x,1) for x in np.arange(0,1.01,.1)]
MARGIN_FEATURES=[
"diff_pregame_season_off_epa_per_play","diff_pregame_l5_off_epa_per_play",
"diff_pregame_season_pass_epa_per_play","diff_pregame_l5_pass_epa_per_play",
"diff_pregame_season_off_success_rate","diff_pregame_l5_off_success_rate",
"diff_pregame_season_def_off_epa_per_play","diff_pregame_l5_def_off_epa_per_play",
"diff_pregame_season_def_pass_epa_per_play","diff_pregame_l5_def_pass_epa_per_play",
"diff_pregame_season_early_down_epa","diff_pregame_l5_early_down_epa",
"diff_pregame_season_sack_rate","diff_pregame_l5_sack_rate",
"diff_pregame_qb_l5_qb_epa_game","rest_diff"]
TOTAL_BASES=[
"pregame_season_off_epa_per_play","pregame_l5_off_epa_per_play",
"pregame_season_def_off_epa_per_play","pregame_l5_def_off_epa_per_play",
"pregame_season_pass_epa_per_play","pregame_l5_pass_epa_per_play",
"pregame_season_def_pass_epa_per_play","pregame_l5_def_pass_epa_per_play",
"pregame_season_off_success_rate","pregame_l5_off_success_rate",
"pregame_season_explosive_rate","pregame_l5_explosive_rate",
"pregame_season_neutral_pass_rate","pregame_l5_neutral_pass_rate"]
TOTAL_FEATURES=[f"sum_{x}" for x in TOTAL_BASES]+["temp","wind"]

def finite(v):
    try:
        x=float(v); return x if np.isfinite(x) else None
    except Exception: return None

def prep(df):
    d=df[df["game_type"].astype(str).eq("REG")].copy()
    d=d.sort_values(["season","week","gameday","game_id"]).copy()
    d["rest_diff"]=pd.to_numeric(d["home_rest"],errors="coerce")-pd.to_numeric(d["away_rest"],errors="coerce")
    for b in TOTAL_BASES:
        d[f"sum_{b}"]=pd.to_numeric(d[f"home_{b}"],errors="coerce")+pd.to_numeric(d[f"away_{b}"],errors="coerce")
    return d

def baseline_for_season(d,season):
    prior=d[d.season==season-1]
    cur=d[d.season==season].sort_values(["week","gameday","game_id"])
    pm={}
    for idx,g in prior.iterrows():
        hs,as_=finite(g.home_score),finite(g.away_score)
        if hs is None or as_ is None: continue
        for tm,pf,pa in [(g.home_team,hs,as_),(g.away_team,as_,hs)]:
            r=pm.setdefault(tm,[0,0.0,0.0]); r[0]+=1; r[1]+=pf; r[2]+=pa
    cm={}; out=[]
    for idx,g in cur.iterrows():
        def rates(mp,tm):
            r=mp.get(tm); return None if not r or not r[0] else (r[1]/r[0],r[2]/r[0],r[0])
        hp,hc=rates(pm,g.home_team),rates(cm,g.home_team)
        ap,ac=rates(pm,g.away_team),rates(cm,g.away_team)
        bm=bt=np.nan
        if (hp or hc) and (ap or ac):
            lg=22.5
            def blend(pr,cu,n):
                if cu is None:return pr
                w=max(0,n)/(max(0,n)+8); return pr*(1-w)+cu*w
            ho=blend(hp[0] if hp else lg,hc[0] if hc else None,hc[2] if hc else 0)
            hd=blend(hp[1] if hp else lg,hc[1] if hc else None,hc[2] if hc else 0)
            ao=blend(ap[0] if ap else lg,ac[0] if ac else None,ac[2] if ac else 0)
            ad=blend(ap[1] if ap else lg,ac[1] if ac else None,ac[2] if ac else 0)
            hfa=0 if str(g.location).lower()=="neutral" else 1.5
            rh=ho+(ad-lg)+hfa/2; ra=ao+(hd-lg)-hfa/2
            bm=0.5*(rh-ra); bt=rh+ra
        out.append((idx,bm,bt))
        hs,as_=finite(g.home_score),finite(g.away_score)
        if hs is not None and as_ is not None:
            for tm,pf,pa in [(g.home_team,hs,as_),(g.away_team,as_,hs)]:
                r=cm.setdefault(tm,[0,0.0,0.0]); r[0]+=1;r[1]+=pf;r[2]+=pa
    return pd.DataFrame(out,columns=["idx","base_margin","base_total"]).set_index("idx")

def ridge_predictions(d,test_season):
    tr=d[d.season<test_season]; te=d[d.season==test_season]
    if len(tr)<500 or len(te)==0:return None
    mm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=ALPHA))
    tm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=ALPHA))
    mm.fit(tr[MARGIN_FEATURES],tr.home_margin)
    tm.fit(tr[TOTAL_FEATURES],tr.final_total)
    return pd.DataFrame({"pro_margin":mm.predict(te[MARGIN_FEATURES]),"pro_total":tm.predict(te[TOTAL_FEATURES])},index=te.index)

def fold_metrics(a,m,t):
    return {"n":int(len(a)),"marginMae":float(mean_absolute_error(a.home_margin,m)),
            "totalMae":float(mean_absolute_error(a.final_total,t)),
            "winnerAccuracy":float(accuracy_score(a.home_margin>0,m>0))}

def choose_weight(d,pro_by,baseline,test_season):
    scored=[]
    for w in BLEND_GRID:
        vals=[]
        for s in range(2017,test_season):
            if s not in pro_by: continue
            a=d[d.season==s]; ix=a.index.intersection(pro_by[s].index).intersection(baseline.index)
            a=a.loc[ix]; p=pro_by[s].loc[ix]; b=baseline.loc[ix]
            ok=b.base_margin.notna()&b.base_total.notna(); a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
            if not len(a):continue
            vals.append(fold_metrics(a,w*p.pro_margin+(1-w)*b.base_margin,w*p.pro_total+(1-w)*b.base_total))
        if vals:
            mmae=np.mean([v["marginMae"] for v in vals]); tmae=np.mean([v["totalMae"] for v in vals]); acc=np.mean([v["winnerAccuracy"] for v in vals])
            scored.append({"weight":w,"objective":mmae+tmae-2*acc,"marginMae":mmae,"totalMae":tmae,"winnerAccuracy":acc})
    return min(scored,key=lambda x:x["objective"])

def export_fit(model,features):
    imp=model.named_steps["simpleimputer"]; sc=model.named_steps["standardscaler"]; rd=model.named_steps["ridge"]
    return {"features":features,"imputerMedian":[float(x) for x in imp.statistics_],"scalerMean":[float(x) for x in sc.mean_],
            "scalerScale":[float(x) for x in sc.scale_],"ridgeCoef":[float(x) for x in rd.coef_],
            "intercept":float(rd.intercept_),"alpha":ALPHA}

def main():
    raw=pd.read_csv(DATA,low_memory=False); d=prep(raw)
    baseline=pd.concat([baseline_for_season(d,s) for s in range(2016,2027)])
    pro_by={s:ridge_predictions(d,s) for s in range(2017,2027)}
    pro_by={k:v for k,v in pro_by.items() if v is not None}
    folds=[]; rows=[]
    for season in range(2018,2027):
        choice=choose_weight(d,pro_by,baseline,season)
        a=d[d.season==season]; ix=a.index.intersection(pro_by[season].index).intersection(baseline.index)
        a=a.loc[ix];p=pro_by[season].loc[ix];b=baseline.loc[ix]
        ok=b.base_margin.notna()&b.base_total.notna();a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
        w=choice["weight"]; vm=w*p.pro_margin+(1-w)*b.base_margin; vt=w*p.pro_total+(1-w)*b.base_total
        market_m=-pd.to_numeric(a.closing_home_spread,errors="coerce"); market_t=pd.to_numeric(a.closing_total,errors="coerce")
        folds.append({"season":season,"selectedProWeight":w,"selectionEvidence":choice,
                      "v11":fold_metrics(a,vm,vt),"baseline":fold_metrics(a,b.base_margin,b.base_total),
                      "market":fold_metrics(a,market_m,market_t)})
        rows.append(pd.DataFrame({"season":season,"game_id":a.game_id,"actual_margin":a.home_margin,"actual_total":a.final_total,
                                  "pro_weight":w,"v11_margin":vm,"v11_total":vt,"base_margin":b.base_margin,"base_total":b.base_total,
                                  "market_margin":market_m,"market_total":market_t},index=a.index))
    oos=pd.concat(rows)
    def overall(prefix):
        a=pd.DataFrame({"home_margin":oos.actual_margin,"final_total":oos.actual_total})
        return fold_metrics(a,oos[f"{prefix}_margin"],oos[f"{prefix}_total"])
    v11,base,market=overall("v11"),overall("base"),overall("market")
    beats={"marginMae":v11["marginMae"]<base["marginMae"],"totalMae":v11["totalMae"]<base["totalMae"],"winnerAccuracy":v11["winnerAccuracy"]>base["winnerAccuracy"]}
    tr=d[d.season<=2025]
    mm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=ALPHA)); mm.fit(tr[MARGIN_FEATURES],tr.home_margin)
    tm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=ALPHA)); tm.fit(tr[TOTAL_FEATURES],tr.final_total)
    current_choice=choose_weight(d,{k:v for k,v in pro_by.items() if k<=2025},baseline,2026)
    fit={"modelId":"NFL-PRO-v1.1","role":"research","marketInformed":False,"canQualify":False,
         "compactProWeight":current_choice["weight"],"formPriorWeight":1-current_choice["weight"],
         "margin":export_fit(mm,MARGIN_FEATURES),"total":export_fit(tm,TOTAL_FEATURES),"trainedThroughSeason":2025}
    report={"modelId":"NFL-PRO-v1.1","design":"compact regularized EPA/QB core + independent calibrated form prior",
            "sample":{"startSeason":2018,"endSeason":2026,"n":int(len(oos))},
            "featureCounts":{"margin":len(MARGIN_FEATURES),"total":len(TOTAL_FEATURES)},"ridgeAlpha":ALPHA,
            "nestedBlendSelection":True,"v11":v11,"baseline":base,"market":market,
            "deltas":{"marginMaeVsBaseline":v11["marginMae"]-base["marginMae"],"totalMaeVsBaseline":v11["totalMae"]-base["totalMae"],
                      "winnerAccuracyVsBaseline":v11["winnerAccuracy"]-base["winnerAccuracy"],
                      "marginMaeVsMarket":v11["marginMae"]-market["marginMae"],"totalMaeVsMarket":v11["totalMae"]-market["totalMae"],
                      "winnerAccuracyVsMarket":v11["winnerAccuracy"]-market["winnerAccuracy"]},
            "beatsBaseline":beats,"promotionEvidencePass":bool(len(oos)>=400 and all(beats.values())),
            "governance":"Research evidence only. No automatic model promotion or wager authorization.","folds":folds}
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    (OUT/"frozen-fit-through-2025.json").write_text(json.dumps(fit,indent=2))
    oos.to_csv(OUT/"oos-predictions.csv",index=False)
    print(json.dumps(report,indent=2))
if __name__=="__main__": main()
