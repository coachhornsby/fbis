"""Offline private research staging. No HTTP, D1, model writes or wager authority.

Run after archive verification and identity-registry export. Provider positional
columns retain source provenance; identity candidates never become verified IDs.
"""
import collections,csv,datetime,gzip,hashlib,json,pathlib,re,sys,unicodedata

def name_key(value):
    # Preserve suffixes; do not collapse Jr/Sr or use fuzzy/initial matching.
    text=unicodedata.normalize('NFKD',str(value)).encode('ascii','ignore').decode().casefold()
    return re.sub(r'[^a-z0-9]+',' ',text).strip()

def add_name(index,name,canonical):
    if name:index[name_key(name)].add(canonical)

def resolve(index,name):
    matches=index.get(name_key(name),set())
    return next(iter(matches)) if len(matches)==1 else None

def player_candidates(current,previous):
    by_name=collections.defaultdict(set)
    for p in previous:by_name[name_key(p['name'])].add(p['torvikPlayerId'])
    counts=collections.Counter(name_key(p['name'])for p in current)
    result=[]
    for p in current:
        ids=by_name.get(name_key(p['name']),set())
        state='UNIQUE_NAME_CANDIDATE' if len(ids)==1 and counts[name_key(p['name'])]==1 else 'AMBIGUOUS_NAME' if ids else 'NO_PRIOR_NAME_MATCH'
        result.append({**p,'torvikPlayerIdCandidate':next(iter(ids)) if state=='UNIQUE_NAME_CANDIDATE' else None,'identityState':state,'verifiedPlayerIdentity':False,'availability':'UNKNOWN','expectedMinutes':None,'productionAdjustment':None})
    return result

def validate_player_games(rows):
    seen=set()
    for x in rows:
        if len(x)!=53 or x[52]!=2026:raise ValueError('PLAYER_GAME_SCHEMA_OR_SEASON')
        key=(x[51],x[6])
        if key in seen:raise ValueError('DUPLICATE_PLAYER_GAME')
        seen.add(key)
        date=datetime.datetime.strptime(x[0],'%Y%m%d').date()
        if not(datetime.date(2025,7,1)<=date<datetime.date(2026,7,1)):raise ValueError('PLAYER_GAME_DATE')
        if abs(2*x[23]+3*x[25]+x[27]-x[33])>0.001:raise ValueError('SCORING_IDENTITY')
    return True

