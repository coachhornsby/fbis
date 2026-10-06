#!/usr/bin/env python3
"""
Leakage-safe NFL persistent-personnel ablation.

Compares:
  NFL-PRO-v1.1
  NFL-PRO-v1.1 + pregame injury/practice status weighted by lagged player snap role

No market line, travel, schedule stress, or coaching feature is used as an input.

Modes:
  --mode=features   Download nflverse injuries/snap counts and build team-week personnel features.
  --mode=evaluate   Rebuild v1.1 OOS predictions from the canonical FBIS training dataset,
                    fit residual personnel corrections on prior seasons only, and evaluate.

Sources:
  nflverse injuries release: weekly injury/practice reports
  nflverse snap_counts release: game-level offensive/defensive snap percentages
"""
from __future__ import annotations
import argparse, json, math, os, re, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, accuracy_score, brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT=Path("artifacts/nfl-persistent-personnel-ablation")
ROOT.mkdir(parents=True,exist_ok=True)
FEATURE_FILE=ROOT/"personnel_features.csv"
REPORT_FILE=ROOT/"report.json"
OOS_FILE=ROOT/"oos_predictions.csv"
FOLDS_FILE=ROOT/"folds.json"

DATA=Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
ALPHA=20.0
RESIDUAL_ALPHA=35.0
BLEND_GRID=[round(x,1) for x in np.arange(0,1.01,.1)]
SEASONS=list(range(2015,2027))

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

TEAM_FEATURES=[
    "avail_burden","out_burden","doubtful_burden","questionable_burden",
    "practice_dnp_burden","limited_burden","qb_burden","skill_burden","ol_burden",
    "front7_burden","secondary_burden","offense_burden","defense_burden",
    "replacement_gap","starter_concern_count","max_player_burden","injury_count",
]
MARGIN_PERSONNEL=[f"pers_diff_{x}" for x in TEAM_FEATURES]
TOTAL_PERSONNEL=[f"pers_sum_{x}" for x in TEAM_FEATURES]+[f"pers_absdiff_{x}" for x in TEAM_FEATURES]

TEAM_MAP={"JAC":"JAX","LA":"LAR","OAK":"LV","WSH":"WAS","SD":"LAC","STL":"LAR"}
OFF_POS={"QB","RB","FB","WR","TE","T","OT","G","OG","C","OL"}
DEF_POS={"DE","DT","DL","NT","LB","ILB","OLB","EDGE","CB","S","SS","FS","DB"}
SKILL={"RB","FB","WR","TE"}
OL={"T","OT","G","OG","C","OL"}
FRONT7={"DE","DT","DL","NT","LB","ILB","OLB","EDGE"}
SECONDARY={"CB","S","SS","FS","DB"}

def canon_team(v):
    s=str(v or "").upper().strip()
    return TEAM_MAP.get(s,s)

def norm_name(v):
    s=str(v or "").lower()
    s=re.sub(r"[^a-z0-9]+"," ",s).strip()
    for suffix in (" jr"," sr"," ii"," iii"," iv"," v"):
        if s.endswith(suffix): s=s[:-len(suffix)].strip()
    return s

def finite(v):
    try:
        x=float(v)
        return x if np.isfinite(x) else None
    except Exception:
        return None

def ordinal(season,week):
    return int(season)*100+int(week)

def status_weight(report_status,practice_status):
    rs=str(report_status or "").upper()
    ps=str(practice_status or "").upper()
    if "OUT" in rs: return 1.00,"OUT"
    if "DOUBT" in rs: return .82,"DOUBTFUL"
    if "QUESTION" in rs: return .35,"QUESTIONABLE"
    if "DID NOT" in ps or re.search(r"\bDNP\b",ps): return .28,"DNP_PRACTICE"
    if "LIMIT" in ps: return .15,"LIMITED"
    return 0.0,"OTHER"

def position_group(pos):
    p=str(pos or "").upper().strip()
    if p=="QB": return "QB"
    if p in SKILL: return "SKILL"
    if p in OL: return "OL"
    if p in FRONT7: return "FRONT7"
    if p in SECONDARY: return "SECONDARY"
    return "OTHER"

def download_csv(url):
    req=urllib.request.Request(url,headers={"User-Agent":"FBIS-NFL-Personnel-Ablation/1.0","Accept":"text/csv,*/*"})
    with urllib.request.urlopen(req,timeout=30) as r:
        return pd.read_csv(r,low_memory=False)

