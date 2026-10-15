/**
 * Display-only quote conversion. Does not validate executable prices, provider
 * quote timestamps, paired no-vig markets, or wagering authority.
 */
const number = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function decimalToAmerican(value) {
  const decimal = number(value);
  if (decimal == null || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}
export function contractPriceToAmerican(value) {
  const price = number(value);
  if (price == null || price <= 0 || price >= 1) return null;
  return price >= 0.5 ? -Math.round((100 * price) / (1 - price))
    : Math.round((100 * (1 - price)) / price);
}
export function marketDisplayAmerican(offer) {
  const american = number(offer?.americanOdds);
  if (american != null && Math.abs(american) >= 100) return Math.round(american);
  const decimal = decimalToAmerican(offer?.decimalOdds);
  if (decimal != null) return decimal;
  return contractPriceToAmerican(offer?.contractPrice);
}
export function marketDisplayImplied(offer) {
  const contract = number(offer?.contractPrice);
  if (contract != null && contract > 0 && contract < 1) return contract;
  const decimal = number(offer?.decimalOdds);
  if (decimal != null && decimal > 1) return 1 / decimal;
  const american = number(offer?.americanOdds);
  if (american == null || Math.abs(american) < 100) return null;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}
export function signedAmerican(value) {
  const american = number(value);
  return american == null || Math.abs(american) < 100 ? "—" : american > 0 ? `+${Math.round(american)}` : String(Math.round(american));
}
