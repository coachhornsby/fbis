#!/usr/bin/env python3
"""Fixed-penalty chronological SDV challenger. Retrospective reconstruction only."""
import argparse,csv,json,pathlib,hashlib,datetime,numpy as np
META={'team_id','pos_team','division','conference','season','through_week'}
def rows(path):
 with open(path,newline='') as f:return list(csv.DictReader(f))
def number(value):
 try:x=float(value);return x if np.isfinite(x) else np.nan
 except (TypeError,ValueError):return np.nan
def verified(root,family):
 m=json.loads((root/'coverage-manifest.json').read_text());r=next(x for x in m['datasets'] if x['family']==family)
 if r['status']!='AVAILABLE':raise ValueError('Missing input')
 p=root/r['file']
 if hashlib.sha256(p.read_bytes()).hexdigest()!=r['sha256']:raise ValueError('Source hash mismatch')
 return rows(p),r

def dataset(roots):
 datasets=[];receipts=[];fields=None
 for root in roots:
  teams,t=verified(root,'team_summaries_weekly');games,g=verified(root,'schedules');receipts.extend([t,g])
  season=int(t['file'].split('_')[-1].split('.')[0]);lookup={}
  for r in teams:
   if r.get('division','').lower()!='fbs':continue
   key=(r['team_id'],int(r['through_week']))
   if key in lookup:raise ValueError('Duplicate team/week identity')
   lookup[key]=r
  available=set(teams[0])-META
  available={k for k in available if not k.endswith('_rank') and not k.endswith('_conf_pct')}
  fields=available if fields is None else fields&available
  for game in games:
   if game['status'] not in ('STATUS_FINAL','STATUS_FINAL_OVERTIME') or game['season_type']!='2':continue
   week=int(game['week']);h=lookup.get((game['home_id'],week-1));a=lookup.get((game['away_id'],week-1))
   if not h or not a or number(h.get('valid_games'))<1 or number(a.get('valid_games'))<1:continue
   hp,ap=number(game['home_score']),number(game['away_score'])
   if not np.isfinite(hp+ap):continue
   datasets.append({'id':game['game_id'],'season':season,'week':week,'start':game['game_date'],'home':h,'away':a,'margin':hp-ap,'total':hp+ap,'neutral':game['neutral_site']=='true','source_through_week':week-1})
 return datasets,sorted(fields),receipts

def design(data,fields):
 result=[]
 for row in data:
  h=np.array([number(row['home'].get(k)) for k in fields]);a=np.array([number(row['away'].get(k)) for k in fields]);result.append(np.concatenate([h-a,h+a,[not row['neutral']]]))
 return np.array(result,dtype=float)
def fit_predict(x,y,z,penalty=100):
 # Training-only imputation, scaling and missingness indicators. No test means/tuning.
 count=np.isfinite(x).sum(axis=0);means=np.divide(np.nansum(x,axis=0),count,out=np.zeros(x.shape[1]),where=count>0)
 train=np.where(np.isfinite(x),x,means);test=np.where(np.isfinite(z),z,means)
 scale=train.std(axis=0);scale[scale<1e-8]=1
 train=np.concatenate([(train-means)/scale,~np.isfinite(x)],axis=1);test=np.concatenate([(test-means)/scale,~np.isfinite(z)],axis=1)
 keep=train.std(axis=0)>1e-8;train=train[:,keep];test=test[:,keep]
 target=y.mean(axis=0);beta=np.linalg.solve(train.T@train+penalty*np.eye(train.shape[1]),train.T@(y-target));return test@beta+target,int(keep.sum())
def metrics(pred,y):
 error=pred-y;return {'games':len(y),'marginMAE':float(np.abs(error[:,0]).mean()),'marginRMSE':float(np.sqrt((error[:,0]**2).mean())),'totalMAE':float(np.abs(error[:,1]).mean()),'totalRMSE':float(np.sqrt((error[:,1]**2).mean()))}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input-prefix',default='/tmp/cfb-sdv-history-');p.add_argument('--output',required=True);args=p.parse_args()
 data,fields,receipts=dataset([pathlib.Path(args.input_prefix+str(s)) for s in range(2022,2026)])
 report={'version':'cfb-sdv-all-stat-ridge-v1','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidenceClass':'RETROSPECTIVE_WEEKLY_RECONSTRUCTION','historicalPITQualified':False,'productionChanged':False,'canQualify':False,'canAuthorizeWager':False,'economicMetrics':None,'fixedRidgePenalty':100,'sourcePolicy':'Use only prior-week SDV cumulative rows. Acquisition times are current, not historical. No contemporary prices or prospective economics are implied.','fields':fields,'sourceReceipts':[{'url':r['url'],'sha256':r['sha256'],'observedAt':r['acquired_at']} for r in receipts],'folds':[]}
 baseline=[k for k in ['net_adj_epa','adj_off_epa','adj_def_epa','playsgame_off','pts_per_drive_off','pts_per_drive_def'] if k in fields]
 predictions=[]
 for season in [2024,2025]:
  train=[r for r in data if r['season']<season];test=[r for r in data if r['season']==season]
  if not train or not test:raise ValueError('Empty chronological cohort')
  y=np.array([[r['margin'],r['total']] for r in train]);actual=np.array([[r['margin'],r['total']] for r in test])
  pred,n=fit_predict(design(train,fields),y,design(test,fields));benchmark,_=fit_predict(design(train,baseline),y,design(test,baseline))
  report['folds'].append({'testSeason':season,'trainSeasons':sorted({r['season'] for r in train}),'trainGames':len(train),'effectiveFeatures':n,'allStats':metrics(pred,actual),'benchmark':metrics(benchmark,actual),'incumbentComparison':None})
  predictions.extend({'gameId':r['id'],'season':season,'kickoff':r['start'],'sourceThroughWeek':r['source_through_week'],'gameWeek':r['week'],'margin':float(v[0]),'total':float(v[1]),'actualMargin':r['margin'],'actualTotal':r['total'],'evidenceClass':report['evidenceClass']} for r,v in zip(test,pred))
 out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True);(out/'validation.json').write_text(json.dumps(report,indent=2)+'\n');(out/'retrospective-predictions.jsonl').write_text('\n'.join(json.dumps(x) for x in predictions)+'\n');print(json.dumps(report['folds']))
