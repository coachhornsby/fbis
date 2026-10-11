#!/usr/bin/env python3
"""Predeclared score-only opponent-adjusted challenger; retrospective research.
Monthly walk-forward fits strictly earlier games. Source acquisition times absent:
this is NOT historical PIT or prospective economic qualification. No markets in fit.
"""
import argparse,csv,hashlib,json,math,pathlib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.linear_model import Ridge

from cfb_final_status import final_mask

VERSION='CFB-SCORE-STATE-RESEARCH-v1'
ALPHA=20.0
HALF_LIFE_DAYS=365.0

def design(rows,teams):
 index={t:i for i,t in enumerate(teams)};n=len(teams);ri=[];ci=[];data=[]
 for j,row in enumerate(rows.itertuples()):
  for side,off,defense in [(0,row.home_id,row.away_id),(1,row.away_id,row.home_id)]:
   if off in index:ri.append(2*j+side);ci.append(index[off]);data.append(1.)
   if defense in index:ri.append(2*j+side);ci.append(n+index[defense]);data.append(1.)
   if side==0 and not row.neutral_site:ri.append(2*j);ci.append(2*n);data.append(1.)
 return csr_matrix((data,(ri,ci)),shape=(2*len(rows),2*n+1))

def evaluate(rows):
 if not rows:return None
 d=pd.DataFrame(rows);pm=d.pred_home-d.pred_away;pt=d.pred_home+d.pred_away
 y=d.home_score-d.away_score;t=d.home_score+d.away_score;p=np.clip(d.home_win_probability,1e-5,1-1e-5);winner=(y>0).astype(float)
 return {'n':len(d),'margin_mae':float(np.mean(abs(pm-y))),'margin_rmse':float(np.sqrt(np.mean((pm-y)**2))),
  'total_mae':float(np.mean(abs(pt-t))),'total_rmse':float(np.sqrt(np.mean((pt-t)**2))),
  'brier':float(np.mean((p-winner)**2)),'log_loss':float(np.mean(-winner*np.log(p)-(1-winner)*np.log(1-p))),
  'margin_80_coverage':float(np.mean((y>=d.margin_lo80)&(y<=d.margin_hi80))),
  'margin_95_coverage':float(np.mean((y>=d.margin_lo95)&(y<=d.margin_hi95))),
  'total_80_coverage':float(np.mean((t>=d.total_lo80)&(t<=d.total_hi80))),
  'total_95_coverage':float(np.mean((t>=d.total_lo95)&(t<=d.total_hi95)))}

