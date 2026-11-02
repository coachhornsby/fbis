"""Offline chronological Torvik game-feature candidate. No KenPom inputs/network/D1."""
import collections,csv,datetime,hashlib,json,math,pathlib,sys
import numpy as np
FEATURES_CORE=['home_off','away_off','home_def','away_def','home_pace','away_pace','home_court','rest_difference']
FACTOR_NAMES=['efg','tov','orb','ftr','three_rate']
FEATURES_EXTRA=[side+'_'+f for side in ['home_attack','away_attack','home_defense','away_defense'] for f in FACTOR_NAMES]+['home_recent_off_change','away_recent_off_change','home_recent_def_change','away_recent_def_change']
DEFAULT=np.array([.50,.18,.28,.30,.37])

def load_boxes(path,with_exclusions=False):
    games={};excluded=set()
    with pathlib.Path(path).open() as stream: source_rows=list(csv.reader(stream))
    for row in source_rows:
        if len(row)!=31 or row[22]!='2026':raise ValueError('GAME_SCHEMA_OR_SEASON')
        b=json.loads(row[29]);key=row[24]
        if len(b)!=38 or b[2]==b[3] or row[2] not in b[2:4]:raise ValueError('BOX_SCHEMA')
        invalid=False
        for offset in [4,19]:
            fg,fga,th,tpa,ft,fta,orb,drb,reb,ast,stl,blk,tov,pf,pts=map(float,b[offset:offset+15])
            if not all(math.isfinite(x) and x>=0 for x in [fg,fga,th,tpa,ft,fta,orb,drb,reb,ast,stl,blk,tov,pf,pts]):invalid=True
            if abs(2*fg+th+ft-pts)>1e-6 or fg>fga or th>fg or th>tpa or ft>fta or abs(orb+drb-reb)>1e-6:invalid=True
        if invalid:excluded.add(key);continue
        if float(b[34])<=0 or float(b[1])<180:raise ValueError('POSSESSION_OR_MINUTES')
        neutral=row[5]=='N'
        if row[5] not in ['H','A','N']:raise ValueError('VENUE')
        home=row[2] if row[5]=='H' else row[4] if row[5]=='A' else None
        item={'id':key,'date':datetime.datetime.strptime(b[0],'%m/%d/%y').date().isoformat(),'box':b,'home':home,'neutral':neutral}
        if key in games:
            prior=games[key]
            if prior['box']!=b or prior['home']!=home or prior['neutral']!=neutral:raise ValueError('GAME_CONFLICT')
        else:games[key]=item
    result=sorted((g for k,g in games.items() if k not in excluded),key=lambda g:(g['date'],g['id']))
    return (result,sorted(excluded)) if with_exclusions else result

def state():return {'games':[],'lastDate':None}
def box_vector(b,offset):return np.array(list(map(float,b[offset:offset+15])))
def rates(own,opp,poss):
    fga=own[1];return np.array([(own[0]+.5*own[2])/max(fga,1),own[12]/max(poss,1),own[6]/max(own[6]+opp[7],1),own[5]/max(fga,1),own[3]/max(fga,1)])
def profile(st):
    rows=st['games'];n=len(rows)
    if not n:return {'off':102.857142857,'def':102.857142857,'pace':70.,'attack':DEFAULT.copy(),'defense':DEFAULT.copy(),'recentOff':0.,'recentDef':0.}
    own=sum((r['own'] for r in rows),np.zeros(15));opp=sum((r['opp'] for r in rows),np.zeros(15));poss=sum(r['poss'] for r in rows);weight=n/(n+5)
    off=100*(own[14]+5*72)/(poss+5*70);defense=100*(opp[14]+5*72)/(poss+5*70)
    recent=rows[-5:];rp=sum(r['poss'] for r in recent)
    return {'off':off,'def':defense,'pace':(sum(r['pace'] for r in rows)+5*70)/(n+5),
      'attack':weight*rates(own,opp,poss)+(1-weight)*DEFAULT,'defense':weight*rates(opp,own,poss)+(1-weight)*DEFAULT,
      'recentOff':100*sum(r['own'][14] for r in recent)/rp-off,'recentDef':100*sum(r['opp'][14] for r in recent)/rp-defense}

