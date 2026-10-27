// Original FBIS line icons; no league or NCAA licensing implied.
export default function SportGlyph({sport}){
 const type={atp:'tennis',wta:'tennis',cfb:'football',nfl:'football',nba:'basketball',cbb:'basketball',mlb:'baseball',nhl:'hockey'}[sport]||'all';
 return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {type==='all'?<>{[4,18].flatMap(x=>[4,18].map(y=><rect key={`${x}-${y}`} x={x} y={y} width="10" height="10" rx="2"/>))}</>:null}
  {type==='football'?<><ellipse cx="16" cy="16" rx="14" ry="9" transform="rotate(-35 16 16)"/><path d="m9 21 14-10m-10 3 3 4m1-7 3 4"/></>:null}
  {type==='basketball'?<><circle cx="16" cy="16" r="13"/><path d="M3 16h26M16 3v26M7 6c10 8 10 12 0 20M25 6c-10 8-10 12 0 20"/></>:null}
  {type==='baseball'?<><circle cx="16" cy="16" r="13"/><path d="M7 6c7 5 7 15 0 20M25 6c-7 5-7 15 0 20M9 10l3-1m-2 6 3-1m-3 6 3 1m10-11-3-1m2 6-3-1m3 6-3 1"/></>:null}
  {type==='hockey'?<><path d="m8 3 11 21h9v5H16L4 5"/><ellipse cx="7" cy="26" rx="4" ry="2"/></>:null}
  {type==='tennis'?<><ellipse cx="19" cy="12" rx="8" ry="11" transform="rotate(35 19 12)"/><path d="m11 20-8 9m9-9-3-2m8-13 9 6M13 9l12 8m-10 3 10-15"/></>:null}
 </svg>;
}
