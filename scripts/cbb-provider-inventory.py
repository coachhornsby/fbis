"""Build a field-level provider inventory from the captured official CBBD schema.
No API keys, provider calls, schedules or database mutations.
"""
import json,pathlib,re,csv
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/cbb-provider-mission';OUT.mkdir(parents=True,exist_ok=True)
spec=json.loads((OUT/'cbbd-spec.raw').read_text())
# Each documented GET is assigned a consumer or an explicit exclusion reason.
uses={
'/venues':('catalog only','Arena metadata/context','ESPN already supplies venues; no validated venue covariate requires a second bulk copy.'),
'/teams/directory':('one-time capture','Season/team/conference register and provider-ID crosswalk','Required identity foundation; object envelope is handled separately from array feeds.'),
'/teams/{teamId}/season/{season}/overview':('not collected','Potential consolidated team page','Per-team fan-out duplicates bulk directory, ratings and leaderboard data.'),
'/teams':('wired, paused','Legacy reference job/team metadata','Prefer the explicit season directory for current identity; legacy job remains paused.'),
'/teams/roster':('one-time capture; directory job wired, paused','Cross-check ESPN rosters, source IDs, measurements and experience','Roster membership is not an injury or confirmed-active designation.'),
'/substitutions/game/{gameId}':('not collected','Potential rotation/stint research','No promoted substitution/stint model; high event volume and identity burden.'),
'/substitutions/player/{playerId}':('not collected','Potential player rotation research','Same exclusion as substitutions by game; per-player fan-out not justified.'),
'/substitutions/team':('not collected','Potential team rotation research','No validated live consumer; defer until a bounded research question exists.'),
'/stats/team/leaderboard':('one-time capture; reference job wired, paused','Team profiles, efficiency/pace/four-factor context','Bulk feed replaces per-team scans; captured fields are not automatically model coefficients.'),
'/stats/team/season':('not collected','Potential season aggregate cross-check','Bulk leaderboard and derived game/team boxes cover the current use; avoid duplicate storage.'),
'/stats/team/shooting/season':('not collected','Potential shot-zone research','No promoted shot-zone correction; requires historical pregame validation.'),
'/stats/player/season':('wired, paused','Player context, usage, minutes and separate prop research','Not captured in this recovery run; current-season stats may be empty before tipoff. Player features do not automatically change the game model.'),
'/stats/player/shooting/season':('not collected','Potential player shot-profile research','Separate prop/shot model needs validation; no automatic use in the frozen side/total model.'),
'/recruiting/players':('not collected','Potential preseason player priors','Recruiting effects and ID joins are not validated production features.'),
'/recruiting/teams':('not collected','Potential preseason team priors','Avoid double-counting talent already reflected in provider preseason ratings.'),
'/recruiting/portal':('not collected','Potential roster-change evidence','Current roster already captures membership; transfer impact requires explicit validated minutes/role treatment.'),
'/ratings/srs':('wired, paused','Reference/research comparison','Not a CBB-PRO side or total input; paused job must use season, not year.'),
'/ratings/adjusted':('one-time capture; adapter wired','Independent CBBD side comparison/confirmation','Current-season and prior-season responses are stored separately; prior is not silently relabeled current.'),
'/ratings/elo':('wired, paused','Historical comparison/baseline','No production Elo ensemble weight; stored only for a bounded research purpose.'),
'/rankings':('not collected','Potential poll context','Poll rank is not a validated incremental feature and may duplicate efficiency information.'),
'/plays/game/{gameId}':('not collected','Possession/player model research','Possession research code exists but live collection is paused; no all-games event backfill in this budget run.'),
'/plays/player/{playerId}':('not collected','Potential player event history','Per-player requests duplicate game events; not needed for the frozen game model.'),
'/plays/team':('not collected','Potential team event history','Event volume; prefer bounded game partitions only if research is authorized.'),
'/plays/date':('not collected','Potential daily event batch','Not required for the current box-score model; no recurring event ingestion.'),
'/plays/tournament':('not collected','Potential tournament research','Tournament-only data is not needed for the current operating board.'),
'/plays/types':('catalog only','Event-type dictionary','Fetch once if event ingestion is introduced; no current consumer.'),
'/lineups/team':('not collected','Potential lineup/stint impact research','No validated lineup adjustment; lineup history does not prove a future starting lineup.'),
'/lineups/game/{gameId}':('not collected','Potential game lineup evidence','No current live ingestion/consumer; roster and availability are separate concepts.'),
'/lines':('wired, paused','Historical market comparison and walk-forward evaluation','Market data stays outside independent ratings; no fresh quote collection in this capture. Historical timestamps do not automatically establish a verified close.'),
'/lines/providers':('catalog only','Sportsbook/provider dictionary','Only needed with a bounded lines capture; no recurring dictionary fetch.'),
'/games':('wired, paused','Schedule, final-score/settlement and walk-forward records','Public scoreboard currently uses ESPN; full-season requests can truncate at provider limits.'),
'/games/media':('not collected','TV/radio metadata','No projection or settlement value; skip duplicated display-only feed.'),
'/games/teams':('one-time bounded capture; native model adapter wired','Independent FBIS offense/defense, possessions, matchups, schedule and HCA','Completed pregame-available boxes only. Broad full-season loader is not proof of complete ingestion; use date partitions before production.'),
'/games/players':('wired, paused','Recent form/role and player-prop research','28-day research reader exists but is not active. Needs bounded pagination/date windows and identity checks.'),
'/scoreboard':('not collected','Potential live score alternative','ESPN public scoreboard covers this need; no second live polling loop.'),
'/draft/teams':('not collected','Draft metadata','Not a current NCAA game prediction input.'),
'/draft/positions':('not collected','Draft metadata','No current model consumer.'),
'/draft/picks':('not collected','Potential historical player pedigree','Post-college outcomes can leak future information in historical training; no validated pregame use.'),
'/conferences':('catalog only','Conference dictionary','Directory already returns season conferences; avoid duplicate copies.'),
'/conferences/history':('not collected','Potential historical membership cross-check','Existing season-specific membership registry; historical changes need a targeted reconciliation, not a new recurring feed.')}
assert set(uses)==set(p for p,x in spec['paths'].items()if 'get'in x)
def resolve(s):
 if '$ref'in s:
  x=spec
  for bit in s['$ref'].split('/')[1:]:x=x[bit]
  return x
 return s