def fetch_season(kind,season):
    if kind=="injury":
        url=f"https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"
    else:
        url=f"https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv"
    try:
        df=download_csv(url)
        print(f"{kind} {season}: {len(df):,}",flush=True)
        return season,df,None
    except Exception as exc:
        print(f"{kind} {season} FAILED: {exc}",flush=True)
        return season,None,str(exc)

def parallel_load(kind,seasons):
    out=[];errors=[]
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs={ex.submit(fetch_season,kind,s):s for s in seasons}
        for fut in as_completed(futs):
            season,df,err=fut.result()
            if df is not None: out.append(df)
            else: errors.append({"season":season,"error":err})
    if not out: raise RuntimeError(f"No {kind} data loaded")
    return pd.concat(out,ignore_index=True,sort=False),errors

def latest_prior_snap_features(snaps, injuries):
    s=snaps.copy()
    s["season"]=pd.to_numeric(s.get("season"),errors="coerce")
    s["week"]=pd.to_numeric(s.get("week"),errors="coerce")
    s=s[s["season"].notna() & s["week"].notna()].copy()
    s["team"]=s["team"].map(canon_team)
    s["name_key"]=s["player"].map(norm_name)
    s["pos"]=s["position"].astype(str).str.upper()
    s["ord"]=(s["season"].astype(int)*100+s["week"].astype(int)).astype(int)
    s["off_pct"]=pd.to_numeric(s.get("offense_pct"),errors="coerce").fillna(0.0)
    s["def_pct"]=pd.to_numeric(s.get("defense_pct"),errors="coerce").fillna(0.0)
    # Some releases express percentages as 0-100; normalize to 0-1.
    s.loc[s["off_pct"]>1.5,"off_pct"]/=100.0
    s.loc[s["def_pct"]>1.5,"def_pct"]/=100.0

    ident=np.where(s.get("pfr_player_id",pd.Series(index=s.index,dtype=object)).notna(),
                   s.get("pfr_player_id").astype(str), s["name_key"])
    s["player_key"]=ident
    s=s.sort_values(["player_key","ord","game_id"])
    s["trail_off_pct"]=s.groupby("player_key")["off_pct"].transform(lambda x:x.rolling(5,min_periods=1).mean())
    s["trail_def_pct"]=s.groupby("player_key")["def_pct"].transform(lambda x:x.rolling(5,min_periods=1).mean())

    # Collapse multiple rows inside same player/week to latest game representation.
    role=s.groupby(["name_key","team","ord"],as_index=False).agg(
        prior_off=("trail_off_pct","mean"),prior_def=("trail_def_pct","mean"),prior_pos=("pos","last")
    ).sort_values(["name_key","team","ord"])

    inj=injuries.copy()
    inj["season"]=pd.to_numeric(inj.get("season"),errors="coerce")
    inj["week"]=pd.to_numeric(inj.get("week"),errors="coerce")
    inj=inj[inj["season"].notna()&inj["week"].notna()].copy()
    inj["team"]=inj["team"].map(canon_team)
    inj["name_key"]=inj["full_name"].map(norm_name)
    inj["ord"]=(inj["season"].astype(int)*100+inj["week"].astype(int)).astype(int)
    inj["position"]=inj["position"].astype(str).str.upper()

    # Merge strictly backward in time. Current-week snap participation is never used.
    merged_parts=[]
    for (name,team),g in inj.groupby(["name_key","team"],sort=False):
        rg=role[(role["name_key"]==name)&(role["team"]==team)]
        gg=g.sort_values("ord").copy()
        if len(rg):
            m=pd.merge_asof(
                gg, rg[["ord","prior_off","prior_def","prior_pos"]].sort_values("ord"),
                on="ord",direction="backward",allow_exact_matches=False
            )
        else:
            gg["prior_off"]=np.nan;gg["prior_def"]=np.nan;gg["prior_pos"]=np.nan;m=gg
        merged_parts.append(m)
    merged=pd.concat(merged_parts,ignore_index=True) if merged_parts else inj
    return merged,s

