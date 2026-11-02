"""Offline private research intake. Never executes archived code or opens a network.

Run from repo root: python scripts/cbb-research-intake.py artifacts/cbb-research-intake
Outputs are research evidence only, excluded from the public build and model inputs.
"""
import collections,csv,datetime,hashlib,io,json,math,pathlib,re,sys,tarfile
from zoneinfo import ZoneInfo

ARCHIVES={
 'markets':('b8179d5cbcc901dfa3e26b77470392c6c8a735d108b4a35216470308ee996986','FBIS_CBB_Market_Snapshots_20261102'),
 'identities':('b7d56c6660d8713abe43185db9af3e329d592b472051ed69468c2c4280fbf611','FBIS_CBB_Identity_Research_20261102')}
AUTHORITY={'canAdjustModel':False,'canAuthorizeWager':False,'publicDisplay':False}

def sha(b): return hashlib.sha256(b).hexdigest()

def verified_members(path,expected):
    data=pathlib.Path(path).read_bytes()
    if sha(data)!=expected: raise ValueError('ARCHIVE_HASH')
    files={};total=0
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            p=pathlib.PurePosixPath(member.name)
            if p.is_absolute() or '..' in p.parts or member.issym() or member.islnk():raise ValueError('ARCHIVE_PATH')
            if member.isdir():continue
            if not member.isfile() or member.name in files:raise ValueError('ARCHIVE_MEMBER')
            total+=member.size
            if total>100_000_000:raise ValueError('ARCHIVE_SIZE')
            files[member.name]=tar.extractfile(member).read()
    manifests=[n for n in files if n.endswith('/MANIFEST.sha256')]
    for name in manifests:
        parent=pathlib.PurePosixPath(name).parent;seen=set()
        for line in files[name].decode().splitlines():
            h,rel=line.split(None,1);target=str(parent/pathlib.PurePosixPath(rel.strip()))
            if target in seen or target not in files or sha(files[target])!=h:raise ValueError('MEMBER_HASH')
            seen.add(target)
        if seen!=set(files)-{name}:raise ValueError('MANIFEST_COVERAGE')
    return files,{'bytes':len(data),'sha256':expected,'files':len(files),'internalManifestVerified':bool(manifests)}

def ct_time(value):
    value=value.strip()
    if not value.endswith(' CST'):raise ValueError('SOURCE_TIMEZONE')
    s=value[:-4]
    fmt='%Y-%m-%d %H:%M:%S' if s.count(':')==2 else '%Y-%m-%d %H:%M'
    return datetime.datetime.strptime(s,fmt).replace(tzinfo=ZoneInfo('America/Chicago')).astimezone(datetime.timezone.utc).isoformat().replace('+00:00','Z')

def numeric(value,probability=False):
    if value in (None,''):return None
    n=float(value)
    if not math.isfinite(n) or n<0 or (probability and n>1):raise ValueError('INVALID_QUOTE')
    return n

def normalize_kalshi(row,source,captured,complete,raw=False):
    if not row.get('ticker') or not row['ticker'].startswith('KXNCAAMB'):raise ValueError('CONTRACT_ID')
    bid=numeric(row.get('yes_bid_dollars' if raw else 'yes_bid'),True)
    ask=numeric(row.get('yes_ask_dollars' if raw else 'yes_ask'),True)
    # Sizes belong exclusively to this raw observation, never the later CSV.
    return {**AUTHORITY,'venue':'KALSHI','contractId':row['ticker'],'sourceFile':source,
      'capturedAt':captured,'timestampEvidence':'REPORTED_BY_CAPTURE_PRODUCER',
      'sourcePaginationComplete':complete,'canonicalEventId':None,
      'providerEventId':row.get('event_ticker') or row['ticker'].rsplit('-',1)[0],
      'title':row.get('title'),'strike':row.get('floor_strike') if raw else row.get('strike'),
      'strikeType':row.get('strike_type'),'priceUnit':'USD_PER_YES_CONTRACT',
      'yesBid':bid,'yesAsk':ask,'yesBidSize':numeric(row.get('yes_bid_size_fp')) if raw else None,
      'yesAskSize':numeric(row.get('yes_ask_size_fp')) if raw else None,
      'rulesPrimary':row.get('rules_primary') if raw else None,
      'rulesSecondary':row.get('rules_secondary') if raw else None,
      'quoteState':'CROSSED' if bid is not None and ask is not None and bid>ask else 'HISTORICAL_RESEARCH_ONLY',
      'freshForExecution':False,'sportsbookLine':None}

