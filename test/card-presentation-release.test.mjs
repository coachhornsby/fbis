import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const source=readFileSync(new URL('../.github/workflows/fbis-card-presentation-release.yml',import.meta.url),'utf8');
test('freshness release uses merged source, shared lock and only Pages deploy',()=>{
 assert.ok(source.includes('ref: ${{ github.sha }}'));assert.ok(source.includes('group: fbis-card-presentation-release'));
 assert.equal((source.match(/wrangler (?:pages )?deploy /g)||[]).length,1);assert.ok(source.includes('wrangler pages deploy dist --project-name fbis --branch main --commit-hash "${GITHUB_SHA}"'));
 assert.doesNotMatch(source,/workflow_dispatch|schedule:|--config wrangler|--keep-vars/);
 for(const file of ['polymarket-retained-display.test.mjs','retained-exchange-quotes.test.mjs','retained-exchange-card-quotes.test.mjs','exchange-card-delivery.test.mjs'])assert.ok(source.includes(file));
 assert.match(source,/Build existing production board\n        if: github.event_name == 'push'/);
});
test('exact flag preparation preserves every other TOML field and rejects false',()=>{
 const code=source.split("python3 - <<'PYTHON'\n")[1].split('\n          PYTHON')[0].split('\n').map(line=>line.slice(10)).join('\n');
 // CI prepares the real flag before tests; build each isolated fixture explicitly.
 const config=readFileSync(new URL('../deploy/board/wrangler.toml',import.meta.url),'utf8').replace(/^FBIS_POLYMARKET_PREGAME_REST\s*=.*$/gm,'');
 const cwd=mkdtempSync(join(tmpdir(),'pages-flags-'));mkdirSync(join(cwd,'deploy/board'),{recursive:true});
 try{for(const flag of [null,'true','false']){
  writeFileSync(join(cwd,'deploy/board/wrangler.toml'),config+(flag===null?'':`\nFBIS_POLYMARKET_PREGAME_REST = "${flag}"\n`));
  if(flag==='false')assert.throws(()=>execFileSync('python3',['-c',code],{cwd,stdio:'pipe'}));
  else{execFileSync('python3',['-c',code],{cwd});execFileSync('python3',['-c',"import tomllib,pathlib; assert tomllib.loads(pathlib.Path('deploy/board/wrangler.toml').read_text())['vars']['FBIS_POLYMARKET_PREGAME_REST']=='true'"],{cwd});}
 }}finally{rmSync(cwd,{recursive:true,force:true});}
});