def build_team_week_features(inj_with_role,snap_history):
    x=inj_with_role.copy()
    weights=x.apply(lambda r:status_weight(r.get("report_status"),r.get("practice_status")),axis=1)
    x["status_weight"]=[a for a,b in weights]
    x["status_bucket"]=[b for a,b in weights]
    x=x[x["status_weight"]>0].copy()
    x["group"]=x["position"].map(position_group)
    x["role_snap"]=np.where(
        x["position"].isin(OFF_POS),
        pd.to_numeric(x["prior_off"],errors="coerce"),
        pd.to_numeric(x["prior_def"],errors="coerce")
    )
    x["role_snap"]=pd.to_numeric(x["role_snap"],errors="coerce").fillna(0.08).clip(0,1)
    x["burden"]=x["role_snap"]*x["status_weight"]

    # Build prior-game position-group depth capacity from strictly earlier snap rows.
    sh=snap_history.copy()
    sh["group"]=sh["pos"].map(position_group)
    sh["role_snap"]=np.where(sh["pos"].isin(OFF_POS),sh["trail_off_pct"],sh["trail_def_pct"])
    sh=sh[sh["group"]!="OTHER"].copy()
    depth=sh.groupby(["team","group","ord"],as_index=False).agg(
        top1=("role_snap","max"),
        top2=("role_snap",lambda v: sorted([float(z) for z in v if pd.notna(z)],reverse=True)[1] if len([z for z in v if pd.notna(z)])>1 else 0.0)
    ).sort_values(["team","group","ord"])
    depth_parts=[]
    for (team,grp),g in x.groupby(["team","group"],sort=False):
        dg=depth[(depth["team"]==team)&(depth["group"]==grp)]
        gg=g.sort_values("ord").copy()
        if len(dg):
            m=pd.merge_asof(gg,dg[["ord","top1","top2"]].sort_values("ord"),on="ord",direction="backward",allow_exact_matches=False)
        else:
            gg["top1"]=np.nan;gg["top2"]=np.nan;m=gg
        depth_parts.append(m)
    x=pd.concat(depth_parts,ignore_index=True) if depth_parts else x
    x["backup_capacity"]=pd.to_numeric(x.get("top2"),errors="coerce").fillna(0.0).clip(0,1)
    x["replacement_gap"]=np.maximum(x["role_snap"]-x["backup_capacity"],0)*x["status_weight"]
    x["starter_concern"]=(x["role_snap"]>=.5).astype(float)

    records=[]
    for (season,week,team),g in x.groupby(["season","week","team"]):
        def burden_bucket(bucket): return float(g.loc[g.status_bucket.eq(bucket),"burden"].sum())
        rec={
            "season":int(season),"week":int(week),"team":team,
            "avail_burden":float(g["burden"].sum()),
            "out_burden":burden_bucket("OUT"),
            "doubtful_burden":burden_bucket("DOUBTFUL"),
            "questionable_burden":burden_bucket("QUESTIONABLE"),
            "practice_dnp_burden":burden_bucket("DNP_PRACTICE"),
            "limited_burden":burden_bucket("LIMITED"),
            "qb_burden":float(g.loc[g.group.eq("QB"),"burden"].sum()),
            "skill_burden":float(g.loc[g.group.eq("SKILL"),"burden"].sum()),
            "ol_burden":float(g.loc[g.group.eq("OL"),"burden"].sum()),
            "front7_burden":float(g.loc[g.group.eq("FRONT7"),"burden"].sum()),
            "secondary_burden":float(g.loc[g.group.eq("SECONDARY"),"burden"].sum()),
            "offense_burden":float(g.loc[g.position.isin(OFF_POS),"burden"].sum()),
            "defense_burden":float(g.loc[g.position.isin(DEF_POS),"burden"].sum()),
            "replacement_gap":float(g["replacement_gap"].sum()),
            "starter_concern_count":float(g["starter_concern"].sum()),
            "max_player_burden":float(g["burden"].max() if len(g) else 0),
            "injury_count":float(len(g)),
        }
        records.append(rec)
    return pd.DataFrame(records),x