def fields(s,prefix='',seen=()):
 ref=s.get('$ref');s=resolve(s)
 if ref and ref in seen:return [{'path':prefix,'type':'recursive '+ref}]
 seen=seen+((ref,)if ref else ())
 if 'properties'in s:
  out=[]
  for k,v in s['properties'].items():out+=fields(v,(prefix+'.'if prefix else '')+k,seen)
  if s.get('additionalProperties'):out.append({'path':prefix+'.*','type':'additionalProperties'})
  return out
 if 'items'in s:return fields(s['items'],prefix+'[]',seen)
 if 'allOf'in s:return sum((fields(v,prefix,seen)for v in s['allOf']),[])
 if 'anyOf'in s or 'oneOf'in s:return sum((fields(v,prefix,seen)for v in s.get('anyOf',s.get('oneOf',[]))),[])
 return [{'path':prefix or '$','type':s.get('type','unspecified'),'nullable':s.get('nullable',False),'enum':s.get('enum')}]
cbbd=[]
for path,item in spec['paths'].items():
 if 'get'not in item:continue
 o=item['get'];response=o.get('responses',{}).get('200',{}).get('content',{}).get('application/json',{}).get('schema',{})
 state,use,why=uses[path]
 cbbd.append({'provider':'CBBD','endpoint':path,'method':'GET','documentedAvailable':True,'accountEntitlement':'UNVERIFIED unless a successful response is recorded','status':state,'use':use,'whyOrConstraint':why,'parameters':[{'name':p['name'],'location':p['in'],'required':p.get('required',False)}for p in o.get('parameters',[])],'responseFields':fields(response),'source':'https://api.collegebasketballdata.com/api-docs.json'})