def key(v):return re.sub(r'[^a-z0-9]+',' ',__import__('unicodedata').normalize('NFKD',v).encode('ascii','ignore').decode().casefold()).strip()

def triage_identities(rows,current,historical):
    base={str(p['espnPlayerId']):p for p in current if p['identityState']=='AMBIGUOUS_NAME'}
    if len(base)!=sum(p['identityState']=='AMBIGUOUS_NAME' for p in current):raise ValueError('DUPLICATE_CURRENT_ID')
    output=[];seen=set()
    for r in rows:
        pid=r['espnPlayerId']
        if pid in seen or pid not in base:raise ValueError('IDENTITY_QUEUE')
        seen.add(pid);p=base[pid]
        if r['name']!=p['name'] or r['currentCanonicalTeamId']!=p['canonicalTeamId']:raise ValueError('IDENTITY_BINDING')
        candidates=[x for x in historical if key(x['name'])==key(p['name'])]
        expected={(str(x['torvikPlayerId']),str(x['season']),x['sourceTeam'],x['canonicalTeamId'] or '',str(x['games'])) for x in candidates}
        supplied={tuple(v.strip().split('|')) for v in r['candidates(torvikId|season|team|canonical|games)'].split(';') if v.strip()}
        if supplied!=expected or int(r['n_candidates'])!=len(candidates):raise ValueError('HISTORICAL_CANDIDATES')
        same=[x for x in candidates if x['canonicalTeamId']==p['canonicalTeamId']]
        ids={str(x['torvikPlayerId']) for x in same}
        supplied_ids={v.strip() for v in r['same_team_candidates'].split(';') if v.strip()}
        if supplied_ids!=ids:raise ValueError('SAME_TEAM_CANDIDATE')
        state='ONE_SAME_TEAM_LEAD' if len(same)==1 else 'UNRESOLVED'
        if (state=='ONE_SAME_TEAM_LEAD')!=r['triage'].startswith('ONE_SAME_TEAM_CANDIDATE'):raise ValueError('TRIAGE_STATE')
        output.append({**p,**AUTHORITY,'researchState':state,'sameTeamTorvikIdLead':str(same[0]['torvikPlayerId']) if len(same)==1 else None,
          'verifiedPlayerIdentity':False,'availability':'UNKNOWN','expectedMinutes':None,'productionAdjustment':None,
          'researchProvenance':'GROK_OFFLINE_TRIAGE_INDEPENDENTLY_RECOMPUTED','candidateEvidence':sorted([list(x) for x in expected])})
    if seen!=set(base):raise ValueError('INCOMPLETE_IDENTITY_QUEUE')
    return output

# Reviewed exact provider codes and frozen ESPN identities, not fuzzy team matching.
EARLY_FIXTURES={
 'NIUGRAM':('401920912','Northern Illinois Huskies','Grambling Tigers'),
 'MRMKAPP':('401921422','Merrimack Warriors','App State Mountaineers'),
 'QUCWIN':('401921423','Winthrop Eagles','Queens University Royals'),
 'TNSTMURR':('401911707','Murray State Racers','Tennessee State Tigers')}

def bind_early_fixtures(quotes,events):
    by_id={str(e['eventId']):e for e in events}
    for code,(eid,away,home) in EARLY_FIXTURES.items():
        e=by_id.get(eid)
        if not e or (e['awayName'],e['homeName'],e['date'],e['neutralSite'])!=(away,home,'2026-11-02',True):
            raise ValueError('FROZEN_FIXTURE_BINDING')
    for q in quotes:
        m=re.fullmatch(r'KXNCAAMB(?:GAME|SPREAD|TOTAL)-26NOV02([A-Z]+)',q['providerEventId'])
        if m and m[1] in EARLY_FIXTURES:
            eid=EARLY_FIXTURES[m[1]][0];e=by_id[eid]
            q.update(canonicalEventId=eid,fixtureDate=e['date'],fixtureStart=e['start'],neutralSite=e['neutralSite'],
              fixtureEvidence='REVIEWED_PROVIDER_EVENT_CODE_AND_FROZEN_ESPN_PACKET')
    return quotes