def build_features():
    injuries,inj_err=parallel_load("injury",SEASONS)
    snaps,snap_err=parallel_load("snap",SEASONS)
    if "game_type" in snaps.columns:
        snaps=snaps[snaps["game_type"].astype(str).str.upper().eq("REG")]
    if "game_type" in injuries.columns:
        injuries=injuries[injuries["game_type"].astype(str).str.upper().eq("REG")]
    merged,snap_hist=latest_prior_snap_features(snaps,injuries)
    features,detail=build_team_week_features(merged,snap_hist)
    features.to_csv(FEATURE_FILE,index=False)
    detail_sample=detail[[
        c for c in ["season","week","team","full_name","position","report_status","practice_status","role_snap","status_weight","burden","replacement_gap"]
        if c in detail.columns
    ]].head(5000)
    detail_sample.to_csv(ROOT/"personnel_detail_sample.csv",index=False)
    qa={
        "injuryRows":int(len(injuries)),"snapRows":int(len(snaps)),"featureRows":int(len(features)),
        "seasons":[int(features.season.min()),int(features.season.max())] if len(features) else [],
        "injuryDownloadErrors":inj_err,"snapDownloadErrors":snap_err,
        "priorSnapCoverage":float((
            pd.to_numeric(merged.get("prior_off"),errors="coerce").notna() |
            pd.to_numeric(merged.get("prior_def"),errors="coerce").notna()
        ).mean()) if len(merged) else 0,
        "temporalIntegrity":"Injury rows for week W are joined only to snap observations from ord < W; current-game snap participation never enters its own feature.",
        "featureFamilies":["official injury/practice status","lagged 5-game snap role","same-position prior replacement capacity"],
        "marketInformed":False,
    }
    (ROOT/"features_qa.json").write_text(json.dumps(qa,indent=2))
    print(json.dumps(qa,indent=2))

def prep(df):
    d=df[df["game_type"].astype(str).eq("REG")].copy().sort_values(["season","week","gameday","game_id"])
    d["rest_diff"]=pd.to_numeric(d["home_rest"],errors="coerce")-pd.to_numeric(d["away_rest"],errors="coerce")
    for b in TOTAL_BASES_V11:
        hc,ac=f"home_{b}",f"away_{b}"
        if hc not in d.columns:d[hc]=np.nan
        if ac not in d.columns:d[ac]=np.nan
        d[f"sum_{b}"]=pd.to_numeric(d[hc],errors="coerce")+pd.to_numeric(d[ac],errors="coerce")
    for f in MARGIN_V11+TOTAL_V11:
        if f not in d.columns:d[f]=np.nan
    return d

def baseline_for_season(d,season):
    prior=d[d.season==season-1];cur=d[d.season==season].sort_values(["week","gameday","game_id"])
    pm={}
    for idx,g in prior.iterrows():
        hs,as_=finite(g.home_score),finite(g.away_score)
        if hs is None or as_ is None:continue
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

def fit_pipe(features,target,train,alpha=ALPHA):
    m=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=alpha))
    m.fit(train[features],train[target]);return m

def ridge_predictions(d,test_season):
    tr=d[d.season<test_season];te=d[d.season==test_season]
    if len(tr)<500 or len(te)==0:return None
    mm=fit_pipe(MARGIN_V11,"home_margin",tr);tm=fit_pipe(TOTAL_V11,"final_total",tr)
    return pd.DataFrame({"pro_margin":mm.predict(te[MARGIN_V11]),"pro_total":tm.predict(te[TOTAL_V11])},index=te.index)

def point_metrics(actual,pred_margin,pred_total):
    return {
      "n":int(len(actual)),
      "marginMae":float(mean_absolute_error(actual.home_margin,pred_margin)),
      "totalMae":float(mean_absolute_error(actual.final_total,pred_total)),
      "winnerAccuracy":float(accuracy_score(actual.home_margin>0,np.asarray(pred_margin)>0)),
    }

def choose_weight(d,pro_by,baseline,test_season):
    scored=[]
    for w in BLEND_GRID:
        vals=[]
        for s in range(2017,test_season):
            if s not in pro_by:continue
            a=d[d.season==s];ix=a.index.intersection(pro_by[s].index).intersection(baseline.index)
            a=a.loc[ix];p=pro_by[s].loc[ix];b=baseline.loc[ix]
            ok=b.base_margin.notna()&b.base_total.notna();a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
            if len(a):
                m=point_metrics(a,w*p.pro_margin+(1-w)*b.base_margin,w*p.pro_total+(1-w)*b.base_total)
                vals.append(m)
        if vals:
            mmae=np.mean([v["marginMae"] for v in vals]);tmae=np.mean([v["totalMae"] for v in vals]);acc=np.mean([v["winnerAccuracy"] for v in vals])
            scored.append({"weight":w,"objective":mmae+tmae-2*acc})
    return min(scored,key=lambda x:x["objective"])["weight"]

