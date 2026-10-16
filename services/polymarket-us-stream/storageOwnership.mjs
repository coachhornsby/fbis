/** WebSocket-only, non-wager research observation storage ownership.
 * The primary D1 remains owner of games, models, CLV, executed bets, and
 * historic canonical references. No implicit fallback on a broken shard binding.
 */
export function resolveMarketStreamWriteTarget(env){
 const setting=String(env?.MARKET_HISTORY_WS_WRITE_OWNER||"primary").toLowerCase();
 if(setting==="primary"){
  if(!env?.DB?.prepare)throw Error("MARKET_WS_PRIMARY_DB_UNBOUND");
  return {db:env.DB,writeOwner:"PRIMARY_D1",isShard:false};
 }
 if(setting==="shard"){
  if(!env?.MARKET_HISTORY_DB?.prepare)throw Error("MARKET_WS_HISTORY_SHARD_UNBOUND");
  if(env?.MARKET_HISTORY_SHADOW_WS==="enabled")throw Error("MARKET_WS_INCOMPATIBLE_DUAL_MIRROR_FLAGS");
  return {db:env.MARKET_HISTORY_DB,writeOwner:"SHARD_WS_RESEARCH_ONLY",isShard:true};
 }
 throw Error("MARKET_WS_UNKNOWN_WRITE_OWNER");
}
