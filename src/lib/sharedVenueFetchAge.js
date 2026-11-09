// A matching rounded label is not proof of a matching observation time.
export function sharedVenueFetchAge(rows){
 const cells=rows.flatMap(row=>row.cells.flatMap(cell=>cell.lines||[cell])).filter(cell=>cell.observedLabel);
 return cells.length&&Number.isFinite(cells[0].observedAtMs)&&cells.every(cell=>cell.observedAtMs===cells[0].observedAtMs&&cell.observedLabel===cells[0].observedLabel)?cells[0].observedLabel:null;
}
