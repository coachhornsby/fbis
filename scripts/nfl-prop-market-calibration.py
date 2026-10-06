#!/usr/bin/env python3
"""
NFL prop market-specific calibration audit.

Input: artifacts/nfl-prizepicks-history/graded-v3-vs-prizepicks.csv
Output:
  artifacts/nfl-prop-market-calibration/report.json
  artifacts/nfl-prop-market-calibration/calibration.sql

Governance:
- raw z-distance is never sufficient for 4★/5★
- each market must show an increasing edge->hit relationship
- probabilities are calibrated in chronological expanding windows
- no market auto-promotes production confidence
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss

SRC=Path("artifacts/nfl-prizepicks-history/graded-v3-vs-prizepicks.csv")
OUT=Path("artifacts/nfl-prop-market-calibration")
OUT.mkdir(parents=True,exist_ok=True)
MARKETS=["passing_yards","passing_attempts","completions","receiving_yards","receptions","rushing_yards"]
Z_BINS=[0,.25,.5,.75,1,1.25,1.5,2,99]

def q(v):
    if v is None:return "NULL"
    if isinstance(v,(int,float)) and np.isfinite(v):return str(float(v))
    return "'"+str(v).replace("'","''")+"'"

def normal_cdf(z):
    return .5*(1+math.erf(float(z)/math.sqrt(2)))

def ece(y,p):
    if not len(y):return None
    y=np.asarray(y,dtype=float);p=np.asarray(p,dtype=float)
    cuts=np.linspace(.5,1,11);score=0
    for lo,hi in zip(cuts[:-1],cuts[1:]):
        m=(p>=lo)&(p<(hi if hi<1 else hi+1e-9))
        if m.any():score+=m.mean()*abs(float(y[m].mean())-float(p[m].mean()))
    return float(score)

def rank_corr(values):
    if len(values)<3:return None
    x=np.arange(len(values),dtype=float);y=np.asarray(values,dtype=float)
    if np.std(y)<1e-12:return 0.0
    return float(np.corrcoef(x,y)[0,1])

def bucket_summary(g):
    bins=pd.cut(g.abs_z,Z_BINS,right=False)
    rows=[]
    for interval,x in g.groupby(bins,observed=True):
        rows.append({"range":str(interval),"n":int(len(x)),"hitRate":float(x.hit.mean())})
    return rows

def side_summary(g):
    return {str(k):{"n":int(len(x)),"hitRate":float(x.hit.mean())} for k,x in g.groupby("model_side")}

def role_summary(g):
    return {str(k):{"n":int(len(x)),"hitRate":float(x.hit.mean())} for k,x in g.groupby("target_role")}

def line_ranges(g):
    try:
        z=g.copy();z["bucket"]=pd.qcut(z.line,4,duplicates="drop")
        return [{"range":str(k),"n":int(len(x)),"lineMin":float(x.line.min()),"lineMax":float(x.line.max()),"hitRate":float(x.hit.mean())}
                for k,x in z.groupby("bucket",observed=True)]
    except Exception:return []

def expanding_calibration(g):
    preds=pd.Series(np.nan,index=g.index,dtype=float)
    for o in sorted(g.ord.dropna().astype(int).unique()):
        tr=g[g.ord<o];te=g[g.ord==o]
        if len(tr)<100:continue
        for side in ["MORE","LESS"]:
            tte=te[te.model_side==side]
            if tte.empty:continue
            ttr=tr[tr.model_side==side]
            use=ttr if len(ttr)>=40 else tr
            iso=IsotonicRegression(y_min=.50,y_max=.90,out_of_bounds="clip",increasing=True)
            iso.fit(use.abs_z,use.hit)
            preds.loc[tte.index]=iso.predict(tte.abs_z)
    return preds

def audit_market(g):
    g=g.copy()
    g["residual"]=pd.to_numeric(g.actual,errors="coerce")-pd.to_numeric(g.projection,errors="coerce")
    g["rawProb"]=g.abs_z.map(normal_cdf)
    g["calProb"]=expanding_calibration(g)
    wf=g[g.calProb.notna()].copy()
    zb=bucket_summary(g)
    eligible=[x for x in zb if x["n"]>=20]
    vals=[x["hitRate"] for x in eligible]
    monotonic=len(vals)>=3 and all(vals[i+1]>=vals[i]-.02 for i in range(len(vals)-1))
    corr=rank_corr(vals)
    raw_brier=float(brier_score_loss(g.hit,g.rawProb))
    raw_ll=float(log_loss(g.hit,np.clip(g.rawProb,.01,.99),labels=[0,1]))
    cal_brier=float(brier_score_loss(wf.hit,wf.calProb)) if len(wf) else None
    cal_ll=float(log_loss(wf.hit,np.clip(wf.calProb,.01,.99),labels=[0,1])) if len(wf) else None
    cal_ece=ece(wf.hit,wf.calProb) if len(wf) else None
    passed=bool(
        len(g)>=180 and len(wf)>=80 and monotonic and (corr is not None and corr>=.60)
        and cal_brier is not None and cal_brier<=.25 and cal_ece is not None and cal_ece<=.06
    )
    reasons=[]
    if len(g)<180:reasons.append("sample_below_180")
    if len(wf)<80:reasons.append("walk_forward_sample_below_80")
    if not monotonic:reasons.append("edge_to_hit_nonmonotonic")
    if corr is None or corr<.60:reasons.append("weak_edge_hit_rank_relationship")
    if cal_brier is None or cal_brier>.25:reasons.append("brier_above_0_25")
    if cal_ece is None or cal_ece>.06:reasons.append("ece_above_0_06")
    return {
      "n":int(len(g)),"walkForwardN":int(len(wf)),
      "bias":float(g.residual.mean()),"empiricalSigma":float(g.residual.std(ddof=1)),
      "rawBrier":raw_brier,"rawLogLoss":raw_ll,"rawEce":ece(g.hit,g.rawProb),
      "calibratedBrier":cal_brier,"calibratedLogLoss":cal_ll,"calibratedEce":cal_ece,
      "monotonic":monotonic,"bucketRankCorrelation":corr,
      "zBuckets":zb,"sides":side_summary(g),"roles":role_summary(g),"lineRanges":line_ranges(g),
      "validated":passed,"reason":"validated" if passed else ";".join(reasons),
      "closingLineEvidence":{"available":False,"reason":"historical PrizePicks reconstruction has pregame lines but not a separate executable closing-line series"},
    }

def main():
    if not SRC.exists():raise FileNotFoundError(SRC)
    d=pd.read_csv(SRC,low_memory=False)
    d=d[d.hit.notna() & d.sigma.notna() & (pd.to_numeric(d.sigma,errors="coerce")>0)].copy()
    d["ord"]=pd.to_numeric(d.season,errors="coerce")*100+pd.to_numeric(d.week,errors="coerce")
    d["abs_z"]=pd.to_numeric(d.abs_z,errors="coerce")
    d["line"]=pd.to_numeric(d.line,errors="coerce")
    d["hit"]=pd.to_numeric(d.hit,errors="coerce").astype(int)
    markets={}
    for market in MARKETS:
        g=d[d.market.eq(market)].sort_values(["ord","provider_fetched_at"]).copy()
        markets[market]=audit_market(g) if len(g) else {"n":0,"validated":False,"reason":"no_sample"}

    now=pd.Timestamp.utcnow().isoformat()
    report={
      "modelId":"NFL-PLAYER-PROJ-v3",
      "calibrationVersion":"NFL-PROP-MARKET-CAL-v2",
      "evaluatedAt":now,
      "governance":{
        "calibrationBeforeStars":True,"unvalidatedMaxStars":3,"rawZMayCreateFourOrFiveStars":False,
        "marketSpecificValidationRequired":True,"prospectiveValidationRequiredForPromotion":True
      },
      "validationRule":{
        "minTotalN":180,"minWalkForwardN":80,"monotonicTolerancePp":2,
        "minBucketRankCorrelation":.60,"maxCalibratedBrier":.25,"maxCalibratedEce":.06
      },
      "markets":markets,
      "validatedMarkets":[m for m,x in markets.items() if x.get("validated")],
      "conclusion":"No market may receive 4★/5★ unless listed in validatedMarkets and operator-approved in the production registry."
    }
    (OUT/"report.json").write_text(json.dumps(report,indent=2))

    run_id="nfl_prop_cal_v2_"+pd.Timestamp.utcnow().strftime("%Y%m%dT%H%M%SZ")
    sql=[]
    for market,x in markets.items():
      payload=json.dumps(x,separators=(",",":"))
      sql.append(
        "INSERT INTO nfl_prop_market_calibration_runs("
        "id,model_id,model_version,evaluated_at,market,sample_size,walk_forward_n,bias,empirical_sigma,"
        "raw_brier,raw_log_loss,raw_ece,calibrated_brier,calibrated_log_loss,calibrated_ece,monotonic,validated,validation_reason,report_json"
        ") VALUES("+",".join([
          q(run_id+"_"+market),q("NFL-PLAYER-PROJ-v3"),q("historical-reconstruction"),q(now),q(market),
          str(int(x.get("n",0))),str(int(x.get("walkForwardN",0))),q(x.get("bias")),q(x.get("empiricalSigma")),
          q(x.get("rawBrier")),q(x.get("rawLogLoss")),q(x.get("rawEce")),q(x.get("calibratedBrier")),q(x.get("calibratedLogLoss")),q(x.get("calibratedEce")),
          "1" if x.get("monotonic") else "0","1" if x.get("validated") else "0",q(x.get("reason")),q(payload)
        ])+");"
      )
    (OUT/"calibration.sql").write_text("\n".join(sql)+"\n")
    print(json.dumps(report,indent=2))

if __name__=="__main__":main()
