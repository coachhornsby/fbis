// Settlement propagation only. This never changes entry terms or wager authority.
export function executedCardId(bet) {
  let metadata={};try{metadata=JSON.parse(bet.tracker_metadata_json||'{}');}catch{}
  const explicit=metadata.cardId || (/^PP-\d{8}-[A-Z0-9]+$/.test(bet.external_ticket_id||'')?bet.external_ticket_id:null);
  return explicit || String(metadata.notes||'').match(/\bCard\s+(PP-\d{8}-[A-Z0-9]+)\b/)?.[1] || null;
}
export async function syncPlayerPropCardSettlements(db) {
  const cards=(await db.prepare("SELECT * FROM player_prop_cards WHERE status='SETTLED' AND result IN ('WON','LOST') AND profit IS NOT NULL").all()).results||[];
  const byId=new Map(cards.map(c=>[c.card_id,c]));
  const bets=(await db.prepare("SELECT * FROM executed_bets WHERE execution_book='PrizePicks' AND market='PLAYER_PROP' AND result='OPEN'").all()).results||[];
  let synchronized=0;const conflicts=[];
  for(const bet of bets){
    const card=byId.get(executedCardId(bet));if(!card)continue;
    if(bet.date!==card.date || Number(bet.risk_amount)!==Number(card.risk)){conflicts.push(bet.id);continue;}
    const legs=(await db.prepare('SELECT leg_id,event_id,player_name,market,entry_line,actual,result,stat_source FROM player_prop_legs WHERE card_id=?').bind(card.card_id).all()).results||[];
    if(!legs.length || !legs.every(l=>['WON','LOST','PUSH','VOID'].includes(l.result))) {conflicts.push(bet.id);continue;}
    const evidence=JSON.stringify({cardId:card.card_id,settledAt:card.settled_at,legs});
    const result=await db.batch([
      db.prepare("INSERT INTO executed_bet_audit(bet_id,action,detail,created_at) SELECT id,'card-settlement',?,datetime('now') FROM executed_bets WHERE id=? AND result='OPEN'").bind(evidence,bet.id),
      db.prepare("UPDATE executed_bets SET result=?,profit=?,settled_return=?,graded_at=?,settlement_source='PLAYER_PROP_CARD_LEDGER',settlement_evidence_json=? WHERE id=? AND result='OPEN'").bind(card.result,card.profit,Number(card.risk)+Number(card.profit),card.settled_at,evidence,bet.id)
    ]);
    synchronized+=Number(result?.[1]?.meta?.changes||0);
  }
  return {synchronized,conflicts};
}
