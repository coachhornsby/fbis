"""Import current Grok evidence without promoting media claims to official availability."""
import csv,importlib.util,io,json,pathlib,sys,collections
spec=importlib.util.spec_from_file_location('intake',pathlib.Path(__file__).with_name('cbb-research-intake.py'));intake=importlib.util.module_from_spec(spec);spec.loader.exec_module(intake)
ARCHIVE_SHA='76aa8ebef859d5e54f757b30259b13819ad425f4d82ab062779ef342f50ba24e'
PREFIX='FBIS_CBB_Availability_Identity_KalshiRaw_20261102/'

def bind_team_rows(rows,scoreboard,known_events):
    events={str(e['id']):e for e in scoreboard['events']};seen=set();accepted=[];rejected=[]
    for r in rows:
        eid=r['espn_event_id'];side=r['side'];key=(eid,side);e=events.get(eid)
        c=next(iter(e.get('competitions',[])),{}) if e else {}
        team=next((x for x in c.get('competitors',[]) if x.get('homeAway')==side),{})
        reason=None
        if key in seen:reason='DUPLICATE_TEAM_ROW'
        elif eid not in known_events or not e or side not in ['home','away']:reason='EVENT_UNBOUND'
        elif str(team.get('team',{}).get('id'))!=r['espn_team_id'] or team.get('team',{}).get('displayName')!=r['team']:reason='TEAM_IDENTITY_MISMATCH'
        elif r['status']!='UNKNOWN' or r['espn_player_id']:reason='UNSUPPORTED_PLAYER_CLAIM'
        seen.add(key)
        if reason:rejected.append({**r,'reason':reason})
        else:accepted.append({**r,'evidenceState':'SOURCE_CHECK_REPORTED_NO_DATA','availability':'UNKNOWN','canAdjustModel':False,'canAuthorizeWager':False})
    by_event=collections.Counter(r['espn_event_id'] for r in accepted)
    if any(n!=2 for n in by_event.values()):raise ValueError('INCOMPLETE_TEAM_PAIR')
    return accepted,rejected

def bind_bio_rows(rows,identity_queue):
    leads={r['espnPlayerId']:r for r in identity_queue if r['researchState']=='ONE_SAME_TEAM_LEAD'}
    seen=set();out=[]
    for r in rows:
        pid=r['espnPlayerId'];p=leads.get(pid)
        if pid in seen or not p or r['name']!=p['name'] or 'cbb-'+r['espn_team_id']!=p['canonicalTeamId'] or r['torvik_same_team_candidate']!=p['sameTeamTorvikIdLead']:raise ValueError('BIO_IDENTITY_BINDING')
        seen.add(pid)
        state='OFFICIAL_BIO_CORROBORATION_REPORTED' if r['classification'].startswith('VERIFIED_SAME_TEAM') else 'UNCONFIRMED_LEAD'
        out.append({**p,'bioResearch':r,'bioEvidenceState':state,'verifiedPlayerIdentity':False,'productionAdjustment':None,'canAdjustModel':False,'availability':'UNKNOWN'})
    if seen!=set(leads):raise ValueError('INCOMPLETE_LEAD_DELIVERY')
    return out

def run(root):
    root=pathlib.Path(root);files,verification=intake.verified_members(root/'source.tar.gz',ARCHIVE_SHA)
    files={k.removeprefix(PREFIX):v for k,v in files.items()}
    csvrows=lambda n:list(csv.DictReader(io.StringIO(files[n].decode())))
    prior=root.parent/'cbb-research-intake/staged';queue=json.loads((prior/'identity-research.json').read_text())
    known={str(e['eventId']) for e in json.loads((root.parent/'cbb-projection-phase/private-projections.json').read_text())['events']}
    team_rows,rejected=bind_team_rows(csvrows('espn_full_slate_availability_177_unstarted.csv'),json.loads(files['espn_scoreboard_20261102_raw.json']),known)
    bios=bind_bio_rows(csvrows('identity_20_leads_official_bios.csv'),queue)
    # Claims retain their original provenance; no media report or silence becomes an official record.
    claims=[{**r,'intakeState':'RESEARCH_ONLY_MISSING_PLAYER_ID_OR_OFFICIAL_TIME_BOUND_EVIDENCE','canAdjustModel':False,'canAuthorizeWager':False} for r in csvrows('bryan_games_availability.csv')]
    markets=[]
    old=root.parent/'cbb-research-intake/markets/FBIS_CBB_Market_Snapshots_20261102/prediction_markets_public_api'
    for name,b in files.items():
        if name.startswith('kalshi_raw_0108CT/k_KX') and name.endswith('.json'):
            prior_bytes=(old/pathlib.Path(name).name).read_bytes()
            if b!=prior_bytes:raise ValueError('PRIOR_MARKET_RAW_CHANGED')
            d=json.loads(b);markets.append({'file':name,'identicalToPrior':True,'rows':len(d['markets']),'cursorOutstanding':bool(d.get('cursor'))})
    out=root/'staged';out.mkdir(exist_ok=True)
    receipt={'archive':verification,'teamRows':len(team_rows),'fixtures':len({r['espn_event_id'] for r in team_rows}),'rejectedTeamRows':len(rejected),'bioRows':len(bios),'bioStates':dict(collections.Counter(x['bioEvidenceState'] for x in bios)),'researchClaimRows':len(claims),'acceptedOfficialPlayerAvailability':0,'promotedIdentities':0,'modelChanges':0,'kalshiRaw':markets,'canAuthorizeWager':False}
    for name,obj in [('team-source-checks.json',team_rows),('rejected-team-rows.json',rejected),('bio-research.json',bios),('availability-claims-research.json',claims),('official-availability.json',{'officialHosts':[],'records':[]}),('receipt.json',receipt)]:
        (out/name).write_text(json.dumps(obj,indent=2))
    return receipt
if __name__=='__main__':print(json.dumps(run(sys.argv[1] if len(sys.argv)>1 else 'artifacts/cbb-current-evidence'),indent=2))
