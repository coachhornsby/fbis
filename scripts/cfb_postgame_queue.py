"""Offline durable discovery/lease contract. No provider calls or production adapter."""
import json,sqlite3,uuid
from datetime import timedelta
from cfb_postgame_rehearsal import stamp

def clock(value):return stamp(value).isoformat()
class Queue:
 def __init__(self,path=':memory:'):
  self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row
  self.db.executescript('''CREATE TABLE IF NOT EXISTS queue(game_id TEXT PRIMARY KEY,
   season INTEGER NOT NULL,identity_json TEXT NOT NULL,source TEXT NOT NULL,
   authoritative_status TEXT NOT NULL,state TEXT NOT NULL,observed_at TEXT NOT NULL,
   due_at TEXT,lease_token TEXT,lease_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,
   error TEXT,verified_version TEXT);''')
 def reconcile(self,games,directory,at):
  at=clock(at);seen=set()
  # Validate the entire acquisition before changing queue state.
  validated=[]
  for g in games:
   gid=g['game_id'];season=g['season'];observed=clock(g['observed_at'])
   if not gid or gid in seen:raise ValueError('Duplicate or empty game identity')
   seen.add(gid)
   if observed>at or not g.get('source'):raise ValueError('Invalid acquisition evidence')
   teams=g['teams']
   if len(teams)!=2 or len({t['team_id'] for t in teams})!=2:raise ValueError('Two canonical participants required')
   classifications=[]
   for t in teams:
    identity=directory.get((t['team_id'],season))
    if not identity or identity['provider_id']!=t['provider_team_id']:raise ValueError('Unverified canonical identity')
    classifications.append(identity['classification'])
   if 'FBS' not in classifications:continue
   status=g['status']
   if status not in {'SCHEDULED','IN_PROGRESS','FINAL','POSTPONED','CANCELLED','SUSPENDED'}:raise ValueError('Unrecognized official status')
   identity=json.dumps(sorted((t['team_id'],t['provider_team_id']) for t in teams),separators=(',',':'))
   old=self.db.execute('SELECT * FROM queue WHERE game_id=?',(gid,)).fetchone()
   if old and (old['season']!=season or old['identity_json']!=identity or old['source']!=g['source']):raise ValueError('Existing game identity/source changed')
   if old and observed<old['observed_at']:continue
   if old and observed==old['observed_at'] and status!=old['authoritative_status']:raise ValueError('Conflicting same-time source status')
   validated.append((g,identity,observed,old))
  with self.db:
   for g,identity,observed,old in validated:
    status=g['status'];state='FINAL_DETECTED' if status=='FINAL' else status
    due=at if status=='FINAL' else None
    if old and status=='FINAL' and old['authoritative_status']=='FINAL':
     # Repeated final polls do not defeat a lease or erase failure/correction state.
     state=old['state'];due=old['due_at']
    if old and old['verified_version'] and status!='FINAL':state='QUARANTINED';due=None
    self.db.execute('''INSERT INTO queue(game_id,season,identity_json,source,authoritative_status,state,observed_at,due_at)
     VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET authoritative_status=excluded.authoritative_status,
     state=excluded.state,observed_at=excluded.observed_at,due_at=excluded.due_at''',
     (g['game_id'],g['season'],identity,g['source'],status,state,observed,due))
  return len(validated)
 def claim(self,at,lease_seconds=300):
  at=clock(at)
  if not 1<=lease_seconds<=3600:raise ValueError('Bounded lease required')
  token=str(uuid.uuid4());until=(stamp(at)+timedelta(seconds=lease_seconds)).isoformat()
  try:
   self.db.execute('BEGIN IMMEDIATE')
   row=self.db.execute('''SELECT * FROM queue WHERE authoritative_status='FINAL' AND due_at<=?
    AND (lease_until IS NULL OR lease_until<=?) AND state IN
    ('FINAL_DETECTED','SOURCE_PENDING','PARTIAL_SOURCE','RETRY_PENDING','VALIDATING','VERIFIED','CORRECTED')
    ORDER BY due_at,game_id LIMIT 1''',(at,at)).fetchone()
   if row:self.db.execute("UPDATE queue SET state='VALIDATING',lease_token=?,lease_until=?,attempts=attempts+1 WHERE game_id=?",(token,until,row['game_id']))
   self.db.commit()
   return None if not row else {'game_id':row['game_id'],'lease_token':token,'lease_until':until,'previous_version':row['verified_version']}
  except Exception:self.db.rollback();raise
 def finish(self,claim,at,*,version=None,error=None,state=None,retry_seconds=900):
  at=clock(at)
  if not 1<=retry_seconds<=86400:raise ValueError('Bounded correction/retry delay required')
  with self.db:
   row=self.db.execute('SELECT * FROM queue WHERE game_id=?',(claim['game_id'],)).fetchone()
   if not row or row['authoritative_status']!='FINAL' or row['state']!='VALIDATING' or row['lease_token']!=claim['lease_token'] or row['lease_until']<=at:raise ValueError('Expired or superseded lease')
   if version:
    if error or state:raise ValueError('Cannot both verify and fail')
    state='CORRECTED' if row['verified_version'] and row['verified_version']!=version else 'VERIFIED'
   elif state not in {'SOURCE_PENDING','PARTIAL_SOURCE','RETRY_PENDING','QUARANTINED'}:raise ValueError('Explicit failure state required')
   due=None if state=='QUARANTINED' else (stamp(at)+timedelta(seconds=retry_seconds)).isoformat()
   self.db.execute('''UPDATE queue SET state=?,due_at=?,lease_token=NULL,lease_until=NULL,error=?,
    verified_version=COALESCE(?,verified_version) WHERE game_id=?''',(state,due,error,version,claim['game_id']))
 def health(self,at):
  at=clock(at);rows=[dict(r) for r in self.db.execute('SELECT * FROM queue ORDER BY game_id')]
  return {'states':{s:sum(r['state']==s for r in rows) for s in sorted({r['state'] for r in rows})},
   'final_games':sum(r['authoritative_status']=='FINAL' for r in rows),
   'unverified_final_games':[r['game_id'] for r in rows if r['authoritative_status']=='FINAL' and not r['verified_version']],
   'expired_leases':[r['game_id'] for r in rows if r['lease_until'] and r['lease_until']<=at],
   'quarantined_games':[r['game_id'] for r in rows if r['state']=='QUARANTINED'],
   'reconciliation_cutoff':at,'production_ready':False}
