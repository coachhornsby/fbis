export function exchangePriceLabel(quotes={}) {
  const price=side=>quotes[side]!=null?`${(quotes[side]*100).toFixed(1)}¢`:'—';
  return quotes.over!=null||quotes.under!=null?`OVER ${price('over')} / UNDER ${price('under')}`:`YES ${price('yes')} / NO ${price('no')}`;
}