def build_v11_oos(d):
    baseline=pd.concat([baseline_for_season(d,s) for s in range(2016,2027)])
    pro_by={s:ridge_predictions(d,s) for s in range(2017,2027)}
    pro_by={k:v for k,v in pro_by.items() if v is not None}
    rows=[]
    for season in range(2018,2027):
        if season not in pro_by:continue
        w=choose_weight(d,pro_by,baseline,season)
        a=d[d.season==season];ix=a.index.intersection(pro_by[season].index).intersection(baseline.index)
        a=a.loc[ix];p=pro_by[season].loc[ix];b=baseline.loc[ix]
        ok=b.base_margin.notna()&b.base_total.notna();a=a.loc[ok];p=p.loc[ok];b=b.loc[ok]
        rows.append(pd.DataFrame({
          "season":season,"week":a.week,"gameday":a.gameday,"game_id":a.game_id,
          "actual_margin":a.home_margin,"actual_total":a.final_total,
          "closing_home_spread":pd.to_numeric(a.closing_home_spread,errors="coerce"),
          "closing_total":pd.to_numeric(a.closing_total,errors="coerce"),
          "v11_margin":w*p.pro_margin+(1-w)*b.base_margin,
          "v11_total":w*p.pro_total+(1-w)*b.base_total,
          "pro_weight":w,
          "home_team":a.home_team.map(canon_team),"away_team":a.away_team.map(canon_team)
        },index=a.index))
    return pd.concat(rows).sort_values(["season","week","gameday","game_id"])

def merge_personnel(oos,feat):
    f=feat.copy();f["team"]=f.team.map(canon_team)
    h=f.rename(columns={x:f"home_{x}" for x in TEAM_FEATURES})
    a=f.rename(columns={x:f"away_{x}" for x in TEAM_FEATURES})
    out=oos.merge(h,left_on=["season","week","home_team"],right_on=["season","week","team"],how="left").drop(columns=["team"],errors="ignore")
    out=out.merge(a,left_on=["season","week","away_team"],right_on=["season","week","team"],how="left").drop(columns=["team"],errors="ignore")
    for x in TEAM_FEATURES:
        hc,ac=f"home_{x}",f"away_{x}"
        out[hc]=pd.to_numeric(out.get(hc),errors="coerce").fillna(0)
        out[ac]=pd.to_numeric(out.get(ac),errors="coerce").fillna(0)
        out[f"pers_diff_{x}"]=out[hc]-out[ac]
        out[f"pers_sum_{x}"]=out[hc]+out[ac]
        out[f"pers_absdiff_{x}"]=(out[hc]-out[ac]).abs()
    out["combined_availability_burden"]=out["pers_sum_avail_burden"]
    out["combined_qb_burden"]=out["pers_sum_qb_burden"]
    out["combined_replacement_gap"]=out["pers_sum_replacement_gap"]
    out["combined_starter_concern"]=out["pers_sum_starter_concern_count"]
    return out

def normal_cdf(z):
    arr=np.asarray(z,dtype=float)
    return np.vectorize(lambda x:.5*(1+math.erf(x/math.sqrt(2))))(arr)

def probability_metrics(y,p):
    p=np.clip(np.asarray(p,dtype=float),.01,.99);y=np.asarray(y,dtype=int)
    bins=np.linspace(0,1,11);ece=0.0;cal=[]
    for lo,hi in zip(bins[:-1],bins[1:]):
        m=(p>=lo)&(p<(hi if hi<1 else hi+1e-9))
        if not m.any():continue
        conf=float(p[m].mean());obs=float(y[m].mean());n=int(m.sum())
        ece+=n/len(p)*abs(conf-obs)
        cal.append({"lo":float(lo),"hi":float(hi),"n":n,"pred":conf,"actual":obs})
    return {"brier":float(brier_score_loss(y,p)),"logLoss":float(log_loss(y,p,labels=[0,1])),"ece10":float(ece),"calibration":cal}

