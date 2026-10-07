import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/tennis-refresh.yml',import.meta.url),'utf8');

test('Tennis refresh workflow reports the health schema actually emitted by the builder',()=>{
  for(const key of ['refreshStartedAt','refreshCompletedAt','manifestRetrievedAt','workflowSha','workflowRunId','latestByKind']){
    assert.match(workflow,new RegExp('\\b'+key+'\\b'));
  }
  assert.doesNotMatch(workflow,/\brefreshedAt\b/);
  assert.doesNotMatch(workflow,/\bbyKind\b/);
});

test('Tennis refresh workflow persists immutable and latest canonical artifacts',()=>{
  for(const file of ['source-manifest.json','refresh-health.json','canonical-matches.ndjson','tennis_serve_index.json']){
    assert.match(workflow,new RegExp(file.replaceAll('.','\\.')));
  }
  assert.match(workflow,/tennis\/canonical\/\$\{scope\}\/\$\{stamp\}/);
  assert.match(workflow,/tennis\/canonical\/\$\{scope\}\/latest/);
});
