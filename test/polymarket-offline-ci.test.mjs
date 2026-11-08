import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/fbis-poly-us-cbb-first-half-ci.yml',import.meta.url),'utf8');
test('Polymarket repair CI runs local tests without direct provider probes or deployment',()=>{
 assert.doesNotMatch(workflow,/npm run build|publish-board-snapshots|build:publication/);
 assert.doesNotMatch(workflow,/gateway\.polymarket|fetch\(|\bcurl\b|\bwget\b|wrangler (?:deploy|pages deploy)/);
 for(const target of ['test/polymarket-pregame-rest.test.mjs','test/polymarket-rest-runtime.test.mjs','./test/offline-network.js','npm ci --prefix services/account-budget --ignore-scripts'])assert.ok(workflow.includes(target),target);
});

test('overlapping CBB explorer CI uses compilation without live scoreboard build script',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/fbis-cbb-market-explorer-ci.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/npm run build|publish-board-snapshots|build:publication/);
 assert.ok(workflow.includes('./node_modules/.bin/vite build --config vite.publication.config.js'));
});
