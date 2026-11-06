import { retiredProviderResponse } from '../../../functions/lib/retiredProviderPolicy.js';

// This bounded Pages release does not deploy the legacy application API tree.
// Retired routes must still reject explicitly, before static fallback or R2 reads.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.toLowerCase();
  if (/^\/api\/(?:apify(?:[-/]|$)|action(?:[-/]|$)|parlay(?:[-/]|$)|theodds(?:[-/]|$)|the-odds-api(?:[-/]|$))/.test(path)) {
    return retiredProviderResponse();
  }
  return context.next();
}
