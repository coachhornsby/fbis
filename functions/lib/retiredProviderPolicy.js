// Owner decision, 2026-11-06. Credentials and feature flags cannot override this.
const retiredHosts = ['apify.com', 'parlay-api.com', 'the-odds-api.com'];
export const RETIRED_PROVIDER_ERROR = 'PROVIDER_RETIRED_BY_OWNER';
export function isRetiredProviderUrl(input) {
  const host = new URL(input instanceof Request ? input.url : String(input)).hostname.toLowerCase();
  return retiredHosts.some(domain => host === domain || host.endsWith('.' + domain));
}
export function guardProviderFetch(transport = globalThis.fetch) {
  return (input, init) => {
    if (isRetiredProviderUrl(input)) throw new Error(RETIRED_PROVIDER_ERROR);
    return transport(input, init);
  };
}
export function isRetiredProviderSecret(name) {
  return /^(APIFY(?:_|$)|ACTION_APIFY(?:_|$)|PARLAY(?:_|$)|THEODDS(?:_|$)|THE_ODDS(?:_|$))/i.test(name);
}
export function retiredProviderResponse() {
  return new Response(JSON.stringify({ok:false,blocked:true,error:RETIRED_PROVIDER_ERROR,
    canQualify:false,canAuthorizeWager:false}),
    {status:410,headers:{'content-type':'application/json','cache-control':'no-store'}});
}
