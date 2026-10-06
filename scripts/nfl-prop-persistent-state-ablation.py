#!/usr/bin/env python3
"""Walk-forward NFL player-prop persistent-state ablation.

Baseline: existing NFL-PLAYER-PROJ-v3 historical PrizePicks reconstruction.
Challenger: baseline projection with ONLY pre-line availability/practice state
and strictly prior-game snap-role state.

The correction strength is selected on prior chronological folds only.
No current-game snaps, final game status published after the line observation,
or market line is used as a projection input.
"""
from __future__ import annotations
import importlib.util, io, json, math, re, unicodedata
from pathlib import Path
from urllib.request import Request,urlopen
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss,log_loss

ROOT=Path("artifacts/nfl-prop-persistent-state")
ROOT.mkdir(parents=True,exist_ok=True)
BASE_PATH=Path("scripts/nfl-prizepicks-history-backtest.py")
WEIGHTS=[0.0,.25,.50,.75,1.0]
SNAP_URL="https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv"
INJ_URL="https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"
TEAM_MAP={"JAC":"JAX","LA":"LAR","OAK":"LV","WSH":"WAS","SD":"LAC","STL":"LAR"}

def load_base():
    spec=importlib.util.spec_from_file_location("ppbase",BASE_PATH)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    if not mod.MIRROR_DIR.exists():
        raise RuntimeError(f"PrizePicks mirror missing: {mod.MIRROR_DIR}")
    lines,commits,failures=mod.extract_snapshots()
    games=mod.load_games();lines=mod.attach_game_keys(lines,games)
    stats,status=mod.load_stats();proj=mod.build_projection_table(stats)
    joined=mod.join_and_grade(lines,proj)
    return mod,joined,{"commits":commits,"failures":failures,"status":status}

def read_csv(url):
    req=Request(url,headers={"User-Agent":"FBIS-NFL-Prop-Persistent/1.0"})
    with urlopen(req,timeout=45) as r:return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def norm_team(v):
    s=str(v or "").upper().strip();return TEAM_MAP.get(s,s)

def norm_name(v):
    s=unicodedata.normalize("NFKD",str(v or "")).encode("ascii","ignore").decode("ascii").lower()
    s=re.sub(r"[^a-z0-9]+"," ",s).strip()
    for suf in (" jr"," sr"," ii"," iii"," iv"," v"):
        if s.endswith(suf):s=s[:-len(suf)].strip()
    return s

def health_factor(report,practice):
    r=str(report or "").upper();p=str(practice or "").upper()
    if "OUT" in r:return .55,"OUT"
    if "DOUBT" in r:return .78,"DOUBTFUL"
    if "QUESTION" in r:return .93,"QUESTIONABLE"
    if "DID NOT" in p or re.search(r"\bDNP\b",p):return .88,"DNP"
    if "LIMIT" in p:return .96,"LIMITED"
    return 1.0,"CLEAR"

def load_personnel(seasons):
    snaps=[];inj=[]
    for s in seasons:
        try:
            d=read_csv(SNAP_URL.format(season=s));d["season"]=pd.to_numeric(d.get("season",s),errors="coerce").fillna(s).astype(int);snaps.append(d)
        except Exception as e:print(f"snap {s} failed: {e}",flush=True)
        try:
            d=read_csv(INJ_URL.format(season=s));d["season"]=pd.to_numeric(d.get("season",s),errors="coerce").fillna(s).astype(int);inj.append(d)
        except Exception as e:print(f"injury {s} failed: {e}",flush=True)
    if not snaps:raise RuntimeError("No snap data")
    return pd.concat(snaps,ignore_index=True,sort=False),pd.concat(inj,ignore_index=True,sort=False) if inj else pd.DataFrame()

def build_prior_snap(snaps):
    x=snaps.copy()
    x["week"]=pd.to_numeric(x.get("week"),errors="coerce");x=x[x.week.notna()].copy()
    x["team"]=x["team"].map(norm_team);x["player_key"]=x["player"].map(norm_name)
    x["pos"]=x["position"].astype(str).str.upper()
    x["ord"]=x.season.astype(int)*100+x.week.astype(int)
    off=pd.to_numeric(x.get("offense_pct"),errors="coerce").fillna(0);deff=pd.to_numeric(x.get("defense_pct"),errors="coerce").fillna(0)
    off=np.where(off>1.5,off/100,off);deff=np.where(deff>1.5,deff/100,deff)
    x["snap_pct"]=np.where(x.pos.isin(["QB","RB","FB","WR","TE","T","OT","G","OG","C","OL"]),off,deff)
    x=x.sort_values(["player_key","team","ord"])
    x["prior_snap"]=x.groupby(["player_key","team"],sort=False)["snap_pct"].transform(lambda z:z.shift(1).rolling(5,min_periods=1).mean())
    return x.groupby(["season","week","team","player_key"],as_index=False).agg(prior_snap=("prior_snap","last"),snap_pos=("pos","last"))

