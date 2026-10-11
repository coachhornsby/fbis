/** Historical line-outcome diagnostics. Quotes and settlements are not supplied:
 * outcomes cannot manufacture profit, ROI or CLV. No model authority.
 */
export function summarizeCfbHistoricalMarketGrades(grades) {
 const g=grades.filter(Boolean),wins=g.filter(x=>x.win).length,losses=g.filter(x=>x.loss).length,pushes=g.filter(x=>x.push).length;
 const decisions=wins+losses;
 return {n:g.length,decisions,wins,losses,pushes,hitRate:decisions?wins/decisions:null,
  units:null,roi:null,clv:null,economicObservations:0,
  economicUnavailableReason:'NO_QUALIFIED_CONTEMPORANEOUS_EXECUTABLE_PRICE_OR_SETTLEMENT',
  avgAbsEdge:g.length?g.reduce((s,x)=>s+Math.abs(x.edge),0)/g.length:null};
}
