import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module from 'node:module';
import {buildRows} from '../functions/api/player-props.js';
const compiled=await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Compact from './src/components/board/CompactGameCard.jsx'; import Premium from './src/components/board/PremiumGameCard.jsx'; import Signals from './src/components/board/MatchupSignals.jsx'; export function render(kind,game){return renderToStaticMarkup(React.createElement(kind==='signals'?Signals:kind==='compact'?Compact:Premium,{game,away:game.away,home:game.home,sport:game.sport}));}`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const bundled=new Module(process.cwd()+'/test/unified-card-render.bundle.cjs');
bundled._compile(compiled.outputFiles[0].text,process.cwd()+'/test/unified-card-render.bundle.cjs');
const {render}=bundled.exports;
const game=sport=>({id:`event-${sport}`,sport,start:'2026-10-14T20:00:00Z',home:{name:'Home Team',abbr:'HOM',color:'123456',secondaryColor:'abcdef'},away:{name:'Away Team',abbr:'AWY',color:'abcdef'},matchupFactors:[{id:'form',label:'Recent Form',edge:'HOME',available:true,value:'2.1'}]});
test('compact and featured team sports share matchup visuals and event prop expansion',()=>{
 for(const sport of ['nfl','cfb','nba','cbb','wnba','mlb','nhl','soccer','npb','kbo'])for(const kind of ['compact','premium']){
  const html=render(kind,game(sport));
  assert.match(html,/fbis-universal-premium/,`${sport} ${kind}`);
  assert.match(html,/PLAYER PROPS/,`${sport} ${kind}`);
  assert.match(html,/MARKET DETAILS/,`${sport} ${kind}`);
  assert.match(html,/GAME MATCHUP/,`${sport} ${kind}`);
 }
});
test('sparse and unavailable factors do not acquire an invented advantage or fixed five signals',()=>{
 const g=game('nba');g.matchupFactors=[{id:'form',label:'Form',edge:'HOME',available:false,value:15}];
 const html=render('signals',g);assert.match(html,/1 SIGNALS/);assert.match(html,/N\/A/);assert.doesNotMatch(html,/is-team-branded|>15<|5 SIGNALS/);
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
 const unsupported=await onRequestGet(context('https://fbis.test/api/player-props?eventIds=g&sport=soccer'));
 assert.equal((await unsupported.json()).diagnostics.absenceReason,'UNSUPPORTED_PROP_SPORT');
});
test('empty prop API reports blocked acquisition rather than claiming that the provider has no markets',async()=>{
 const {onRequestGet}=await import('../functions/api/player-props.js');
 const db={prepare(sql){return{bind(){return{async all(){return{results:[]}}}},async all(){return{results:sql.includes('external_acquisition_policy')?[{source:'prizepicks',state:'BLOCKED',reason:'ACCOUNT_RESTRICTED',account_state:'BLOCKED',account_reason:'APIFY_USAGE_LIMIT_REACHED'}]:[]}}}}};
 const response=await onRequestGet({env:{DB:db},request:new Request('https://fbis.test/api/player-props?eventIds=g&sport=nhl')});
 const body=await response.json();assert.equal(body.ok,true);assert.equal(body.diagnostics.absenceReason,'ACQUISITION_BLOCKED');assert.equal(body.diagnostics.sourceStatus[0].reason,'APIFY_USAGE_LIMIT_REACHED');
});
