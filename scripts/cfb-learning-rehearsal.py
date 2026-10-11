#!/usr/bin/env python3
"""Bounded offline error findings; no model coefficient or authority writes."""
import argparse,json,pathlib,statistics
from collections import defaultdict
p=argparse.ArgumentParser();p.add_argument('--predictions',required=True);p.add_argument('--output',required=True);a=p.parse_args()
rows=[json.loads(l) for l in pathlib.Path(a.predictions).read_text().splitlines() if l]
groups=defaultdict(list)
for r in rows:
 pm=r['pred_home']-r['pred_away'];pt=r['pred_home']+r['pred_away']
 groups[('season',str(r['season']))].append((pm-(r['home_score']-r['away_score']),pt-(r['home_score']+r['away_score'])))
 groups[('predicted_margin_regime','large' if abs(pm)>=14 else 'small')].append((pm-(r['home_score']-r['away_score']),pt-(r['home_score']+r['away_score'])))
findings=[]
for (kind,name),values in sorted(groups.items()):
 if len(values)<100:continue
 findings.append({'group_kind':kind,'group':name,'n':len(values),'margin_bias':statistics.mean(v[0] for v in values),
  'total_bias':statistics.mean(v[1] for v in values),'margin_mae':statistics.mean(abs(v[0]) for v in values),
  'total_mae':statistics.mean(abs(v[1]) for v in values),'temporal_class':'RETROSPECTIVE',
  'hypothesis':'Test season transitions, sample-dependent shrinkage and forecast-regime calibration on a new frozen chronological holdout.',
  'automatic_promotion':False,'wager_authority':False})
result={'status':'RESEARCH_FINDINGS_ONLY','model_version':rows[0]['model_version'],'findings':findings,
 'platform_learning_candidates':[{'label':'PLATFORM LEARNING CANDIDATE','topic':'Explicit final-status eligibility before rolling statistics',
 'evidence':'188 cancelled/postponed CFB records had numeric scores in the prior archive',
 'independent_testing_required':'Sport-specific status contracts and suspended/forfeit tests before reuse'},
 {'label':'PLATFORM LEARNING CANDIDATE','topic':'Immutable import conflict detection',
 'evidence':'Reimport rehearsal validates exact destination contents instead of accepting row counts',
 'independent_testing_required':'Per-sport identity/version contract and concurrent correction tests'}],
 'prospective_evidence':False,'economic_evidence':None}
pathlib.Path(a.output).write_text(json.dumps(result,indent=2)+'\n')
