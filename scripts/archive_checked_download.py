"""Checkpointed binary archive download. Does not authorize database deletion.

The URL file is a local secret and is never copied into the manifest.
Resume only with a URL for the SAME immutable export snapshot.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import urllib.request


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix('.json.tmp')
    with temporary.open('w') as f:
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    temporary.replace(path)


def download(url, snapshot, total, output, chunk_size=256*1024*1024,
             range_size=8*1024*1024, opener=urllib.request.urlopen):
    if not snapshot or not isinstance(total, int) or total <= 0:
        raise ValueError('Snapshot identity and positive byte length required')
    if chunk_size <= 0 or range_size <= 0:
        raise ValueError('Positive chunk and range sizes required')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = output / 'manifest.json'
    state = (json.loads(checkpoint.read_text()) if checkpoint.exists() else {
        'snapshot': snapshot, 'total_bytes': total, 'chunk_size': chunk_size,
        'chunks': [], 'state': 'DOWNLOADING', 'deletion_ready': False})
    if (state['snapshot'], state['total_bytes'], state['chunk_size']) != (snapshot, total, chunk_size):
        raise ValueError('Snapshot or partition mismatch; use a separate output directory')
    atomic_json(checkpoint, state)
    completed = 0
    for i, start in enumerate(range(0, total, chunk_size)):
        end = min(total, start + chunk_size)
        target = output / f'part-{i:05d}.sql.gz'
        if i < len(state['chunks']):
            record = state['chunks'][i]
            if record['file'] != target.name or digest(target) != record['sha256']:
                raise ValueError('Checkpoint chunk missing or corrupt; refusing silent reuse')
            completed += record['bytes']
            continue
        temporary = target.with_suffix('.gz.partial')
        sql_hash = hashlib.sha256()
        try:
            with gzip.open(temporary, 'wb') as out:
                for a in range(start, end, range_size):
                    b = min(end, a + range_size) - 1
                    request = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}'})
                    with opener(request, timeout=60) as response:
                        expected = f'bytes {a}-{b}/{total}'
                        if response.status != 206 or response.headers.get('Content-Range') != expected:
                            raise ValueError('Unexpected HTTP range response')
                        remaining = b-a+1
                        while remaining:
                            block = response.read(min(1024*1024, remaining))
                            if not block:
                                raise ValueError('Truncated HTTP range')
                            out.write(block)
                            sql_hash.update(block)
                            remaining -= len(block)
                        if response.read(1):
                            raise ValueError('Oversized HTTP range')
            with temporary.open('rb') as f:
                os.fsync(f.fileno())
            temporary.replace(target)
            state['chunks'].append({'file': target.name, 'start': start, 'bytes': end-start,
                                    'sha256': digest(target), 'sql_sha256': sql_hash.hexdigest()})
            completed += end-start
            atomic_json(checkpoint, state)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    if completed != total:
        raise ValueError('Incomplete archive')
    state['state'] = 'DOWNLOADED_NOT_RESTORE_VERIFIED'
    atomic_json(checkpoint, state)
    return state


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url-file', required=True)
    p.add_argument('--snapshot', required=True)
    p.add_argument('--bytes', type=int, required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    url = Path(a.url_file).read_text().strip()
    download(url, a.snapshot, a.bytes, a.output)