def run(root):
    root=pathlib.Path(root);all_files={};receipts={}
    for label,(h,prefix) in ARCHIVES.items():
        files,receipts[label]=verified_members(root/(label+'.tar.gz'),h)
        all_files[label]={k.removeprefix(prefix+'/'):v for k,v in files.items()}
    market=all_files['markets'];api='prediction_markets_public_api/'
    quotes=[];pagination=[]
    for name,b in sorted(market.items()):
        if name.startswith(api+'k_KX') and name.endswith('.json'):
            d=json.loads(b);complete=not bool(d.get('cursor'))
            pagination.append({'sourceFile':name,'rows':len(d['markets']),'cursorOutstanding':not complete})
            quotes.extend(normalize_kalshi(r,name,'2026-11-02T07:08:00Z',complete,True) for r in d['markets'])
    early=list(csv.DictReader(io.StringIO(market[api+'kalshi_early_cbb_2026-11-02.csv'].decode())))
    if len({r['ticker'] for r in early})!=len(early):raise ValueError('DUPLICATE_EARLY_CONTRACT')
    quotes.extend(normalize_kalshi(r,api+'kalshi_early_cbb_2026-11-02.csv',ct_time(r['snapshot_ct']),None) for r in early)
    # Early paging is producer-reported; no raw page chain was supplied to prove it.
    for q in quotes:
        if q['sourcePaginationComplete'] is None:q['pagingEvidence']='PRODUCER_REPORTED_COMPLETE_NOT_INDEPENDENTLY_PROVEN'
    quotes=bind_early_fixtures(quotes,json.loads((root.parent/'cbb-projection-phase/private-projections.json').read_text())['events'])
    staged=root.parent/'cbb-grok-integration/staged'
    identities=triage_identities(list(csv.DictReader(io.StringIO(all_files['identities']['ambiguous63_triage.csv'].decode()))),
       json.loads((staged/'current-roster-history-candidates.json').read_text()),json.loads((staged/'historical-player-production.json').read_text()))
    coverage=[{'venue':'HERITAGE','captureWindowUTC':['2026-11-02T07:12:00Z','2026-11-02T07:18:00Z'],'priceUnit':'AMERICAN_ODDS','sourceFile':'heritage/heritage_early_cbb_markets_2026-11-02.txt','machineContractIds':False,'sizesAvailable':False,'state':'TEXT_AND_SCREENSHOT_EVIDENCE_ONLY'},
      {'venue':'POLYMARKET_US','captureWindowUTC':['2026-11-02T07:19:00Z','2026-11-02T07:21:00Z'],'priceUnit':'BUY_BUTTON_CENTS','sourceFile':'polymarket_us/polymarket_early_cbb_markets_2026-11-02.txt','machineContractIds':False,'sizesAvailable':False,'state':'ASK_STYLE_TRANSCRIPT_NOT_AN_ORDERBOOK'},
      {'venue':'POLYMARKET_INTERNATIONAL','captureWindowUTC':['2026-11-02T07:08:00Z','2026-11-02T07:08:59Z'],'priceUnit':'CONTRACT_PROBABILITY','sourceFile':api+'pmcbb.json','state':'GAMMA_ARCHIVE_SEPARATE_FROM_US_NOT_NORMALIZED'}]
    raw_ids={q['contractId'] for q in quotes if q['capturedAt']=='2026-11-02T07:08:00Z'}
    summary={**AUTHORITY,'archiveVerification':receipts,'kalshiObservations':len(quotes),'earlyContracts':len(early),
      'earlyContractsPresentInEarlierRaw':sum(r['ticker'] in raw_ids for r in early),'pagination':pagination,
      'identityRecords':len(identities),'identityStates':dict(collections.Counter(x['researchState'] for x in identities)),
      'promotedIdentities':0,'availability':'UNKNOWN','canonicalMarketJoins':sum(q['canonicalEventId'] is not None for q in quotes),'modelChanges':0,'networkCallsByProducer':0,
      'limitations':['Historical snapshots are not current quotes','Raw capture minute is producer-reported, not a server receipt',
        'No timestamp mixing of 01:08 sizes and 01:14 prices','US and International Polymarket kept separate',
        'Saint Francis mapping unchanged; Conway 22-vs-23 games unresolved','West Florida classification hold retained']}
    out=root/'staged';out.mkdir(exist_ok=True)
    for name,value in [('kalshi-observations.json',quotes),('identity-research.json',identities),('venue-coverage.json',coverage),('receipt.json',summary)]:
        (out/name).write_text(json.dumps(value,indent=2)+'\n')
    manifest={'files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(out.glob('*.json')) if p.name!='manifest.json']}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return summary

if __name__=='__main__':print(json.dumps(run(sys.argv[1] if len(sys.argv)>1 else 'artifacts/cbb-research-intake'),indent=2))
