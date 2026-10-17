import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module from 'node:module';
import {buildRows} from '../functions/api/player-props.js';
const compiled=await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Compact from './src/components/board/CompactGameCard.jsx'; import Premium from './src/components/board/PremiumGameCard.jsx'; import Signals from './src/components/board/MatchupSignals.jsx'; import Venue from './src/components/board/VenueConditions.jsx'; import Factors from './src/components/board/MatchupFactors.jsx'; export function render(kind,game){return renderToStaticMarkup(React.createElement(kind==='factors'?Factors:kind==='venue'?Venue:kind==='signals'?Signals:kind==='compact'?Compact:Premium,{game,away:game.away,home:game.home,sport:game.sport,context:game.context}));}`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const bundled=new Module(process.cwd()+'/test/unified-card-render.bundle.cjs');
bundled._compile(compiled.outputFiles[0].text,process.cwd()+'/test/unified-card-render.bundle.cjs');
const {render}=bundled.exports;
const game=sport=>({id:`event-${sport}`,sport,start:'2026-10-14T20:00:00Z',home:{name:'Home Team',abbr:'HOM',color:'123456',secondaryColor:'abcdef'},away:{name:'Away Team',abbr:'AWY',color:'abcdef'},matchupFactors:[{id:'form',label:'Recent Form',edge:'HOME',available:true,value:'2.1'}]});
test('compact and featured team sports share matchup visuals and event prop expansion',()=>{
 for(const sport of ['nfl','cfb','nba','cbb','wnba','mlb','nhl','soccer','npb','kbo']){
  const compact=render('compact',game(sport));
  const premium=render('premium',game(sport));
  assert.match(compact,/fbis-universal-premium/,`${sport} compact`);
  assert.match(premium,/fbis-universal-premium/,`${sport} premium`);
  // SoftMatch: prop/market expansion and matchup tiles live on featured cards; compact stays lean.
  assert.match(premium,/PLAYER PROPS/,`${sport} premium`);
  assert.match(premium,/MARKET DETAILS/,`${sport} premium`);
  assert.match(premium,/GAME MATCHUP/,`${sport} premium`);
 }
});
test('sparse and unavailable factors do not acquire an invented advantage or fixed five signals',()=>{
 const g=game('nba');g.matchupFactors=[{id:'form',label:'Form',edge:'HOME',available:false,value:15}];
 const html=render('signals',g);assert.match(html,/0 of 1 factors available/);assert.match(html,/AWAITING MATCHUP DATA/);assert.doesNotMatch(html,/is-team-branded|>15<|5 SIGNALS/);
 assert.match(render('signals',{...g,matchupFactors:[]}),/AWAITING MATCHUP DATA/);
});
test('tennis featured card keeps its specialized interface without the new prop panel',()=>{
 const html=render('premium',game('tennis'));assert.doesNotMatch(html,/event-player-props/);
});
test('prop pairing preserves distinct lines and periods and never fabricates independent projections',()=>{
 const rows=[['full_game',10.5,'over',-110],['full_game',11.5,'under',-115],['first_half',10.5,'under',-120]].map(([market_period,line,selection,american_price])=>({sport:'nba',canonical_event_id:'g',canonical_player_id:'p',market_type:'points',market_period,line,selection,american_price,sportsbook:'book',collected_at:'2026-10-13T16:00:00Z'}));
 const out=buildRows(rows,new Map());assert.equal(out.length,3);
 assert.ok(out.every(r=>!(r.overOdds&&r.underOdds)));assert.ok(out.every(r=>r.fbisProjection==null));
});

test('prop API rejects oversized batches explicitly and reports unsupported sports',async()=>{
 const {onRequestGet}=await import('../functions/api/player-props.js');
 const context=url=>({env:{DB:{prepare(){throw Error('must not query')}}},request:new Request(url)});
 const tooLarge=await onRequestGet(context('https://fbis.test/api/player-props?eventIds='+Array.from({length:81},(_,i)=>i).join(',')));
 assert.equal(tooLarge.status,400);assert.equal((await tooLarge.json()).error,'EVENT_BATCH_TOO_LARGE');
 const unsupported=await onRequestGet(context('https://fbis.test/api/player-props?eventIds=g&sport=volleyball'));
 assert.equal((await unsupported.json()).diagnostics.absenceReason,'UNSUPPORTED_PROP_SPORT');
});
test('empty prop API reports blocked acquisition rather than claiming that the provider has no markets',async()=>{
 const {onRequestGet}=await import('../functions/api/player-props.js');
 const db={prepare(sql){return{bind(){return{async all(){return{results:[]}}}},async all(){return{results:sql.includes('external_acquisition_policy')?[{source:'prizepicks',state:'BLOCKED',reason:'ACCOUNT_RESTRICTED',account_state:'BLOCKED',account_reason:'APIFY_USAGE_LIMIT_REACHED'}]:[]}}}}};
 const response=await onRequestGet({env:{DB:db},request:new Request('https://fbis.test/api/player-props?eventIds=g&sport=nhl')});
 const body=await response.json();assert.equal(body.ok,true);assert.equal(body.diagnostics.absenceReason,'ACQUISITION_BLOCKED');assert.equal(body.diagnostics.sourceStatus[0].reason,'APIFY_USAGE_LIMIT_REACHED');
});

test('full team cards suppress empty ACTION, show honest factor counts, and share dynamic venue conditions',()=>{
 for(const sport of ['nfl','cfb','nba','cbb','wnba','mlb','nhl','soccer','npb','kbo']) {
  const g={...game(sport),venue:{name:'Test Stadium'},weather:{temperature:52.9,windSpeed:6.1,description:'Clear',at:'2026-10-17T16:00:00Z'}};
  for(const kind of ['premium','compact']) {
   const html=render(kind,g);
   assert.match(html,/venue-weather theme-sun/,sport+kind);
   assert.match(html,/Test Stadium/);assert.match(html,/53°F/);assert.match(html,/6.1/);assert.match(html,/Forecast for/);
   assert.doesNotMatch(html,/ACTION market intelligence|NO MOVE YET/);
  }
 }
});
test('indoor games exclude outdoor wind and temperature; unknown weather never gets a sunshine icon',()=>{
 const indoor=render('venue',{indoor:true,context:{venueLabel:'Arena',weather:{temp:90,wind:25,description:'Clear'}}});
 assert.match(indoor,/INDOORS/);assert.doesNotMatch(indoor,/90°F|25.0|theme-sun|vw-wind/);
 const unknown=render('venue',{context:{venueLabel:'Stadium',weather:{temp:null,wind:null,description:null}}});
 assert.match(unknown,/theme-unknown/);assert.match(unknown,/Weather unavailable/);assert.doesNotMatch(unknown,/0°F|theme-sun/);
});

test('opening a team card preserves team brand colors and decorative logo watermarks',()=>{
 for(const sport of ['nfl','cfb','nba','cbb','wnba','mlb','nhl','soccer','npb','kbo']) {
  const g=game(sport);g.away.logo='https://example.com/away.png';g.home.logo='https://example.com/home.png';
  const html=render('premium',g);
  assert.match(html,/pgc-team-atmosphere/);assert.match(html,/--cgc-away-brand:#abcdef/);assert.match(html,/--cgc-home-brand:#123456/);
  assert.match(html,/pgc-team-watermark-away/);assert.match(html,/pgc-team-watermark-home/);
 }
});

test('analysis uses actual CFB source comparisons when model explanation inputs are missing',()=>{
 const g=game('cfb');g.home.abbr='IU';g.away.abbr='OSU';
 g.matchupFactors=[{id:'passing',label:'Pass offense vs pass defense',edge:'UNAVAILABLE',available:false}];
 g.cfbDirectionalResearch={authority:'RESEARCH_DISPLAY_ONLY',season:2026,week:7,rows:
 ['away-run-defense','away-run-offense','away-pass-defense','away-pass-offense'].map(id=>({id,cfbdDifference:.337,sdvDifference:.648,disagreement:false}))};
 const html=render('factors',g);
 assert.match(html,/4 available · 1 pending/);assert.match(html,/0.337 EPA\/play/);assert.match(html,/0.648 EPA\/play/);
 assert.match(html,/IU passing offense minus OSU passing defense allowed/);
 assert.match(html,/SOURCE COMPARISON · NOT MODEL ATTRIBUTION/);assert.match(html,/is-team-branded/);assert.match(html,/matchup-factor-synopsis/);
 assert.doesNotMatch(html,/Required explanatory inputs unavailable/);
});
test('analysis missing source evidence never becomes a fabricated comparison',()=>{
 const g=game('cfb');g.matchupFactors=[{id:'passing',edge:'UNAVAILABLE',available:false}];
 const html=render('factors',g);assert.match(html,/0 available · 1 pending/);assert.doesNotMatch(html,/EPA\/play|is-team-branded/);
});