kpDefs=[
('ratings','Adjusted/raw offense and defense, tempo, net strength, luck, schedule strength, possession length, ranks and coach/context','wired; one-time capture','Side projection uses adjusted offense/defense/tempo; other fields support context/research. Rank/luck is not an extra unvalidated weight.'),
('archive','Dated and preseason ratings plus final-season comparison fields','research endpoint wired; preseason capture','Use only values known at the projection timestamp. Final fields are excluded from pregame features to prevent future leakage.'),
('four-factors','Offensive/defensive shooting, turnovers, rebounding, free-throw rates plus ratings/ranks','wired; one-time capture','Matchup evidence and shadow four-factor challenger; not an automatic change to frozen CBB-PRO coefficients.'),
('pointdist','Shares of points from free throws, twos and threes on offense/defense, ranks','wired; one-time capture','Game-page matchup context and research; not consumed directly by the frozen side gate or native total.'),
('height','Average/effective/position height, experience, bench and continuity, ranks','wired; one-time capture','Team/matchup context; not an injury feed and not a validated automatic roster adjustment.'),
('misc-stats','Two/three/free-throw percentages; blocks, steals, assists, turnovers, shot rates/distances and opponent versions, ranks','wired; one-time capture','Explanatory matchup features/research; no silent coefficient changes.'),
('fanmatch','Dated game IDs, teams, venue class, ranks, predicted scores, win probability, tempo and thrill rating','comparison adapter wired; not in this capture','A provider prediction, not independent raw performance. Use as benchmark only; API documents current/past dates rather than unrestricted future access.'),
('conf-ratings','Conference IDs/names/rank and strength rating','not collected','Native FBIS derives conference strength independently; no validated incremental use of this additional provider rating.'),
('program-ratings','Long-run program strength/ranks, best/worst/median finishes and tournament milestones','not collected','Not a validated current roster/team feature; newest-only values risk future leakage in historical backtests.'),
('teams','Season IDs, school names, conferences, coaches and arenas/cities/states','one-time capture','Provider-ID crosswalk, coach and venue metadata; IDs remain provider scoped.'),
('conferences','Season conference IDs, short and long names','not collected','Already represented in team/directory metadata; fetch if exact KenPom conference IDs become necessary.')]
doc=(OUT/'kenpom-official-docs.txt').read_text();doc=re.sub(r'^L\d+: ?','',doc,flags=re.M)
sectionNames={'ratings':'Ratings','archive':'Ratings Archive','four-factors':'Four Factors','pointdist':'Point Distribution','height':'Height','misc-stats':'Miscellaneous Stats','fanmatch':'Fanmatch','conf-ratings':'Conference Ratings','program-ratings':'Program Ratings','teams':'Teams','conferences':'Conferences'}
kenpom=[]
for e,f,st,u in kpDefs:
 match=re.search(r'^### '+re.escape(sectionNames[e])+r'\s*\n(.*?)(?=^### |\Z)',doc,re.S|re.M)
 ff=[]
 if match:
  response=match.group(1).split('#### Response Fields')[-1]
  ff=re.findall(r'^`([^`]+)`\s*\|',response,re.M)
 if e=='conferences':ff=['Season','ConfID','ConfShort','ConfLong']
 kenpom.append({'provider':'KenPom','endpoint':e,'method':'GET /api.php','availableData':f,'fieldNames':ff,'status':st,'useAndExclusion':u,'accountEntitlement':'UNVERIFIED unless a successful response is recorded','source':'https://kenpom.com/api-documentation.php'})
