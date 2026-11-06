import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {validCycleAllocation} from '../services/account-budget/cycleAllocation.mjs';
import {executionPolicyError} from '../services/account-budget/executionJobs.mjs';
const policy=JSON.parse(readFileSync(new URL('../operations/releases/exchange-cycle-policy-20261106.json',import.meta.url)));
if(!validCycleAllocation(policy,Date.now()))throw Error('INVALID_OR_EXPIRED_EXCHANGE_ALLOCATION');
for(const job of Object.keys(policy.jobs))if(executionPolicyError(policy,job))throw Error('INVALID_JOB_POLICY:'+job);
const r=spawnSync('npx',['wrangler','deploy','--config','services/account-budget/wrangler.jsonc','--var','FBIS_ACCOUNT_BUDGET_POLICY:'+JSON.stringify(policy)],{stdio:'inherit'});
process.exit(r.status??1);
