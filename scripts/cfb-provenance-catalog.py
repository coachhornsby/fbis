#!/usr/bin/env python3
"""Build a provenance/temporal catalog for the complete CFB research warehouse."""
from pathlib import Path
import argparse, hashlib, json, re
from datetime import datetime, timezone
import pandas as pd

MARKET=re.compile(r"(market|odds|spread|moneyline|over_under|total_line|betting|implied)",re.I)
POST=re.compile(r"(final|score|points_for|points_against|result|winner|ats_margin|margin_vs_market|postgame)",re.I)
WEEKLY=re.compile(r"(weekly|through_week|fpi|rating|ppa|advanced|success|explos|havoc|pace|pregame)",re.I)
PRIOR=re.compile(r"(talent|recruit|returning|coach|roster|portal|transfer|conference|classification)",re.I)

DEFAULT_ROOTS=[
    "artifacts/cfb-history-v2",
    "artifacts/cfb-context",
    "artifacts/cfb-conference",
    "artifacts/cfb-final",
]

def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):
            h.update(b)
    return h.hexdigest()

def classify(name,path):
    s=f"{path} {name}"
    if MARKET.search(s):
        return "MARKET_EVAL_ONLY","EVALUATION_ONLY"
    if POST.search(name):
        return "POSTGAME_ONLY","PROHIBITED"
    if WEEKLY.search(s):
        return "WEEK_FILTERED","INDEPENDENT_ALLOWED"
    if PRIOR.search(s):
        return "PRIOR_ONLY","PRIOR_ONLY"
    return "UNKNOWN","UNKNOWN"

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",action="append",dest="roots")
    ap.add_argument("--out",default="artifacts/cfb-final/provenance-catalog.json")
    a=ap.parse_args()
    roots=[Path(x) for x in (a.roots or DEFAULT_ROOTS)]
    tables=[]; fields=[]; seen=set()
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*.parquet")):
            rp=str(p)
            if rp in seen:
                continue
            seen.add(rp)
            try:
                df=pd.read_parquet(p)
            except Exception as e:
                tables.append({"path":rp,"readError":str(e)})
                continue
            tables.append({"path":rp,"rows":len(df),"columns":len(df.columns),"bytes":p.stat().st_size,"sha256":sha(p)})
            for c in df.columns:
                temporal,eligible=classify(str(c),rp)
                fields.append({
                    "table":rp,"field":str(c),"dtype":str(df[c].dtype),
                    "nonNull":int(df[c].notna().sum()),
                    "temporalClass":temporal,"modelEligibility":eligible,
                })
    out={
        "generatedAt":datetime.now(timezone.utc).isoformat(),
        "roots":[str(x) for x in roots],
        "tables":tables,
        "fields":fields,
        "policy":"All fields are retained. UNKNOWN fields fail closed for model eligibility until explicitly classified; MARKET_EVAL_ONLY and POSTGAME_ONLY are never independent model inputs.",
    }
    dest=Path(a.out);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,indent=2))
    print(json.dumps({
        "tables":len(tables),
        "fields":len(fields),
        "unknownFields":sum(x["modelEligibility"]=="UNKNOWN" for x in fields),
        "marketEvalFields":sum(x["modelEligibility"]=="EVALUATION_ONLY" for x in fields),
        "prohibitedFields":sum(x["modelEligibility"]=="PROHIBITED" for x in fields),
    },indent=2))

if __name__=="__main__":
    main()
