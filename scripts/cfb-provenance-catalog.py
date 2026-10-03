#!/usr/bin/env python3
"""Build a provenance/temporal catalog for the CFB research warehouse."""
from pathlib import Path
import argparse, hashlib, json, re
from datetime import datetime, timezone
import pandas as pd

MARKET=re.compile(r"(market|odds|spread|moneyline|over_under|total_line|betting|implied)",re.I)
POST=re.compile(r"(final|score|points_for|points_against|result|winner|ats_margin|margin_vs_market)",re.I)
WEEKLY=re.compile(r"(weekly|through_week|fpi|rating|ppa|advanced|success|explos|havoc|pace)",re.I)
PRIOR=re.compile(r"(talent|recruit|returning|coach|roster|portal|transfer)",re.I)

def sha(p):
 h=hashlib.sha256()
 with open(p,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
 return h.hexdigest()

def classify(name,path):
 s=f"{path} {name}"
 if MARKET.search(s): return "MARKET_EVAL_ONLY","EVALUATION_ONLY"
 if POST.search(name): return "POSTGAME_ONLY","PROHIBITED"
 if WEEKLY.search(s): return "WEEK_FILTERED","INDEPENDENT_ALLOWED"
 if PRIOR.search(s): return "PRIOR_ONLY","PRIOR_ONLY"
 return "UNKNOWN","UNKNOWN"

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--root",default="artifacts/cfb-history-v2");ap.add_argument("--out",default="artifacts/cfb-final/provenance-catalog.json");a=ap.parse_args()
 root=Path(a.root); tables=[]; fields=[]
 for p in sorted(root.rglob("*.parquet")):
  try:
   df=pd.read_parquet(p)
  except Exception as e:
   tables.append({"path":str(p),"readError":str(e)});continue
  rel=str(p); tables.append({"path":rel,"rows":len(df),"columns":len(df.columns),"bytes":p.stat().st_size,"sha256":sha(p)})
  for c in df.columns:
   temporal,eligible=classify(str(c),rel)
   fields.append({"table":rel,"field":str(c),"dtype":str(df[c].dtype),"nonNull":int(df[c].notna().sum()),"temporalClass":temporal,"modelEligibility":eligible})
 out={"generatedAt":datetime.now(timezone.utc).isoformat(),"tables":tables,"fields":fields,
      "policy":"UNKNOWN fields are retained but fail closed for model eligibility until explicitly classified."}
 Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(out,indent=2))
 print(json.dumps({"tables":len(tables),"fields":len(fields),"unknownFields":sum(x["modelEligibility"]=="UNKNOWN" for x in fields)},indent=2))
if __name__=="__main__":main()
