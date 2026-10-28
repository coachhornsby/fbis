#!/usr/bin/env python3
"""Compare every retained typed field and every archive reference after migration."""
import sys,sqlite3,json,hashlib,itertools
original=sqlite3.connect(sys.argv[1]);compacted=sqlite3.connect(sys.argv[2]);drive_id=sys.argv[3];sql_sha=sys.argv[4]
keys=['player_image','playerImage','player_headshot_url','headshot','image_url','imageUrl','league','leagueName','player_league','payout_break_even_probability','break_even_probability','payoutBreakEvenProbability','breakEvenProbability','payout_calibration_validated','payoutCalibrationValidated']
columns=[r[1] for r in original.execute('PRAGMA table_info(prizepicks_prop_lines)')];assert columns==[r[1] for r in compacted.execute('PRAGMA table_info(prizepicks_prop_lines)')];raw_index=columns.index('raw_json');id_index=columns.index('id');n=0;changed=0;oldbytes=0;newbytes=0;typed=hashlib.sha256()
for old,new in itertools.zip_longest(original.execute('SELECT * FROM prizepicks_prop_lines ORDER BY id'),compacted.execute('SELECT * FROM prizepicks_prop_lines ORDER BY id')):
 assert old is not None and new is not None
 a=[v for i,v in enumerate(old) if i!=raw_index];b=[v for i,v in enumerate(new) if i!=raw_index];assert a==b,('Typed field changed',old[id_index]);n+=1
 data=json.dumps(a,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode();typed.update(len(data).to_bytes(8,'big'));typed.update(data)
 before=old[raw_index];after=new[raw_index];oldbytes+=len(before.encode());newbytes+=len(after.encode())
 if before==after:continue
 changed+=1;x=json.loads(before);y=json.loads(after);ref=y.pop('_fbisArchive');assert y=={k:x[k] for k in keys if k in x}
 assert ref=={'version':'fbis-prizepicks-drive-v1','driveFileId':drive_id,'sourceSqlSha256':sql_sha,'table':'prizepicks_prop_lines','id':old[id_index],'rawSha256':hashlib.sha256(before.encode()).hexdigest()}
 for k in keys:
  if k in x and isinstance(x[k],bool):assert isinstance(y[k],bool) and y[k] is x[k]
assert n==127812;assert compacted.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not compacted.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps({'rows':n,'archivedPayloads':changed,'allTypedFieldsPreserved':True,'allInlineConsumerFieldsPreserved':True,'allArchiveReferencesVerified':True,'typedFieldsSha256':typed.hexdigest(),'originalRawBytes':oldbytes,'compactRawBytes':newbytes,'payloadBytesRemoved':oldbytes-newbytes,'integrity':'ok','foreignKeyErrors':0},indent=2))