def prepare_injuries(inj):
    if inj.empty:return inj
    x=inj.copy();x["week"]=pd.to_numeric(x.get("week"),errors="coerce");x=x[x.week.notna()].copy()
    x["team"]=x["team"].map(norm_team);x["player_key"]=x["full_name"].map(norm_name)
    # Timestamp is required for strict pre-line injury evidence. Rows without it
    # remain unavailable to the challenger instead of being treated as known.
    tscol=next((c for c in ["date_modified","report_date","date"] if c in x.columns),None)
    if tscol is None:
        x["evidence_ts"]=pd.NaT
    else:
        x["evidence_ts"]=pd.to_datetime(x[tscol],errors="coerce",utc=True)
    return x.sort_values(["season","week","team","player_key","evidence_ts"])

def attach_state(j,snap,inj):
    d=j.copy()
    d["season"]=pd.to_numeric(d.season,errors="coerce").astype("Int64")
    d["week"]=pd.to_numeric(d.week,errors="coerce").astype("Int64")
    d["team"]=d.team.map(norm_team);d["player_key"]=d.player_key.map(norm_name)
    d["line_ts"]=pd.to_datetime(d.provider_fetched_at,errors="coerce",utc=True)
    d=d.merge(snap,on=["season","week","team","player_key"],how="left")
    # Per line, use only the latest injury observation timestamp <= line timestamp.
    inj_groups={(int(s),int(w),t,p):g for (s,w,t,p),g in inj.groupby(["season","week","team","player_key"],sort=False)} if len(inj) else {}
    reports=[];practices=[];its=[]
    for r in d.itertuples(index=False):
        g=inj_groups.get((int(r.season),int(r.week),r.team,r.player_key)) if pd.notna(r.season) and pd.notna(r.week) else None
        if g is None or pd.isna(r.line_ts):
            reports.append(None);practices.append(None);its.append(pd.NaT);continue
        z=g[g.evidence_ts.notna() & (g.evidence_ts<=r.line_ts)]
        if z.empty:
            reports.append(None);practices.append(None);its.append(pd.NaT);continue
        q=z.iloc[-1];reports.append(q.get("report_status"));practices.append(q.get("practice_status"));its.append(q.get("evidence_ts"))
    d["report_status_preline"]=reports;d["practice_status_preline"]=practices;d["injury_evidence_ts"]=its
    factors=[health_factor(a,b) for a,b in zip(d.report_status_preline,d.practice_status_preline)]
    d["health_factor"]=[a for a,b in factors];d["health_bucket"]=[b for a,b in factors]
    baseline_snap={"QB":.94,"RB":.55,"WR":.72,"TE":.68}
    expected=d.position.map(baseline_snap).fillna(.65)
    ps=pd.to_numeric(d.prior_snap,errors="coerce")
    d["snap_factor"]=(ps/expected).clip(.78,1.12).fillna(1.0)
    d["raw_state_factor"]=(d.health_factor*d.snap_factor).clip(.60,1.12)
    d["state_available"]=((d.prior_snap.notna())|(d.injury_evidence_ts.notna())).astype(int)
    return d

def add_candidate(d,w):
    z=d.copy()
    z["chall_projection"]=np.maximum(0,pd.to_numeric(z.projection,errors="coerce")*(1+w*(z.raw_state_factor-1)))
    z["chall_edge"]=z.chall_projection-pd.to_numeric(z.line,errors="coerce")
    z["chall_side"]=np.where(z.chall_edge>0,"MORE",np.where(z.chall_edge<0,"LESS","PASS"))
    z["chall_hit"]=np.where(z.result_side.eq("PUSH"),np.nan,(z.chall_side==z.result_side).astype(float))
    z["chall_abs_z"]=np.where(pd.to_numeric(z.sigma,errors="coerce")>0,np.abs(z.chall_edge/pd.to_numeric(z.sigma,errors="coerce")),np.nan)
    return z

def prob_metrics(z,edge_col):
    sig=pd.to_numeric(z.sigma,errors="coerce");edge=pd.to_numeric(z[edge_col],errors="coerce")
    ok=sig.gt(0)&edge.notna()&z.result_side.ne("PUSH")
    if ok.sum()<10:return {"n":int(ok.sum()),"brier":None,"logLoss":None}
    p=1/(1+np.exp(-1.702*(edge[ok]/sig[ok])))
    y=(z.loc[ok].result_side=="MORE").astype(int)
    return {"n":int(ok.sum()),"brier":float(brier_score_loss(y,p)),"logLoss":float(log_loss(y,np.clip(p,.01,.99),labels=[0,1]))}

