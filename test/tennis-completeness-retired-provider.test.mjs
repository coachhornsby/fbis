import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const audit=readFileSync(new URL('../scripts/tennis-completeness-audit.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/tennis-completeness-audit.yml',import.meta.url),'utf8');

test('tennis completeness audit never treats retired PrizePicks as a live market or image collector',()=>{
 assert.doesNotMatch(audit,/\/api\/prizepicks-props\?mode=acquisition/i);
 assert.doesNotMatch(audit,/PRIZEPICKS_DAILY_CAPTURE|PRIZEPICKS_NO_CAPTURE_FOR_CT_DATE|PRIZEPICKS_COMPLETE_NO_TENNIS_ROWS/);
 assert.doesNotMatch(audit,/HARVEST_SECRET/);
 assert.match(audit,/historicalPrizePicksAcquisition/);
 assert.match(audit,/LEGACY_HISTORY_ONLY_CURRENT_ACTION_HEADSHOT_ROUTE_NOT_VERIFIED/);
});
test('tennis audit preserves canonical fixtures, projection and image coverage without paid calls',()=>{
 for(const route of ['/api/tennis-source-coverage','/api/tennis-projection-coverage','/api/tennis-portrait-coverage','/api/today?sport=tennis'])
  assert.ok(audit.includes(route),route);
 assert.doesNotMatch(workflow,/HARVEST_SECRET|APIFY_TOKEN|workflow_dispatch:\s*\{[^}]*paid/i);
 assert.match(workflow,/tennis-completeness-audit\.mjs/);
});
