// tennisClassify — grades a prop into a verdict {tier, reason} the UI displays.
// Called as tennisClassify({market, lean, line, prob, mean, surfaceN, rankGap, recentRetirement}).
export function tennisClassify({ market, lean, line, prob, mean, surfaceN, rankGap, recentRetirement }) {
  const reasons = [];
  let tier;
  if (prob >= 0.68) tier = 'strong';
  else if (prob >= 0.60) tier = 'lean';
  else tier = 'coinflip';
  // downgrade on thin surface sample or retirement risk
  if (surfaceN != null && surfaceN < 20) { if (tier === 'strong') tier = 'lean'; reasons.push('thin surface sample'); }
  if (recentRetirement) { tier = 'coinflip'; reasons.push('recent retirement — volatile'); }
  if (mean != null && line != null) {
    const gap = Math.abs(mean - line);
    if (gap >= 2.5) reasons.push(`projection ${gap.toFixed(1)} off the line`);
  }
  return { tier, reason: reasons.join('; ') };
}
export function classifyProp(prob, edgeSds) {
  if (prob >= 0.70 && edgeSds != null && edgeSds >= 0.6) return { tier: 'strong', label: 'Strong edge' };
  if (prob >= 0.62) return { tier: 'lean', label: 'Modest lean' };
  return { tier: 'coinflip', label: 'Coin-flip — line is inside the noise' };
}
export default { tennisClassify, classifyProp };
