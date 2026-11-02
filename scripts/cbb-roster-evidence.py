"""Build private preseason roster evidence from verified local captures only.

Does not estimate current minutes, score adjustments, injury status or wagers.
"""
import collections,csv,gzip,hashlib,json,pathlib,re,sys,unicodedata

def key(x):
 return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(x or '')).encode('ascii','ignore').decode().lower()).strip()
def height_inches(x):
 m=re.fullmatch(r'(\d)-(\d{1,2})',str(x));return int(m[1])*12+int(m[2]) if m and int(m[2])<12 else None
def hometown(x):
 parts=str(x or '').rsplit(',',1);return (key(parts[0]),key(parts[1]))if len(parts)==2 else None

def parse_season(row):
 if len(row)!=67:raise ValueError('SEASON_WIDTH')
 if row[31]!='2026':raise ValueError('SEASON_MISMATCH')
 p={'torvikPlayerId':str(row[32]),'name':row[0],'sourceTeam':row[1],'conference':row[2],'season':2026,
 'games':int(row[3]),'minutesSharePct':float(row[4]),'offensiveRating':float(row[5]),'usagePct':float(row[6]),
 'heightInches':height_inches(row[26]),'hometown':row[33],'pointsFromSeasonShooting':float(row[13])+2*float(row[16])+3*float(row[19]),
 'shootingTotals':{'ftm':float(row[13]),'fta':float(row[14]),'twoMade':float(row[16]),'twoAttempts':float(row[17]),'threeMade':float(row[19]),'threeAttempts':float(row[20])},
 'sourcePositions':{'games':3,'minutesSharePct':4,'offensiveRating':5,'usagePct':6,'heightInches':26,'torvikPlayerId':32,'hometown':33}}
 if not p['torvikPlayerId'].isdigit() or p['games']<0:raise ValueError('SEASON_ID_OR_GAMES')
 if not 0<=p['minutesSharePct']<=100 or not 0<=p['usagePct']<=100:raise ValueError('PERCENT_SCALE')
 return p

def corroborate(current,prior,name_unique):
 if not name_unique or key(current['name'])!=key(prior['name']):return False
 loc=current.get('birthPlace') or {};where=(key(loc.get('city')),key(loc.get('state')))
 return bool(prior.get('heightInches') and current.get('height')==prior['heightInches'] and all(where) and hometown(prior.get('hometown'))==where)

def audit_history(players,games):
 by=collections.defaultdict(list);names=collections.defaultdict(set)
 for g in games:
  pid=str(g[51]);by[pid].append(g);names[(key(g[48]),key(g[47]))].add(pid)
 used=set();report=[]
 for p in players:
  pid=p['torvikPlayerId'];rows=by.get(pid,[]);bridge='DIRECT_PROVIDER_ID';reasons=[]
  if not rows:
   candidates=names.get((key(p['name']),key(p['sourceTeam'])),set())
   if len(candidates)==1:
    other=next(iter(candidates));test=by[other]
    totals={n:sum(x[c]for x in test)for n,c in [('ftm',27),('fta',28),('twoMade',23),('twoAttempts',24),('threeMade',25),('threeAttempts',26)]}
    if len(test)==p['games'] and all(abs(totals[n]-v)<.01 for n,v in p['shootingTotals'].items()):
     pid=other;rows=test;bridge='EXACT_NAME_TEAM_GAMES_SIX_SHOOTING_TOTALS'
  if not rows:reasons.append('NO_PLAYER_GAME_ROWS')
  if rows and (any(key(x[48])!=key(p['name']) or key(x[47])!=key(p['sourceTeam']) for x in rows)):reasons.append('SEASON_GAME_IDENTITY_CONFLICT')
  if rows and len(rows)!=p['games']:reasons.append('GAME_COUNT_MISMATCH')
  points=sum(x[33]for x in rows)
  if rows and abs(points-p['pointsFromSeasonShooting'])>.01:reasons.append('SCORING_TOTAL_MISMATCH')
  if rows:
   if pid in used:raise ValueError('NON_INJECTIVE_HISTORY_ID_BRIDGE')
   used.add(pid)
  report.append({**p,'gameFilePlayerId':pid if rows else None,'providerIdBridge':bridge if rows else 'UNRESOLVED','gameRows':len(rows),'pointsFromGames':points if rows else None,'historyState':'CONSISTENT_CAPTURE'if not reasons else 'QUARANTINED','historyReasons':reasons})
 return report,by