def features(h,a,date,neutral):
    hp,ap=profile(h),profile(a)
    rest=lambda s:min(14,max(0,(datetime.date.fromisoformat(date)-datetime.date.fromisoformat(s['lastDate'])).days)) if s['lastDate'] else 7
    core=[hp['off'],ap['off'],hp['def'],ap['def'],hp['pace'],ap['pace'],0 if neutral else 1,rest(h)-rest(a)]
    extra=[*hp['attack'],*ap['attack'],*hp['defense'],*ap['defense'],hp['recentOff'],ap['recentOff'],hp['recentDef'],ap['recentDef']]
    return np.array(core+extra)

def update(states,g):
    b=g['box'];pos=float(b[34]);pace=pos*200/max(200.,float(b[1]))
    for team,other,o,p in [(b[2],b[3],4,19),(b[3],b[2],19,4)]:
        states[team]['games'].append({'own':box_vector(b,o),'opp':box_vector(b,p),'poss':pos,'pace':pace});states[team]['lastDate']=g['date']

def chronological_rows(games):
    states=collections.defaultdict(state);rows=[]
    # Score every game in the date batch BEFORE applying any results from that date.
    for date,batch in __import__('itertools').groupby(games,key=lambda g:g['date']):
        day=list(batch)
        for g in day:
            b=g['box'];home=g['home'] or b[3];away=b[2] if home==b[3] else b[3]
            if min(len(states[home]['games']),len(states[away]['games']))>=3:
                hs=float(b[33] if home==b[3] else b[18]);aw=float(b[18] if home==b[3] else b[33])
                rows.append({'id':g['id'],'date':date,'x':features(states[home],states[away],date,g['neutral']),'y':np.array([hs-aw,hs+aw])})
        for g in day:update(states,g)
    return rows,states

def fit(rows,nfeatures,alpha):
    x=np.array([r['x'][:nfeatures] for r in rows]);y=np.array([r['y'] for r in rows]);mean=x.mean(0);scale=x.std(0);scale[scale<1e-9]=1
    z=np.column_stack([np.ones(len(x)),(x-mean)/scale]);penalty=np.eye(z.shape[1])*alpha;penalty[0,0]=0
    coefficients=np.linalg.solve(z.T@z+penalty,z.T@y)
    return {'nfeatures':nfeatures,'alpha':alpha,'mean':mean,'scale':scale,'coefficients':coefficients}
def predict(model,x):return np.r_[1,(x[:model['nfeatures']]-model['mean'])/model['scale']]@model['coefficients']
def evaluate(model,rows):
    errors=np.array([predict(model,r['x'])-r['y'] for r in rows]);return {'games':len(rows),'marginMAE':float(np.abs(errors[:,0]).mean()),'totalMAE':float(np.abs(errors[:,1]).mean()),'marginBias':float(errors[:,0].mean()),'totalBias':float(errors[:,1].mean())}
def select(train,validation,n):
    candidates=[fit(train,n,a) for a in [1.,10.,100.]]
    return min(candidates,key=lambda m:sum(evaluate(m,validation)[k] for k in ['marginMAE','totalMAE']))

