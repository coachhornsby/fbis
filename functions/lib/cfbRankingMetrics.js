/** Display-only ranking contracts. Never production-model coefficients. */
export const CFB_RANKING_METRICS = [
  ['overall','Overall adjusted EPA','net_adj_epa',false,'plays_off'],
  ['offense','Offensive adjusted EPA','adj_off_epa',false,'plays_off'],
  ['defense','Defensive adjusted EPA allowed','adj_def_epa',true,'plays_def'],
  ['passingOffense','Passing EPA','EPAplay_off_pass',false,'plays_off'],
  ['passingDefense','Passing EPA allowed','EPAplay_def_pass',true,'plays_def'],
  ['rushingOffense','Rushing EPA','EPAplay_off_rush',false,'plays_off'],
  ['rushingDefense','Rushing EPA allowed','EPAplay_def_rush',true,'plays_def'],
  ['successOffense','Offensive success rate','success_off',false,'plays_off'],
  ['successDefense','Success rate allowed','success_def',true,'plays_def'],
  ['explosivenessOffense','Explosive play rate','explosive_off',false,'plays_off'],
  ['explosivenessDefense','Explosive play rate allowed','explosive_def',true,'plays_def'],
  ['lineOffense','Offensive line yards','line_yards_off_rush',false,'plays_off'],
  ['lineDefense','Line yards allowed','line_yards_def_rush',true,'plays_def'],
  ['havocCreated','Defensive havoc','havoc_def',false,'plays_def'],
  ['havocAllowed','Offensive havoc allowed','havoc_off',true,'plays_off'],
  ['thirdDownOffense','Third-down success','third_down_success_off',false,'plays_off'],
  ['thirdDownDefense','Third-down success allowed','third_down_success_def',true,'plays_def'],
  ['redZoneOffense','Red-zone success','red_zone_success_off',false,'plays_off'],
  ['redZoneDefense','Red-zone success allowed','red_zone_success_def',true,'plays_def'],
  ['driveOffense','Points per drive','pts_per_drive_off',false,'plays_off'],
  ['driveDefense','Points per drive allowed','pts_per_drive_def',true,'plays_def'],
].map(([id,label,field,lowerIsBetter,weightField])=>({id,label,field,lowerIsBetter,weightField}));

export function attachDetailedCfbRankings(intelligence) {
  const teams=intelligence.teams;
  for(const team of teams)team.rankings={};
  for(const metric of CFB_RANKING_METRICS){
    const sorted=teams.filter(t=>t.games>0&&Number.isFinite(t.stats[metric.field]))
      .sort((a,b)=>(metric.lowerIsBetter?1:-1)*(a.stats[metric.field]-b.stats[metric.field])||a.teamId.localeCompare(b.teamId));
    let previous=null,place=null;
    const positions=new Map(sorted.map((t,i)=>{if(t.stats[metric.field]!==previous)place=i+1;previous=t.stats[metric.field];return [t.teamId,place];}));
    for(const team of teams)team.rankings[metric.id]={rank:positions.get(team.teamId)??null,value:team.stats[metric.field]??null,
      eligibleTeams:sorted.length,games:team.games,uncertainty:null,state:positions.has(team.teamId)?'SOURCE_SUMMARY':'UNAVAILABLE'};
    for(const conference of intelligence.conferences){
      const members=teams.filter(t=>t.conference===conference.name);
      const observed=members.filter(t=>positions.has(t.teamId));
      const values=observed.map(t=>t.stats[metric.field]);
      const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
      conference.rankings??={};
      conference.rankings[metric.id]={value:mean,contributingTeams:values.length,members:members.length,rank:null,
        withinConferenceSd:values.length>1?Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1)):null,
        methodology:'Equal-weight mean of qualified member-team source summaries; within-conference SD is team dispersion, not a confidence interval.'};
    }
    const conferences=intelligence.conferences.filter(c=>c.rankings[metric.id].value!=null)
      .sort((a,b)=>(metric.lowerIsBetter?1:-1)*(a.rankings[metric.id].value-b.rankings[metric.id].value));
    previous=null;place=null;
    conferences.forEach((c,i)=>{if(c.rankings[metric.id].value!==previous)place=i+1;previous=c.rankings[metric.id].value;c.rankings[metric.id].rank=place;});
  }
  intelligence.rankingMetrics=CFB_RANKING_METRICS;
  intelligence.unavailableRankingFamilies={specialTeams:'Not supplied by the qualified summary contract',personnel:'No qualified availability/impact observations',
    recentFormPower:'No qualified recency strength model',uncertainty:'Source summary does not supply rating confidence intervals',
    strengthOfSchedule:'No independently qualified schedule-strength estimator'};
  return intelligence;
}
