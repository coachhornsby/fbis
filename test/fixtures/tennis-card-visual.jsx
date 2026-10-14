import React from 'react';
import { createRoot } from 'react-dom/client';
import TennisMatchCard from '../../src/components/board/TennisMatchCard.jsx';
import { simulateTennisV2 } from '../../functions/lib/tennisFbisV2.js';
const blocked=new URLSearchParams(location.search).get('blocked')==='1';
const long=new URLSearchParams(location.search).get('long')==='1';
const p=(name,s)=>({name,historyMatches:30,surfaceMatches:15,firstServeIn:.62,firstServeWin:s,secondServeWin:.5,servePointWin:.61,returnPointWin:.4,returnFirstWin:.3,returnSecondWin:.5,aceRate:.05,doubleFaultRate:.04,bpSaveRate:.6,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,bpCreatePerReturnGame:.3,bpConvertRate:.4,aceAllowedRate:.05,dfReceivedRate:.04});
const home={name:'Liudmila Samsonova',countryCode:'RUS',rank:43,rankingPoints:1229};
const away={name:long?'Guiomar Maristany Zuleta De Reales':'Elina Svitolina',countryCode:'UKR',rank:6,rankingPoints:5024};
const model=simulateTennisV2({id:'VISUAL_TEST_ONLY',tour:'wta',surface:'hard',bestOf:3,player1:p(home.name,.65),player2:p(away.name,.69)},{},{seed:'VISUAL_TEST_ONLY',simulations:1500});
const game={id:'VISUAL_TEST_ONLY',sport:'tennis',tour:'WTA',home,away,start:new Date(Date.now()+86400000).toISOString(),publicationStatus:'RESEARCH_TEST',modelId:model.modelId,modelVersion:model.modelVersion,
 tennisProjection:{eventIntegrity:{valid:true},player1WinProb:blocked?null:model.match.pPlayer1Win,player2WinProb:blocked?null:model.match.pPlayer2Win,decisionTimestamp:new Date().toISOString(),projectedTotalGames:model.match.totalGames.mean,tournament:'Test Open',surface:'hard',blockedReason:'OFFICIAL_EVENT_MISSING',playerBank:{players:[{recentForm:[{result:'W'},{result:'L'}]},{recentForm:[{result:'W'},{result:'W'}]}]}},market:{reference:{observedAt:new Date().toISOString(),noVig:{home:.46,away:.54},moneyline:{home:105,away:-125},spreadDetail:{home:1.5,away:-1.5,homePrice:-110,awayPrice:-110},totalDetail:{line:22.5,overPrice:-105,underPrice:-115}}}};
createRoot(document.getElementById('root')).render(<div style={{maxWidth:1400,margin:'auto',padding:12}}><p style={{fontSize:12,color:'#abc'}}>VISUAL TEST FIXTURE · Not a production prediction</p><TennisMatchCard game={game}/></div>);