# Dataset families listed by the toRvik package author, not a guarantee of an official Torvik API.
torvikDefs=[
('bart_ratings','Season team adjusted ratings, efficiency, tempo, record, schedule strength, barthag and WAB','captured 365 teams','Current reference/challenger; never an input to the independent native total.'),
('bart_conf_factors','Conference aggregate four factors','not collected','Duplicates context; native conference strength is derived from game boxes.'),
('bart_factors','Team four-factor splits by date, opponent, venue and game type','captured 365 teams; CSV adapter wired','Matchup evidence/shadow model. Complex web splits are not fetched because no promoted split correction exists.'),
('bart_archive','Point-in-time T-Rank ratings','not collected','Historical as-of research only; not needed to duplicate the current snapshot.'),
('bart_season_schedule','Season fixtures, results and predictions','not collected','ESPN supplies the live schedule; CBBD supplies completed game evidence.'),
('bart_team_schedule','Single-team schedule/results','not collected','Avoid one-request-per-team duplication of the bulk schedule.'),
('bart_pregame','Pregame probability/prediction feed','not collected','Benchmark only; no unvalidated provider-prediction ensemble weight.'),
('bart_player_game','Player box scores/game logs','not collected','Use CBBD player logs for a single canonical player pipeline before adding a duplicate feed.'),
('bart_player_season','Season player advanced production, shooting, usage and efficiency','not collected','Additional source join/coverage burden; no promoted game-model coefficient uses it.'),
('bart_transfers','Transfer records/history','not collected','Roster membership is captured elsewhere; transfer impact requires validated role/minutes modeling.'),
('bart_game_box','Team game box scores','not collected','Native model uses CBBD boxes; a second copy would add reconciliation work.'),
('bart_game_factors','Per-game four-factor statistics','not collected','Derive from canonical CBBD boxes; no need for a second full history.'),
('bart_team_shooting','Team shot-location/shooting splits','not collected','Research-only shot-profile hypothesis; no promoted adjustment.'),
('bart_team_box','Aggregate/per-game team box splits','not collected','Existing canonical boxes/leaderboard cover the operating need.'),
('bart_team_history','Historical team metrics','not collected','Restore selected historical partitions for backtests; do not refill D1 with an entire duplicate history.'),
('bart_conf_stats','Conference statistics','not collected','No extra validated coefficient beyond current independent conference strength.'),
('bart_tourney_results','Tournament history/results','not collected','Not required for current-season operation; targeted backtest only.'),
('bart_tourney_sheets','Tournament committee profiles','not collected','Selection context is not a validated betting feature.'),
('bart_tourney_odds','Tournament probability estimates','not collected','Different target market and provider model; no tournament wagering model is authorized.'),
('bart_coach','Coaching history and recruit context','not collected','Current coach metadata comes from team feeds; historical coach effects are not validated.'),
('bart_coach_change','Head-coach changes','not collected','Potential manual context; no automatic additive coaching effect.'),
('bart_injuryimpact','Estimated effect of removing a player','not collected','An estimated model effect is not a verified injury/availability report. Do not label it as one.'),
('bart_poy','Player-of-year model ratings','not collected','Award model does not establish per-game value or an approved player-prop edge.')]
torvik=[{'provider':'Torvik/toRvik','dataset':n,'availableData':f,'status':s,'useAndExclusion':u,'access':'Documented scraper surface; live availability/permission not certified unless captured','source':'https://torvik.sportsdataverse.org/reference/index.html'}for n,f,s,u in torvikDefs]
web=[{'surface':x,'status':'not automatically collected','why':'Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.'}for x in ['Player season/advanced stats and biographies','Player game logs and conference/top-opponent splits','Minutes matrix, starts, depth charts and lineup usage','Box scores, DNP records and win-probability charts','Future FanMatch website schedule/predictions','Team and coach historical pages','Home-court ratings','Referee/officiating ratings','Jump-ball ratings','Arena capacity','D-I statistical trends and conference selections']]
result={'project':'FBIS CBB only','season':2027,'scope':'All 40 documented CBBD GET endpoints; all 11 documented KenPom API endpoints; 23 toRvik author-documented data families; additional KenPom member-page surfaces. This is a catalog of documented surfaces, not a promise of account entitlement or every undocumented web table.','recurringCollectors':'PAUSED','cloudflareMonthlyCeilingUsd':10,'kenpom':kenpom,'cbbd':cbbd,'torvik':torvik,'kenpomWebOnly':web}
if (OUT/'capture-summary.json').exists():
 result['verifiedCapture']=json.loads((OUT/'capture-summary.json').read_text())
 actual={r['provider']+':'+r['name']:r for r in result['verifiedCapture']['records']}
 endpointNames={'/teams/directory':'directory','/teams/roster':'roster','/ratings/adjusted':'adjusted-current','/stats/team/leaderboard':'team-leaderboard','/games/teams':'game-teams-current'}
 for e in result['kenpom']:
  if 'kenpom:'+e['endpoint'] in actual:
   r=actual['kenpom:'+e['endpoint']];e['latestCapture']=r;e['accountEntitlement']='VERIFIED HTTP '+str(r['status'])+' for this requested feed/season';e['status']='captured '+str(r['rows'])+' rows in one-time runtime run; recurring collector paused'
 for e in result['cbbd']:
  key='cbbd:'+endpointNames.get(e['endpoint'],'')
  if key in actual:
   r=actual[key];e['latestCapture']=r;e['accountEntitlement']='VERIFIED HTTP '+str(r['status'])+' for this request';e['status']='captured '+str(r['rows'])+' response records in one-time runtime run; recurring collector paused'
 result['coverage']=json.loads((OUT/'coverage-report.json').read_text())
 result['rosterDiscrepancies']=json.loads((OUT/'roster-reconciliation.json').read_text())
 result['currentModelReady']=False
(OUT/'provider-inventory.json').write_text(json.dumps(result,indent=2))
with (OUT/'cbbd-field-dictionary.csv').open('w')as f:
 w=csv.writer(f);w.writerow(['endpoint','field','type','nullable','enum'])
 for e in cbbd:
  for field in e['responseFields']:w.writerow([e['endpoint'],field['path'],field['type'],field.get('nullable'),json.dumps(field.get('enum'))])
print(json.dumps({'CBBDendpoints':len(cbbd),'CBBDfieldEntries':sum(len(e['responseFields'])for e in cbbd),'KenPomEndpoints':len(kenpom),'TorvikFamilies':len(torvik),'jsonBytes':(OUT/'provider-inventory.json').stat().st_size}))
