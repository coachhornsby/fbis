/** Deterministic archival contract for retrospective CFB rosters. Never authorizes D1 deletion. */
import {createHash} from 'node:crypto';

export const CFB_ROSTER_SOURCE_DB = 'b50c724c-903b-4241-8ce1-48d931e7a44c';
export const CFB_ROSTER_ARCHIVE_PREFIX = 'research/storage-recovery/cfb-roster-cold-pilot';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function boundedInt(value, {name, min = 0, max}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('INVALID_' + name);
  return n;
}

export function archiveScope({season, startRowid = 0, maxRows = 500, batchRows = 100}) {
  return {
    season: boundedInt(season, {name: 'SEASON', min: 2004, max: 2024}),
    startRowid: boundedInt(startRowid, {name: 'START_ROWID', max: Number.MAX_SAFE_INTEGER}),
    maxRows: boundedInt(maxRows, {name: 'MAX_ROWS', min: 1, max: 2000}),
    batchRows: boundedInt(batchRows, {name: 'BATCH_ROWS', min: 1, max: 100}),
  };
}

export function archiveSegment(rows, {season, upperRowid, prefix = CFB_ROSTER_ARCHIVE_PREFIX}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw Error('INVALID_ARCHIVE_BATCH');
  const maxRowid = boundedInt(upperRowid, {name: 'UPPER_ROWID', min: 1, max: Number.MAX_SAFE_INTEGER});
  let last = 0;
  for (const row of rows) {
    const rowid = boundedInt(row.__archive_rowid, {name: 'SOURCE_ROWID', min: 1, max: maxRowid});
    if (rowid <= last || row.season !== season || typeof row.id !== 'string' || !row.id || !/^[0-9a-f]{64}$/.test(row.content_hash)) {
      throw Error('SOURCE_SCOPE_OR_PROVENANCE_MISMATCH');
    }
    last = rowid;
  }
  const firstRowid = String(rows[0].__archive_rowid), lastRowid = String(rows.at(-1).__archive_rowid);
  const body = JSON.stringify({
    format: 'fbis-cold-roster-pilot-v1',
    sourceDb: CFB_ROSTER_SOURCE_DB,
    table: 'cfb_roster_observations',
    season,
    frozenUpperRowid: String(maxRowid),
    firstRowid, lastRowid,
    count: rows.length,
    rows,
  }) + '\n';
  const digest = sha256(body);
  const key = prefix + '/' + season + '/part-' + firstRowid + '-' + lastRowid + '-' + digest + '.json';
  return {key,body,sha256:digest,bytes:Buffer.byteLength(body,'utf8'),firstRowid,lastRowid,count:rows.length};
}

export function archiveManifest({scope, upperRowid, totalInSeason, segments, exportedAt}) {
  if (!Array.isArray(segments) || !segments.length) throw Error('NO_SEGMENTS_TO_MANIFEST');
  const copiedRows = segments.reduce((n,s)=>n+s.count,0);
  if (copiedRows > scope.maxRows || segments.some(s=>s.verified !== true)) throw Error('UNVERIFIED_SEGMENT');
  const body = JSON.stringify({
    contract:'fbis-cold-roster-pilot-v1',
    sourceDb: CFB_ROSTER_SOURCE_DB,
    sourceTable:'cfb_roster_observations',
    sourceObservedRetrospectively:true,
    season:scope.season,
    sourceSeasonTotal:totalInSeason,
    frozenUpperRowid:String(upperRowid),
    startRowid:String(scope.startRowid),
    exportedAt,
    copiedRows,
    nonDestructive:true,
    deletionAuthorized:false,
    segments:segments.map(s=>({key:s.key,sha256:s.sha256,bytes:s.bytes,count:s.count,firstRowid:s.firstRowid,lastRowid:s.lastRowid,verified:s.verified})),
  },null,2)+'\n';
  const digest=sha256(body);
  return {body,sha256:digest,key:CFB_ROSTER_ARCHIVE_PREFIX+'/'+scope.season+'/manifest-'+digest+'.json'};
}