def run(root):
    root=pathlib.Path(root);root.mkdir(exist_ok=True);raw=pathlib.Path('artifacts/cbb-grok-integration/restored/raw_torvik/2026_getgamestats.csv')
    games,excluded=load_boxes(raw,True);rows,states=chronological_rows(games)
    train=[r for r in rows if r['date']<'2026-01-01'];validation=[r for r in rows if '2026-01-01'<=r['date']<'2026-02-01'];test=[r for r in rows if r['date']>='2026-02-01']
    results={};models={}
    for label,n in [('rolling_efficiency_baseline',8),('four_factors_shooting_recent_form',len(FEATURES_CORE+FEATURES_EXTRA))]:
        chosen=select(train,validation,n);model=fit(train+validation,n,chosen['alpha']);models[label]=model
        results[label]={'validationSelectedAlpha':chosen['alpha'],'validation':evaluate(chosen,validation),'heldOut':evaluate(model,test)}
    candidate=models['four_factors_shooting_recent_form'];baseline=models['rolling_efficiency_baseline']
    improved=all(results['four_factors_shooting_recent_form']['heldOut'][m]<results['rolling_efficiency_baseline']['heldOut'][m] for m in ['marginMAE','totalMAE'])
    receipt={'modelId':'FBIS-CBB-TORVIK-GAME-FEATURES-v1','status':'RESEARCH_CANDIDATE_NOT_PROMOTED','sourceSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'sourceGames':len(games),'excludedArithmeticGames':excluded,'examples':len(rows),'splitCounts':{'train':len(train),'validation':len(validation),'test':len(test)},'features':FEATURES_CORE+FEATURES_EXTRA,'results':results,'improvedBothHeldOutMAEs':improved,'kenpomFeatures':0,'marketFeatures':0,'sameDayResultsUsed':False,'rosterAdjustmentApplied':False,'limitations':['One ending-season validation only','Opening-season 2027 roster changes not validated','Rolling efficiencies are not a fully opponent-adjusted rating fit','Current CBBD roster context is coverage evidence, not an invented coefficient','Historical final scores include overtime','Venue is source-reported; neutral team order is not home advantage'],'productionChanged':False,'canAuthorizeWager':False}
    (root/'evaluation.json').write_text(json.dumps(receipt,indent=2))
    final=fit(rows,len(FEATURES_CORE+FEATURES_EXTRA),candidate['alpha']);serialized={k:v.tolist() if isinstance(v,np.ndarray) else v for k,v in final.items()};serialized['trainingCutoff']=games[-1]['date'];serialized['featureNames']=FEATURES_CORE+FEATURES_EXTRA
    (root/'candidate-model.json').write_text(json.dumps(serialized,indent=2))
    (root/'team-history-profiles.json').write_text(json.dumps({team:{k:v.tolist() if isinstance(v,np.ndarray) else v for k,v in profile(s).items()} for team,s in states.items()},indent=2))
    cross=json.loads(pathlib.Path('artifacts/cbb-grok-integration/staged/team-crosswalk.json').read_text());native={}
    for team,st in states.items():
        cid=cross.get('torvik:'+team)
        if cid:native.setdefault(cid,[]).append({'sourceTeam':team,'profile':{k:v.tolist() if isinstance(v,np.ndarray) else v for k,v in profile(st).items()}})
    cb=json.loads(pathlib.Path('artifacts/cbb-provider-mission/normalized-provider-inputs.json').read_text());cbd={r['teamId']:json.loads(r['payload']) for r in cb if r['provider']=='cbbd'}
    roster=json.loads(pathlib.Path('artifacts/cbb-roster-evidence/team-roster-evidence.json').read_text());rr={r['canonicalTeamId']:r for r in roster}
    tv=json.loads(pathlib.Path('artifacts/cbb-current-evidence/torvik-refresh/normalized-provider-inputs.json').read_text());coverage=[]
    for r in tv:
        cid=r['teamId'];coverage.append({'teamId':cid,'torvikHistoricalGameProfiles':native.get(cid,[]),'currentTorvikRatingAvailable':True,'currentCbbdRosterPlayers':len(cbd.get(cid,{}).get('players',[])),'rosterHistoryCoverage':rr.get(cid),'openingSeasonAdjustment':'NOT_VALIDATED','canAdjustProduction':False})
    (root/'current-feature-coverage.json').write_text(json.dumps(coverage,indent=2))
    return receipt
if __name__=='__main__':print(json.dumps(run(sys.argv[1] if len(sys.argv)>1 else 'artifacts/cbb-torvik-feature-model'),indent=2))
