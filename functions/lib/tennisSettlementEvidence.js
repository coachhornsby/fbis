// Fail-closed evaluation of an immutable Tennis v2 decision against official result evidence.
// Pure function: never writes, promotes, or authorizes wagers.
const norm = v => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ms = v => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
const prob = v => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 1 ? Number(v) : null;
const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const fail = reason => ({eligible:false,reason});

// A final result is not proof of normal moneyline settlement. Explicit retirements,
// walkovers and ambiguous terminal scorelines must stay ungraded.
export function normalTennisFinish(e) {
  if (String(e?.completion_state || '').toUpperCase() !== 'FINAL') return false;
  const reason = String(e?.result_reason || '').toUpperCase();
  const score = String(e?.score_text || '').trim();
  if (!score || /RET|W\/O|WALKOVER|DEFAULT|DEF\.|ABANDON|CANCEL|SUSPEND|INCOMPLETE|DISQUAL|MTO/i.test(`${reason} ${score}`)) return false;
  // WTA's MatchState 'F' proves terminal status, not normal settlement.
  // Require independently mapped normal-completion evidence and a complete score.
  if (!['NORMAL','COMPLETED_NORMAL','FINISHED_NORMAL'].includes(reason)) return false;
  const sets = [...score.matchAll(/(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?=\s|$|\()/g)].map(x => [Number(x[1]),Number(x[2])]);
  if (sets.length < 2 || sets.length > 5) return false;
  let a=0,b=0;
  for (const [x,y] of sets) {
    if (!(Math.max(x,y)>=6 && (Math.abs(x-y)>=2 || (Math.max(x,y)===7 && Math.min(x,y)===6)))) return false;
    if(x>y)a++; else if(y>x)b++; else return false;
  }
  return Math.max(a,b)>=2 && a!==b && ((a>=3 || b>=3) || sets.length<=3);
}

export function evaluateTennisSettlement(decision,event,closings=[],{minEdge=.02}={}) {
  if (!decision?.canonical_event_id || !event?.match_id) return fail('OFFICIAL_RESULT_MISSING');
  if (!['WTA_OFFICIAL','ATP_OFFICIAL'].includes(event.source) || norm(decision.tour)!==norm(event.tour)) return fail('OFFICIAL_RESULT_SOURCE_UNVERIFIED');
  if (!event.source_match_id || !event.player1_id || !event.player2_id || event.player1_id===event.player2_id) return fail('OFFICIAL_RESULT_IDENTITY_MISSING');
  const proof=parse(decision.context_json)?.eventProof;
  if (!proof || proof.matchId!==event.match_id || proof.source!==event.source || proof.player1Id!==event.player1_id || proof.player2Id!==event.player2_id) return fail('DECISION_EVENT_PROOF_MISMATCH');
  if(norm(proof.surface)!==norm(event.surface) || norm(proof.tournament)!==norm(event.tournament_name)) return fail('DECISION_EVENT_CONTEXT_MISMATCH');
  const start=ms(event.match_time),cutoff=ms(decision.decision_timestamp),snapshot=ms(decision.event_start_time),observed=ms(proof.observedAt);
  if (![start,cutoff,snapshot,observed].every(Number.isFinite) || start!==snapshot || ms(proof.startTime)!==start || observed>cutoff || cutoff>=start) return fail('DECISION_PIT_PROOF_INVALID');
  const p1=prob(decision.pure_p1),entry=prob(decision.market_prior_p1);
  if (p1===null || entry===null || !Number.isFinite(Number(decision.model_edge))) return fail('DECISION_PROBABILITY_MISSING');
  if (!normalTennisFinish(event)) return fail('RESULT_SETTLEMENT_UNVERIFIED');
  if (![event.player1_id,event.player2_id].includes(event.winner_id)) return fail('OFFICIAL_WINNER_UNVERIFIED');
  const winnerP1=event.winner_id===event.player1_id;
  const selectedP1=Math.abs(Number(decision.model_edge))>=minEdge ? Number(decision.model_edge)>0 : null;
  const market=parse(decision.market_json)||{};
  const quotes=Array.isArray(market.quotes)?market.quotes:[];
  const quoted=quotes.filter(q => Number.isFinite(ms(q.observedAt)) && ms(q.observedAt)<=cutoff && ms(q.observedAt)<start && (q.book||q.source));
  const anchor=quoted.find(q=>norm(q.book)==='pinnacle')||quoted[0];
  const price=selectedP1===null?null:Number(selectedP1?anchor?.p1Price:anchor?.p2Price);
  const validPrice=anchor && Number.isFinite(price) && (price>=100 || price<=-100);
  const units=selectedP1===null||!validPrice?null:(selectedP1===winnerP1?(price>0?price/100:100/Math.abs(price)):-1);
  const compatible=(closings||[]).filter(c => c?.canonical_event_id===decision.canonical_event_id
    && norm(c.tour)===norm(decision.tour) && norm(c.player1)===norm(decision.player1) && norm(c.player2)===norm(decision.player2)
    && c.market_type==='moneyline' && prob(c.player1_no_vig_prob)!==null
    && Number.isFinite(ms(c.observed_at)) && ms(c.observed_at)>=cutoff && ms(c.observed_at)<start
    && Number.isFinite(ms(c.collected_at)) && ms(c.collected_at)<start
    && c.snapshot_type!=='LIVE');
  compatible.sort((a,b)=>ms(b.observed_at)-ms(a.observed_at));
  const closing=compatible[0]||null;
  const closeP1=closing?prob(closing.player1_no_vig_prob):null;
  const clv=selectedP1===null||closeP1===null?null:(selectedP1?closeP1-entry:entry-closeP1);
  return {eligible:true,reason:null,winnerP1,winner: winnerP1?decision.player1:decision.player2,
    selectedP1,price:validPrice?price:null,profitUnits:units,closingP1:closeP1,clv,
    marketEvidence:closing?.id||null,resultEvidence:event.match_id,
    governance:{researchOnly:true,canQualify:false,canAuthorizeWager:false,bet:false}};
}
