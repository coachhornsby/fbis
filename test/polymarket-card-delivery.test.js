import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import Module from 'node:module';
const compiled=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Compact from './src/components/board/CompactGameCard.jsx';import Prices from './src/components/board/MoneylinePriceComparison.jsx';export const render=(game,compact)=>renderToStaticMarkup(React.createElement(compact?Compact:Prices,{game}));`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const bundled=new Module(process.cwd()+'/test/poly-card.cjs');bundled._compile(compiled.outputFiles[0].text,process.cwd()+'/test/poly-card.cjs');const {render}=bundled.exports;
const game={id:'game',sport:'nfl',home:{name:'Home Team',abbr:'HOM'},away:{name:'Away Team',abbr:'AWY'},pHome:.62,start:new Date(Date.now()+86400000).toISOString()};
const quote={source:'Polymarket US WebSocket',side:'home',period:'full_game',marketFamily:'moneyline',contractPrice:.6,sourceObservedAt:new Date().toISOString(),raw:{bestAsk:.6,bestBid:.58,marketState:'MARKET_STATE_OPEN',offers:[{price:.6,quantity:50}]}};
test('Polymarket quotes add no compact-card markup or new visual panels',()=>{
 assert.equal(render(game,true),render({...game,market:{venueOffers:[quote]}},true));
});
test('expanded priceboard shows implied American conversion and explicit unverified decision reason',()=>{
 const html=render({...game,market:{venueOffers:[quote]}},false);
 assert.match(html,/-150/);assert.match(html,/Implied American/);assert.match(html,/BUY \/ SELL/);assert.match(html,/VERIFY/);assert.match(html,/Settlement equivalence unverified/);assert.match(html,/BREAK-EVEN/);
});
test('quote endpoint rejects oversized event batches before reading storage',async()=>{
 const {onRequestGet}=await import('../functions/api/polymarket-quotes.js');
 const res=await onRequestGet({request:new Request('https://example.test/api/polymarket-quotes?sport=nfl&eventIds='+Array.from({length:41},(_,i)=>'g'+i).join(',')),env:{DB:{prepare(){throw Error('should not query')}}}});
 assert.equal(res.status,400);
});