def run(root):
    root=pathlib.Path(root);raw=root/'restored/raw_torvik';output=root/'staged';output.mkdir(exist_ok=True)
    registry=json.loads((root/'identity-registry.json').read_text());index=collections.defaultdict(set)
    for t in registry['teams']:
        for n in [t.get('school'),t.get('displayName')]:add_name(index,n,t['id'])
        for source in t.get('sources',{}).values():
            if isinstance(source,dict):
                for n in source.get('names',[]):add_name(index,n,t['id'])
    for n,espn in registry['aliases'].items():add_name(index,n,'cbb-'+espn)
    # Existing verified current provider crosswalks, not guessed fuzzy matches.
    mission=root.parent/'cbb-provider-mission'
    for f in ['normalized-provider-inputs.json','torvik-current-provider-inputs.json']:
        for row in json.loads((mission/f).read_text()):
            p=json.loads(row['payload']);add_name(index,p.get('team'),row['teamId']);add_name(index,p.get('school'),row['teamId'])
    aliases=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/cbb-offseason-team-aliases.json').read_text())
    valid_ids={t['id'] for t in registry['teams']}
    for name,espn in aliases.items():
        if 'cbb-'+espn not in valid_ids:raise ValueError('ALIAS_UNKNOWN_ID')
        add_name(index,name,'cbb-'+espn)
    crosswalk={};unresolved={};contexts=[]
    for provider,file in [('teamrankings','teamrankings_betiq_2026_27.csv'),('on3','on3_transfer_rankings_2026.csv')]:
        rows=list(csv.DictReader((root/'restored/raw_offseason'/file).open()))
        for row in rows:
            name=row['team'];cid=resolve(index,name);crosswalk[provider+':'+name]=cid
            if not cid:unresolved[provider+':'+name]='UNRESOLVED_OR_AMBIGUOUS'
            contexts.append({'provider':provider,'season':2027,'teamName':name,'canonicalId':cid,'sourceFields':row,'marketIndependent':False if provider=='teamrankings' else None,'returningMinutesPct':None,'canAdjustModel':False})
    games=json.load(gzip.open(raw/'2026_all_advgames.json.gz','rt'));validate_player_games(games)
    grouped=collections.defaultdict(list)
    for x in games:grouped[(str(x[51]),x[47])].append(x)
    historical=[]
    for (pid,team),g in grouped.items():
        cid=resolve(index,team);crosswalk['torvik:'+team]=cid
        if not cid:unresolved['torvik:'+team]='UNRESOLVED_OR_AMBIGUOUS'
        historical.append({'season':2026,'torvikPlayerId':pid,'name':g[-1][48],'sourceTeam':team,'canonicalTeamId':cid,'games':len(g),'points':sum(x[33]for x in g),'twoMade':sum(x[23]for x in g),'threeMade':sum(x[25]for x in g),'freeThrowsMade':sum(x[27]for x in g),'firstGameDate':min(x[0]for x in g),'lastGameDate':max(x[0]for x in g),'usageAndMinutesState':'INFERRED_COLUMNS_NOT_PROMOTED','verifiedEspnPlayerId':None,'source':'2026_all_advgames.json.gz','schemaEvidence':'SCORING_ARITHMETIC_VALIDATED; IDENTITY_PROVIDER_SCOPED','canAdjustModel':False})
    # Validate the provider player-ID join without inventing meanings for season columns.
    seasons=list(csv.reader((raw/'2026_getadvstats.csv').open()))
    if any(len(x)!=67 or x[31]!='2026' for x in seasons):raise ValueError('PLAYER_SEASON_SCHEMA')
    prior_ids={p['torvikPlayerId']for p in historical};season_ids={x[32]for x in seasons}
    current=[]
    for r in json.loads((root.parent/'cbb-current-2027/current-inputs.json').read_text()):
        p=json.loads(r['payload'])
        current.extend({'espnPlayerId':x['id'],'canonicalTeamId':r['teamId'],'name':x['name']}for x in p['players'])
    candidates=player_candidates(current,historical)
    # Independent verification of Grok's schedule receipt against our frozen packet.
    recon=list(csv.DictReader((root/'restored/evidence/cbb_nov2_slate_reconciliation_torvik_vs_espn.csv').open()))
    packet=json.loads((root.parent/'cbb-projection-phase/private-projections.json').read_text());events={str(x['eventId']):x for x in packet['events']}
    matched=[x for x in recon if x['status']=='MATCHED'];ids=[x['espn_event_id']for x in matched]
    if len(ids)!=len(set(ids)) or set(ids)!=set(events):raise ValueError('RECON_EVENT_IDS')
    for x in matched:
        e=events[x['espn_event_id']]
        if x['espn_away']!=e['awayName'] or x['espn_home']!=e['homeName'] or x['espn_central_date']!=e['date']:raise ValueError('RECON_IDENTITY')
        if (x['espn_neutral']=='True')!=e['neutralSite'] or x['neutral_agree']!='Y':raise ValueError('RECON_VENUE')
        if datetime.datetime.fromisoformat(x['espn_start_utc'].replace('Z','+00:00'))!=datetime.datetime.fromisoformat(e['start'].replace('Z','+00:00')):raise ValueError('RECON_START')
    summary={'archiveFilesVerified':sum(x['files']for x in json.loads((root/'archive-verification.json').read_text())),'historicalPlayerGames':len(games),'uniquePriorPlayerIds':len(prior_ids),'historicalPlayerTeamGroups':len(historical),'playerSeasonRows':len(seasons),'priorIdsWithoutSeasonRow':len(prior_ids-season_ids),'seasonIdsWithoutPlayerGames':len(season_ids-prior_ids),'currentRosterRecords':len(current),'candidateStates':dict(collections.Counter(x['identityState']for x in candidates)),'contextRows':len(contexts),'teamCrosswalkResolved':sum(v is not None for v in crosswalk.values()),'teamCrosswalkUnresolved':len(unresolved),'reconciledEspnEvents':len(matched),'extraTorvikEvents':[x['torvik_matchup']for x in recon if x['status']!='MATCHED'],'modelChanges':0,'remoteRequests':0,'canAuthorizeWager':False}
    for file,obj in [('historical-player-production.json',historical),('current-roster-history-candidates.json',candidates),('offseason-context.json',contexts),('team-crosswalk.json',crosswalk),('unresolved-team-identities.json',unresolved),('receipt.json',summary)]:
        (output/file).write_text(json.dumps(obj,indent=2))
    return summary
if __name__=='__main__':print(json.dumps(run(sys.argv[1]if len(sys.argv)>1 else 'artifacts/cbb-grok-integration'),indent=2))
