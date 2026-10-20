import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {validateCloudflareConfig} from '../scripts/verify-cloudflare-config.mjs';
test('all Worker configs explicitly retain traces and keep credentials out of vars',()=>{
 for(const file of readdirSync('.').filter(x=>/^wrangler.*\.toml$/.test(x)))assert.deepEqual(validateCloudflareConfig(readFileSync(file,'utf8'),{pages:file==='wrangler.toml'}),[],file);
});
test('config guard rejects regression in traces or plaintext credentials',()=>{
 const good='compatibility_date = "2026-10-01"\n[observability.traces]\nenabled = true\n[vars]\n';
 assert.ok(validateCloudflareConfig(good.replace('enabled = true','enabled = false')).includes('traces-not-explicitly-enabled'));
 assert.ok(validateCloudflareConfig(good+'OPERATIONAL_TOKEN = "forbidden"').includes('credential-in-plain-text-vars'));
});