def score(z,side_col,hit_col,edge_col):
    graded=z[z[hit_col].notna() & z[side_col].ne("PASS")].copy()
    mae=float(np.mean(np.abs(pd.to_numeric(graded.actual,errors="coerce")-pd.to_numeric(graded["chall_projection" if "chall" in hit_col else "projection"],errors="coerce"))))
    pm=prob_metrics(graded,edge_col)
    cuts={}
    for cut in [.5,.75,1.0,1.25]:
        zz=graded[pd.to_numeric(graded["chall_abs_z" if "chall" in hit_col else "abs_z"],errors="coerce")>=cut]
        cuts[str(cut)]={"n":int(len(zz)),"hitRate":float(zz[hit_col].mean()) if len(zz) else None}
    return {"n":int(len(graded)),"hitRate":float(graded[hit_col].mean()) if len(graded) else None,"projectionMae":mae,"probability":pm,"zCuts":cuts}

def main():
    mod,j,source=load_base()
    if j.empty:raise RuntimeError("No joined historical prop rows")
    seasons=sorted(set(int(x) for x in j.season.dropna().unique()))
    # Prior season is needed for opening-week snap role.
    personnel_seasons=sorted(set([min(seasons)-1]+seasons))
    snaps,inj=load_personnel(personnel_seasons)
    snap=build_prior_snap(snaps);inj=prepare_injuries(inj)
    d=attach_state(j,snap,inj)
    d["ord"]=d.season.astype(int)*100+d.week.astype(int)
    ords=sorted(int(x) for x in d.ord.dropna().unique())
    rows=[];folds=[]
    for o in ords:
        tr=d[d.ord<o].copy();te=d[d.ord==o].copy()
        if len(tr)<100 or len(te)<5:continue
        scored=[]
        for w in WEIGHTS:
            z=add_candidate(tr,w)
            s=score(z,"chall_side","chall_hit","chall_edge")
            # Objective uses projection accuracy + probability calibration; hit rate
            # is reported but not directly optimized to reduce threshold overfit.
            if s["probability"]["brier"] is None:continue
            norm_mae=np.mean(np.abs((pd.to_numeric(z.actual,errors="coerce")-z.chall_projection)/pd.to_numeric(z.sigma,errors="coerce").replace(0,np.nan)))
            obj=float(np.nanmean(norm_mae))+2*s["probability"]["brier"]
            scored.append((obj,w,s))
        if not scored:continue
        _,w,_=min(scored,key=lambda x:x[0])
        z=add_candidate(te,w);z["selected_weight"]=w;rows.append(z)
        folds.append({"ordinal":o,"season":int(te.season.iloc[0]),"week":int(te.week.iloc[0]),"n":int(len(te)),"selectedWeight":w})
    oos=pd.concat(rows,ignore_index=True)
    base=score(oos,"model_side","hit","edge")
    chal=score(oos,"chall_side","chall_hit","chall_edge")
    state=oos[oos.state_available.eq(1)]
    base_state=score(state,"model_side","hit","edge") if len(state) else {}
    chal_state=score(state,"chall_side","chall_hit","chall_edge") if len(state) else {}
    markets={}
    for m,g in oos.groupby("market"):
        if len(g)<20:continue
        markets[m]={"n":int(len(g)),"baseline":score(g,"model_side","hit","edge"),"challenger":score(g,"chall_side","chall_hit","chall_edge")}
    report={
      "experiment":"NFL player props persistent availability + lagged snap-role ablation",
      "baselineModel":"NFL-PLAYER-PROJ-v3 historical reconstruction",
      "sample":{"n":int(len(oos)),"startOrdinal":int(oos.ord.min()),"endOrdinal":int(oos.ord.max())},
      "stateCoverage":{"n":int(len(state)),"rate":float(len(state)/len(oos)) if len(oos) else 0,"preLineInjuryEvidence":int(oos.injury_evidence_ts.notna().sum()),"priorSnap":int(oos.prior_snap.notna().sum())},
      "baseline":base,"challenger":chal,
      "delta":{"hitRate":(chal["hitRate"] or 0)-(base["hitRate"] or 0),"projectionMae":chal["projectionMae"]-base["projectionMae"],"brier":(chal["probability"]["brier"] or 0)-(base["probability"]["brier"] or 0)},
      "stateAvailableSubset":{"baseline":base_state,"challenger":chal_state},
      "markets":markets,"folds":folds,
      "promotionEvidencePass":bool(chal["projectionMae"]<base["projectionMae"] and (chal["probability"]["brier"] or 1)<=(base["probability"]["brier"] or 1) and (chal["hitRate"] or 0)>=(base["hitRate"] or 0)),
      "temporalIntegrity":"Snap role uses only prior games. Injury/practice evidence is accepted only when its source timestamp is <= the historical PrizePicks line observation.",
      "marketInformedProjection":False,
      "roiCaveat":"This is per-prop directional validation against historical standard PrizePicks lines, not reconstructed slip ROI."
    }
    (ROOT/"report.json").write_text(json.dumps(report,indent=2))
    oos.to_csv(ROOT/"oos-props.csv",index=False)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
