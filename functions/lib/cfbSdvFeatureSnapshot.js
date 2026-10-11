import {SDV_INTELLIGENCE_VERSION} from './cfbSdvIntelligence.js';
export function buildSdvFeatureSnapshot(intelligence,game,decisionAt,calculatedAt=new Date().toISOString()){
  const cutoff=Date.parse(decisionAt),kickoff=Date.parse(game.start),observed=Date.parse(intelligence.source.observedAt),calculated=Date.parse(calculatedAt);
  if(![cutoff,kickoff,observed,calculated].every(Number.isFinite)||observed>cutoff||calculated<cutoff||calculated>=kickoff||cutoff>=kickoff)throw Error('Invalid point-in-time cutoff');
  if(!intelligence.source.sha256||game.providerStartTimeTbd)throw Error('Unverified evidence or kickoff');
  const sides={};
  for(const side of ['home','away']){
    const id=String(game[side]?.providerTeamId||game[side]?.espnId||'');
    const team=intelligence.teams.find(t=>t.espnId===id);if(!team)throw Error('Canonical FBS participant missing');
    sides[side]={teamId:team.teamId,games:team.games,
      // Keep every metric as evidence; metadata and redundant ranks are excluded from candidate inputs.
      evidenceMetrics:{...team.stats},candidateFeatures:Object.fromEntries(Object.entries(team.stats).filter(([key])=>!key.endsWith('_rank')&&!key.endsWith('_conf_pct')))};
  }
  return {version:SDV_INTELLIGENCE_VERSION,gameId:String(game.id),season:2026,decisionAt,calculatedAt,kickoff:game.start,source:{...intelligence.source},sides,
    role:'PROSPECTIVE_RESEARCH_FEATURES',productionModelInputsChanged:false,canQualify:false,canAuthorizeWager:false};
}
