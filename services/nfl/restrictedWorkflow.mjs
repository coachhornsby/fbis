// Reject this new one-shot workflow from every legacy broad OIDC authority.
// Its own verifier and fixed routes are the only permitted OIDC destination.
const PREFIX='coachhornsby/fbis/.github/workflows/fbis-nfl-verified-once.yml@';
export function isNflRestrictedWorkflow(claims){
 return ['workflow_ref','job_workflow_ref'].some(k=>typeof claims?.[k]==='string'&&claims[k].toLowerCase().startsWith(PREFIX));
}