def betting_metrics(df,margin_col,total_col,sigma_margin,sigma_total,threshold=.55):
    market_margin=-pd.to_numeric(df.closing_home_spread,errors="coerce")
    market_total=pd.to_numeric(df.closing_total,errors="coerce")
    pm=pd.to_numeric(df[margin_col],errors="coerce")
    pt=pd.to_numeric(df[total_col],errors="coerce")
    p_home_cover=normal_cdf((pm-market_margin)/max(sigma_margin,1e-6))
    p_over=normal_cdf((pt-market_total)/max(sigma_total,1e-6))
    rows=[]
    for kind,p,actual,line in [
      ("side",p_home_cover,pd.to_numeric(df.actual_margin,errors="coerce"),market_margin),
      ("total",p_over,pd.to_numeric(df.actual_total,errors="coerce"),market_total),
    ]:
        units=[];bets=0;wins=losses=pushes=0
        for pi,ai,li in zip(p,actual,line):
            if not np.isfinite(pi) or not np.isfinite(ai) or not np.isfinite(li):continue
            pick=1 if pi>=threshold else (-1 if pi<=1-threshold else 0)
            if pick==0:continue
            diff=(ai-li)*pick;bets+=1
            if diff>0:wins+=1;units.append(100/110)
            elif diff<0:losses+=1;units.append(-1.0)
            else:pushes+=1;units.append(0.0)
        cum=np.cumsum(units) if units else np.array([])
        peak=np.maximum.accumulate(np.r_[0,cum]) if units else np.array([0])
        series=np.r_[0,cum] if units else np.array([0])
        dd=peak-series
        rows.append({"market":kind,"threshold":threshold,"bets":bets,"wins":wins,"losses":losses,"pushes":pushes,
                     "units":float(sum(units)),"roi":float(sum(units)/bets) if bets else None,
                     "maxDrawdownUnits":float(dd.max()) if len(dd) else 0})
    return rows

def metrics_block(df,margin_col,total_col,sigma_margin,sigma_total):
    actual=pd.DataFrame({"home_margin":df.actual_margin,"final_total":df.actual_total})
    point=point_metrics(actual,df[margin_col],df[total_col])
    p_home=normal_cdf(pd.to_numeric(df[margin_col],errors="coerce")/max(sigma_margin,1e-6))
    win=(pd.to_numeric(df.actual_margin,errors="coerce")>0).astype(int)
    point["winProbability"]=probability_metrics(win,p_home)
    point["bettingAt55Pct"]=betting_metrics(df,margin_col,total_col,sigma_margin,sigma_total,.55)
    return point