def run(base):
 base=pathlib.Path(base);src=base/'cbb-grok-integration';dest=base/'cbb-roster-evidence';dest.mkdir(exist_ok=True)
 schema=json.loads((dest/'hoopr-schema-source.json').read_text())
 # Pin the exact parser revision that documents the positional columns used here.
 if schema['sha']!='2266bffd2b733880c4d7aab22013f57f8d339c12':raise ValueError('SCHEMA_REVIEW_REQUIRED')
 seasons=[parse_season(r)for r in csv.reader((src/'restored/raw_torvik/2026_getadvstats.csv').open())]
 if len({x['torvikPlayerId']for x in seasons})!=len(seasons):raise ValueError('DUPLICATE_SEASON_PLAYER_ID')
 games=json.load(gzip.open(src/'restored/raw_torvik/2026_all_advgames.json.gz','rt'))
 audited,by_game=audit_history(seasons,games);by_name=collections.defaultdict(list)
 for p in audited:by_name[key(p['name'])].append(p)
 cross=json.loads((src/'staged/team-crosswalk.json').read_text());known=json.loads((base/'cbb-current-2027/teams.json').read_text());valid={str(t['id'])for t in known}
 current=[]
 for f in sorted((base/'cbb-current-2027/raw').glob('*.json')):
  doc=json.loads(f.read_text());payload=doc.get('payload',{})
  if str(payload.get('season',{}).get('year'))!='2027':raise ValueError('CURRENT_ROSTER_SEASON')
  tid=str(doc['teamId']).removeprefix('cbb-')
  if tid not in valid:raise ValueError('CURRENT_TEAM_UNKNOWN')
  for p in payload.get('athletes',[]):current.append({'espnPlayerId':str(p['id']),'canonicalTeamId':'cbb-'+tid,'name':p['displayName'],'height':p.get('height'),'birthPlace':p.get('birthPlace'),'observedAt':doc['observedAt']})
 names=collections.Counter(key(p['name'])for p in current);identities=collections.Counter(p['espnPlayerId']for p in current)
 matches=[];team_rows=[];used=set()
 for c in current:
  choices=by_name.get(key(c['name']),[]);unique=len(choices)==1 and names[key(c['name'])]==1 and identities[c['espnPlayerId']]==1
  p=choices[0] if len(choices)==1 else None
  supported=bool(p and corroborate(c,p,unique));prior_id=p['torvikPlayerId']if supported else None
  if supported:
   if prior_id in used:raise ValueError('NON_INJECTIVE_CROSSWALK')
   used.add(prior_id)
  pt=cross.get('torvik:'+p['sourceTeam'])if supported else None
  relationship='SAME_SCHOOL_OBSERVED'if supported and pt==c['canonicalTeamId'] else 'DIFFERENT_SCHOOL_OBSERVED'if supported and pt else 'UNKNOWN'
  matches.append({**c,'torvikPlayerId':prior_id,'priorCanonicalTeamId':pt,'priorSourceTeam':p['sourceTeam']if supported else None,
  'identityState':'CORROBORATED_NAME_HEIGHT_HOMETOWN'if supported else 'NAME_CANDIDATE_ONLY'if unique else 'AMBIGUOUS_NAME_OR_ID'if choices else 'NO_SEASON_NAME_MATCH',
  'officialProviderCrosswalk':False,'evidence':['EXACT_NORMALIZED_NAME','EXACT_HEIGHT_INCHES','EXACT_HOMETOWN_CITY_STATE']if supported else [],
  'rosterRelationship':relationship,'priorMinutesSharePct':p['minutesSharePct']if supported and p['historyState']=='CONSISTENT_CAPTURE' else None,
  'priorUsagePct':p['usagePct']if supported and p['historyState']=='CONSISTENT_CAPTURE' else None,
  'historyState':p['historyState']if supported else 'NOT_ATTACHED','availability':'UNKNOWN','expectedMinutes':None,'modelAdjustment':None,'canAuthorizeWager':False})
 for tid in sorted('cbb-'+x for x in valid):
  players=[x for x in matches if x['canonicalTeamId']==tid];counts=collections.Counter(x['rosterRelationship']for x in players)
  team_rows.append({'season':2027,'canonicalTeamId':tid,'rosterCount':len(players),'corroboratedSameSchoolPlayers':counts['SAME_SCHOOL_OBSERVED'],'corroboratedChangedSchoolPlayers':counts['DIFFERENT_SCHOOL_OBSERVED'],'unresolvedPlayers':counts['UNKNOWN'],
   'returningMinutesPct':None,'expectedMinutes':None,'rosterScoreAdjustment':None,'reason':'PARTIAL_IDENTITY_AND_HISTORY; NO_CURRENT_ROTATION_MODEL','canAdjustProjection':False})
 summary={'schemaSource':schema['display_url'],'schemaBlobSha':schema['sha'],'historicalSeasonPlayers':len(audited),'consistentHistoricalPlayers':sum(x['historyState']=='CONSISTENT_CAPTURE'for x in audited),
 'quarantinedHistoryReasons':dict(collections.Counter(reason for x in audited for reason in x['historyReasons'])),'gamePlayerIdsWithoutResolvedProfile':len(set(by_game)-{p['gameFilePlayerId']for p in audited}),
 'providerIdBridges':sum(p['providerIdBridge']=='EXACT_NAME_TEAM_GAMES_SIX_SHOOTING_TOTALS'for p in audited),
 'currentRosterRecords':len(matches),'teams':len(team_rows),'identityStates':dict(collections.Counter(x['identityState']for x in matches)),'relationships':dict(collections.Counter(x['rosterRelationship']for x in matches)),
 'supportedPlayersWithConsistentHistory':sum(x['priorMinutesSharePct']is not None for x in matches),'officialProviderCrosswalk':False,'providerRequests':0,'modelChanges':0,'canAuthorizeWager':False}
 remaining=[{'gameFilePlayerId':pid,'name':g[0][48],'sourceTeam':g[0][47],'games':len(g)}for pid,g in by_game.items() if pid not in {p['gameFilePlayerId']for p in audited}]
 for name,obj in [('unresolved-history-players.json',remaining),('provider-id-bridges.json',[p for p in audited if p['providerIdBridge']=='EXACT_NAME_TEAM_GAMES_SIX_SHOOTING_TOTALS']),('historical-season-validated.json',audited),('roster-history-crosswalk.json',matches),('team-roster-evidence.json',team_rows),('phase-receipt.json',summary)]:
  (dest/name).write_text(json.dumps(obj,indent=2))
 return summary
if __name__=='__main__':print(json.dumps(run(sys.argv[1]if len(sys.argv)>1 else 'artifacts'),indent=2))
