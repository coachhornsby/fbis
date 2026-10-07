import test from 'node:test';import assert from 'node:assert/strict';
import {parseTmlCsv} from '../tennis/sources/tennismylife.js';
import {canonicalToMeltedRows} from '../tennis/canonicalMatchObservation.js';
import {reconcileObservations} from '../tennis/tennisObservationReconcile.js';
import {buildIndex} from '../tennis/tennisFeatureBuilder.js';
const H='tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_id,winner_name,winner_rank,loser_id,loser_name,loser_rank,score,best_of,round,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced';
const R='2026-1,Test Open,Hard,A,20261001,1,A1,Alpha One,20,B1,Beta Two,80,6-4 6-4,3,R32,8,2,60,35,28,14,10,3,4,3,4,58,34,20,10,10,4,6';
test('TML adapter maps all observed service fields and provenance without fabrication',()=>{const [o]=parseTmlCsv(H+'\n'+R,{sourceFile:'tml_atp_2026.csv',sourceCommit:'abc'});
 assert.deepEqual({ace:o.winner.ace,df:o.winner.df,svpt:o.winner.svpt,firstIn:o.winner.firstIn,firstWon:o.winner.firstWon,secondWon:o.winner.secondWon,svGms:o.winner.svGms,bpSaved:o.winner.bpSaved,bpFaced:o.winner.bpFaced},{ace:8,df:2,svpt:60,firstIn:35,firstWon:28,secondWon:14,svGms:10,bpSaved:3,bpFaced:4});
 assert.deepEqual({ace:o.loser.ace,df:o.loser.df,svpt:o.loser.svpt,firstIn:o.loser.firstIn,firstWon:o.loser.firstWon,secondWon:o.loser.secondWon,svGms:o.loser.svGms,bpSaved:o.loser.bpSaved,bpFaced:o.loser.bpFaced},{ace:3,df:4,svpt:58,firstIn:34,firstWon:20,secondWon:10,svGms:10,bpSaved:4,bpFaced:6});
 assert.equal(o.provenance.sourceCommit,'abc');assert.match(o.sourceMatchId,/2026-1/);
});
test('TML adapter preserves missing service values as null and complete-line hasStats gate fails closed',()=>{const cells=R.split(',');cells[H.split(',').indexOf('w_df')]='';const [o]=parseTmlCsv(H+'\n'+cells.join(','));assert.equal(o.winner.df,null);assert.equal(canonicalToMeltedRows(o)[0].hasStats,false);});
test('reconciliation deduplicates identity, audits disagreement, and uses authority',()=>{const [a]=parseTmlCsv(H+'\n'+R,{source:'tml'});const b=structuredClone(a);b.source='sackmann';b.sourceMatchId='s2';b.winner.ace=7;const x=reconcileObservations([a,b],{authority:{tml:2,sackmann:1}});assert.equal(x.observations.length,1);assert.equal(x.audit.duplicateObservations,1);assert.ok(x.audit.fieldDisagreements>=1);assert.equal(x.observations[0].winner.ace,8);});
test('canonical observations build a player index with overall and surface Elo',()=>{const [o]=parseTmlCsv(H+'\n'+R);const idx=buildIndex(canonicalToMeltedRows(o));assert.equal(idx.meta.players,2);assert.ok(idx.players.A1.elo>1500);assert.ok(idx.elo.bySurface.Hard.A1.n,1);});

test('incomplete service lines fail closed and unknown surface is not coerced to Hard',()=>{const [o]=parseTmlCsv(H+'\n'+R);o.winner.df=null;o.surface='Unknown';const rows=canonicalToMeltedRows(o);assert.equal(rows[0].hasStats,false);const idx=buildIndex(rows);assert.equal(idx.players.A1.surfaces.Hard,undefined);assert.ok(idx.players.A1.surfaces.ALL);});

test('score disagreement reconciles as one match and is audited instead of double-counted',()=>{const [a]=parseTmlCsv(H+'\n'+R,{source:'tml'});const b=structuredClone(a);b.source='other';b.sourceMatchId='other-1';b.score='6-3 6-4';const x=reconcileObservations([a,b],{authority:{tml:2,other:1}});assert.equal(x.observations.length,1);assert.equal(x.audit.byField['match.score'].disagreed,1);assert.equal(x.audit.crossSourceDuplicates,1);});