def evaluate():
    if not DATA.exists(): raise FileNotFoundError(DATA)
    if not FEATURE_FILE.exists(): raise FileNotFoundError(FEATURE_FILE)
    d=prep(pd.read_csv(DATA,low_memory=False))
    v11=build_v11_oos(d)
    feat=pd.read_csv(FEATURE_FILE,low_memory=False)
    m=merge_personnel(v11.reset_index(drop=True),feat)

    # Keep all rows; no injury report for a team/week means zero observed burden.
    rows=[];folds=[]
    for season in range(2019,2027):
        tr=m[m.season<season].copy();te=m[m.season==season].copy()
        if len(tr)<500 or len(te)==0:continue
        # Residual correction learned strictly from prior-season OOS residuals.
        tr["margin_resid"]=tr.actual_margin-tr.v11_margin
        tr["total_resid"]=tr.actual_total-tr.v11_total
        mm=fit_pipe(MARGIN_PERSONNEL,"margin_resid",tr,RESIDUAL_ALPHA)
        tm=fit_pipe(TOTAL_PERSONNEL,"total_resid",tr,RESIDUAL_ALPHA)
        cm=np.clip(mm.predict(te[MARGIN_PERSONNEL]),-5.0,5.0)
        ct=np.clip(tm.predict(te[TOTAL_PERSONNEL]),-7.0,7.0)
        te["chall_margin"]=te.v11_margin+cm
        te["chall_total"]=te.v11_total+ct
        sigma_m=float(np.std(tr.margin_resid,ddof=1))
        sigma_t=float(np.std(tr.total_resid,ddof=1))
        folds.append({
          "season":season,"n":int(len(te)),
          "baseline":metrics_block(te,"v11_margin","v11_total",sigma_m,sigma_t),
          "challenger":metrics_block(te,"chall_margin","chall_total",sigma_m,sigma_t),
          "meanAbsMarginCorrection":float(np.mean(np.abs(cm))),
          "meanAbsTotalCorrection":float(np.mean(np.abs(ct))),
        })
        rows.append(te)
    oos=pd.concat(rows,ignore_index=True)
    train_for_sigma=m[m.season<oos.season.min()].copy()
    # Use pooled OOS baseline residual sigma for aggregate probability conversion.
    sigma_m=float(np.std(oos.actual_margin-oos.v11_margin,ddof=1))
    sigma_t=float(np.std(oos.actual_total-oos.v11_total,ddof=1))
    base=metrics_block(oos,"v11_margin","v11_total",sigma_m,sigma_t)
    chal=metrics_block(oos,"chall_margin","chall_total",sigma_m,sigma_t)

    segments={}
    defs={
      "injuryHeavy":oos.combined_availability_burden>=1.0,
      "qbAffected":oos.combined_qb_burden>=.15,
      "replacementGapHigh":oos.combined_replacement_gap>=.50,
      "starterConcern2Plus":oos.combined_starter_concern>=2,
    }
    for name,mask in defs.items():
        z=oos[mask]
        if len(z)<25:continue
        segments[name]={
          "n":int(len(z)),
          "baseline":point_metrics(pd.DataFrame({"home_margin":z.actual_margin,"final_total":z.actual_total}),z.v11_margin,z.v11_total),
          "challenger":point_metrics(pd.DataFrame({"home_margin":z.actual_margin,"final_total":z.actual_total}),z.chall_margin,z.chall_total),
        }

    deltas={
      "marginMae":chal["marginMae"]-base["marginMae"],
      "totalMae":chal["totalMae"]-base["totalMae"],
      "winnerAccuracy":chal["winnerAccuracy"]-base["winnerAccuracy"],
      "brier":chal["winProbability"]["brier"]-base["winProbability"]["brier"],
      "logLoss":chal["winProbability"]["logLoss"]-base["winProbability"]["logLoss"],
      "ece10":chal["winProbability"]["ece10"]-base["winProbability"]["ece10"],
    }
    pass_core=(deltas["marginMae"]<0 and deltas["totalMae"]<=0 and deltas["brier"]<=0)
    report={
      "experiment":"NFL-PRO-v1.1 + persistent availability/snap redistribution ablation",
      "design":"Residual challenger trained only on prior-season OOS residuals; personnel inputs use current-week pregame injury/practice status and strictly prior-game snap role/replacement capacity.",
      "sample":{"startSeason":int(oos.season.min()),"endSeason":int(oos.season.max()),"n":int(len(oos))},
      "baseline":base,"challenger":chal,"deltas":deltas,"segments":segments,"folds":folds,
      "personnelFeatures":{"margin":MARGIN_PERSONNEL,"total":TOTAL_PERSONNEL},
      "promotionEvidencePass":bool(pass_core),
      "promotionRule":"Research pass requires lower margin MAE, non-worse total MAE, and non-worse Brier on the common OOS sample. Production promotion still requires prospective stability.",
      "economicNotes":{
        "roiAssumption":"Fixed 1u risk at -110 for model-implied probability >=55% or <=45%; closing line used only for grading, never as a model feature.",
        "clv":"UNAVAILABLE_IN_THIS_RETROSPECTIVE_DATASET: only canonical closing lines are present; no executable earlier timestamped line is being mislabeled as CLV.",
      },
      "governance":{
        "marketInformed":False,"travelIncluded":False,"scheduleStressIncluded":False,"coachingIncluded":False,
        "officialInjuryHistoricalSource":"nflverse injury reports","snapSource":"nflverse PFR snap counts",
        "currentGameSnapLeakage":False,
      }
    }
    REPORT_FILE.write_text(json.dumps(report,indent=2))
    FOLDS_FILE.write_text(json.dumps(folds,indent=2))
    oos.to_csv(OOS_FILE,index=False)
    print(json.dumps(report,indent=2))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=["features","evaluate","all"],default="all")
    args=p.parse_args()
    if args.mode in ("features","all"):build_features()
    if args.mode in ("evaluate","all"):evaluate()

if __name__=="__main__":
    main()
