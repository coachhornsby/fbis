import {DurableObject} from 'cloudflare:workers';
import {reserveJob} from './admission.mjs';

export class AccountBudget extends DurableObject {
  async reserve(request) {
    let policy;
    try {policy=JSON.parse(this.env.FBIS_ACCOUNT_BUDGET_POLICY || 'null');}
    catch {return {allowed:false,reason:'INVALID_POLICY'};}
    return reserveJob(this.ctx.storage,policy,request);
  }
}

// Admission is service RPC only. No public control or policy-update endpoint.
export default {fetch(){return new Response('Not found',{status:404});}};