def main(args):
 columns=['game_id','season','game_date','home_id','away_id','home_score','away_score','neutral_site','benchmark_home_spread','benchmark_total','status']
 d=pd.read_csv(args.data,usecols=columns,dtype={'game_id':str,'home_id':str,'away_id':str})
 excluded_status_counts=d.loc[~final_mask(d),"status"].value_counts().to_dict()
 source_rows=len(d)
 d=d[final_mask(d)].copy()
 d.game_date=pd.to_datetime(d.game_date,utc=True)
 if d.game_id.duplicated().any():raise ValueError('duplicate game identities')
 if d[['game_date','home_id','away_id','home_score','away_score']].isna().any().any():raise ValueError('missing required source facts')
 if (d.home_id==d.away_id).any():raise ValueError('same participants')
 d.neutral_site=d.neutral_site.astype(str).str.lower().eq('true')
 d=d.sort_values(['game_date','game_id']).reset_index(drop=True)
 d['block']=d.game_date.dt.strftime('%Y-%m')
 residuals=[];results=[];ratings=[];fits=[]
 for block,test in d[d.season>=2010].groupby('block',sort=True):
  cutoff=pd.Timestamp(block+'-01',tz='UTC');train=d[(d.game_date<cutoff)&(d.game_date>=cutoff-pd.Timedelta(days=3*366))]
  if len(train)<1000:continue
  assert train.game_date.max()<cutoff<=test.game_date.min()
  teams=sorted(set(train.home_id)|set(train.away_id));X=design(train,teams)
  y=train[['home_score','away_score']].to_numpy().reshape(-1)
  weights=np.repeat(np.exp(-math.log(2)*(cutoff-train.game_date).dt.total_seconds().to_numpy()/86400/HALF_LIFE_DAYS),2)
  model=Ridge(alpha=ALPHA,solver='lsqr').fit(X,y,sample_weight=weights)
  scores=np.clip(model.predict(design(test,teams)).reshape(-1,2),0,None)
  fits.append({'block':block,'train_n':len(train),'max_training_game_at':train.game_date.max().isoformat(),
    'hfa_points':float(model.coef_[-1]),'model_version':VERSION,'alpha':ALPHA})
  available=[r for r in residuals if r['at']<cutoff and r['at']>=cutoff-pd.Timedelta(days=3*366)]
  for (row,hs),a_s in zip(zip(test.itertuples(),scores[:,0]),scores[:,1]):
   margin=float(hs-a_s);total=float(hs+a_s)
   # Calibrate using earlier *out-of-sample* paired score residuals only.
   bucket=lambda m,t:(abs(m)>=14,int(t//20))
   local=[r for r in available if bucket(r['margin'],r['total'])==bucket(margin,total)]
   calibration=local if len(local)>=100 else available
   if len(calibration)<100:continue
   sample=np.array([[hs+r['home_error'],a_s+r['away_error']] for r in calibration]);sample=np.clip(sample,0,None)
   sm=sample[:,0]-sample[:,1];st=sample.sum(axis=1)
   quant=lambda values,q:float(np.quantile(values,q))
   rec={'game_id':row.game_id,'season':int(row.season),'game_at':row.game_date.isoformat(),'cutoff':cutoff.isoformat(),
    'home_id':row.home_id,'away_id':row.away_id,'home_score':float(row.home_score),'away_score':float(row.away_score),
    'pred_home':float(hs),'pred_away':float(a_s),'home_win_probability':float(((sm>0).sum()+.5)/(len(sm)+1)),
    'margin_lo80':quant(sm,.1),'margin_hi80':quant(sm,.9),'margin_lo95':quant(sm,.025),'margin_hi95':quant(sm,.975),
    'total_lo80':quant(st,.1),'total_hi80':quant(st,.9),'total_lo95':quant(st,.025),'total_hi95':quant(st,.975),
    'calibration_n':len(calibration),'calibration_latest_game_at':max(r['at'] for r in calibration).isoformat(),
    'distribution':'earlier_OOS_joint_score_residuals_conditional_bucket_or_pooled',
    'model_version':VERSION,'temporal_class':'RETROSPECTIVE_SOURCE_ACQUISITION_UNVERIFIED',
    'benchmark_home_spread':None if pd.isna(row.benchmark_home_spread) else float(row.benchmark_home_spread),
    'benchmark_total':None if pd.isna(row.benchmark_total) else float(row.benchmark_total),
    'roi':None,'clv':None,'wager_authority':False,'production_authority':False}
   results.append(rec)
  # Every prediction contributes only after its block's evaluation is complete.
  for row,score in zip(test.itertuples(),scores):
   residuals.append({'at':row.game_date,'margin':float(score[0]-score[1]),'total':float(score.sum()),
      'home_error':float(row.home_score-score[0]),'away_error':float(row.away_score-score[1])})
  if block.startswith('2026'):
   ratings.append({'block':block,'hfa_points':float(model.coef_[-1]),'intercept_ppg':float(model.intercept_),
    'teams':{team:{'offense_points':float(model.coef_[i]),'defense_points_allowed':float(model.coef_[len(teams)+i]),
      'net_points':float(model.coef_[i]-model.coef_[len(teams)+i])} for i,team in enumerate(teams)}})
 evaluation=[r for r in results if r['season']>=2019]
 calibration=[]
 for low in np.arange(0,1,.1):
  group=[r for r in evaluation if low<=r['home_win_probability']<low+.1]
  if group:calibration.append({'probability_bin':round(float(low),1),'n':len(group),
    'mean_probability':float(np.mean([r['home_win_probability'] for r in group])),
    'home_win_rate':float(np.mean([r['home_score']>r['away_score'] for r in group]))})
 paired=[r for r in evaluation if r['benchmark_home_spread'] is not None and r['benchmark_total'] is not None]
 benchmark={'n':len(paired),'margin_mae':float(np.mean([abs(-r['benchmark_home_spread']-(r['home_score']-r['away_score'])) for r in paired])),
  'total_mae':float(np.mean([abs(r['benchmark_total']-(r['home_score']+r['away_score'])) for r in paired])),
  'temporal_status':'RETROSPECTIVE_BENCHMARK_TIME_UNVERIFIED','economic_qualification':False}
 report={'model_version':VERSION,'source_sha256':hashlib.sha256(pathlib.Path(args.data).read_bytes()).hexdigest(),
  'status':'RETROSPECTIVE_RESEARCH_ONLY','source_rows':source_rows,'accepted_final_rows':len(d),'excluded_status_counts':excluded_status_counts,'source_last_game':d.game_date.max().isoformat(),
  'predeclared':{'alpha':ALPHA,'half_life_days':HALF_LIFE_DAYS,'training_window_days':3*366,'test_start':2019,'fit_schedule':'monthly',
   'test_selection':'all complete archived games; FBS season-scope qualification still required'},
  'overall':evaluate(evaluation),'by_season':{str(y):evaluate([r for r in evaluation if r['season']==y]) for y in sorted(set(r['season'] for r in evaluation))},
  'paired_model':evaluate(paired),'benchmark':benchmark,'calibration':calibration,'fits':fits,
  'incumbent_comparison':None,'roi':None,'clv':None,'prospective_n':0,'production_authority':False,'wager_authority':False,
  'limitations':['Source acquisition timestamps absent: no historical PIT claim','Common venue HFA only; individual venue effects not estimated',
    'No verified injuries or player impact','No incumbent evaluation: exact original feature contract unavailable in this score dataset',
    'Archive stops before current week; partial 2026','No hyperparameter search; independent reviewer and prospective testing pending']}
 out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 (out/'team-state.json').write_text(json.dumps({'model_version':VERSION,'states':ratings,'authority':'RESEARCH_ONLY'},indent=2)+'\n')
 with (out/'predictions.jsonl').open('w') as f:
  for r in evaluation:f.write(json.dumps(r,allow_nan=False)+'\n')
 print(json.dumps({'overall':report['overall'],'paired_model':report['paired_model'],'benchmark':benchmark}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--output',required=True);main(p.parse_args())
