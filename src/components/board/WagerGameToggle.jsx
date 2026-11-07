import {hasLinkedWager,hasRecordedWager} from '../../lib/gameCardOrder.js';
export default function WagerGameToggle({game,marked,onToggle}){
 const linked=hasLinkedWager(game),active=hasRecordedWager(game,marked);
 return <button type="button" className="wager-game-toggle" aria-pressed={active} disabled={linked}
  onClick={()=>onToggle(game)} aria-label={(linked?'Executed wager linked to ':active?'Remove existing wager mark for ':'Mark existing wager on ')+(game.away?.name||'Away')+' at '+(game.home?.name||'Home')}
  title={linked?'Linked executed wager':active?'Remove this display mark; this does not cancel a wager.':'Mark a wager you already placed. This does not place a wager.'}
  style={{display:'block',width:'100%',minHeight:40,padding:'8px 12px',border:'1px solid '+(active?'#b79549':'#29394d'),borderRadius:8,background:active?'#302815':'#0b1825',color:active?'#fbd279':'#e5e7eb',fontSize:16,fontFamily:'inherit',textAlign:'left',cursor:linked?'default':'pointer',marginBottom:6}}>
  {linked?'Wager linked':active?'Wager marked · Remove mark':'Mark existing wager'}
 </button>;
}
