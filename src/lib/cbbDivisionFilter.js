// Display scope only: division evidence is independent of model or market coverage.
import teams from '../../data/teams/cbb.js';
const byEspnId=new Map(teams.map(team=>[String(team.espnId),team]));
function normalizedDivision(value){
 const v=String(value||'').trim().toUpperCase().replace(/[\s_-]+/g,'');
 return ['D1','DI','DIVISION1','DIVISIONI','NCAAD1','NCAADI'].includes(v)?'D1':null;
}
export function cbbTeamDivision(team){
 const id=String(team?.espnId||'');
 const known=byEspnId.get(id);
 if(known?.classification==='D1')return 'D1';
 // A source may identify a new entrant before our canonical registry is updated.
 // Names, conference labels, odds and projection availability are not evidence.
 if(normalizedDivision(team?.classification))return 'D1';
 return 'UNVERIFIED';
}
export function cbbDivisionScope(games=[]){
 const visible=[],unverified=[];
 for(const game of games){
  if(game.sport!=='cbb'||(cbbTeamDivision(game.home)==='D1'&&cbbTeamDivision(game.away)==='D1'))visible.push(game);
  else unverified.push(game);
 }
 return {games:visible,unverified};
}
