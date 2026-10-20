export function verifiedLastFive(games = []) {
  const seen = new Set();
  return games.filter(g => g && g.value != null && g.value !== '' && typeof g.value !== 'boolean' &&
    Number.isFinite(Number(g.value)) && !['DNP','CANCELLED','CANCELED','UNVERIFIED','MISSING'].includes(String(g.status || '').toUpperCase()) &&
    (Number.isFinite(Date.parse(g.date)) || (Number.isInteger(g.season) && Number.isInteger(g.week))))
    .sort((a,b) => (Date.parse(b.date) || (b.season*100+b.week)) - (Date.parse(a.date) || (a.season*100+a.week)))
    .filter(g => { const key = g.eventId || g.date || `${g.season}-${g.week}`; if(seen.has(key)) return false; seen.add(key); return true; })
    .slice(0,5).reverse().map(g=>({...g,value:Number(g.value)}));
}
