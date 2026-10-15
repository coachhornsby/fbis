import React from "react";
import {buildMoneylinePriceComparison} from "../../lib/marketPriceComparison.js";
import {signedAmerican} from "../../lib/marketQuoteDisplay.js";
import "./moneylinePriceComparison.css";

const percent = p => p == null ? "—" : `${(p * 100).toFixed(1)}%`;
const american = p => p == null ? "—" : signedAmerican(p);

export default function MoneylinePriceComparison({game}) {
  const {rows,hasPrices,researchOnly,projectionState}=buildMoneylinePriceComparison(game);
  if(!hasPrices)return null;
  return <section className="gc-reference fbis-moneyline-comparison" aria-label="FBIS full game moneyline price comparison">
    <div className="gc-section-label">FULL-GAME MONEYLINE · SOURCE PRICE COMPARISON</div>
    <div className="fbis-comparison-scroll">
      <table className="fbis-comparison-table">
        <thead><tr>
          <th scope="col">Team</th>
          <th scope="col">PinnOdds<br/>American</th>
          <th scope="col">Polymarket<br/>Probability</th>
          <th scope="col">Polymarket<br/>American</th>
          <th scope="col">FBIS<br/>Probability</th>
          <th scope="col">FBIS<br/>Fair price</th>
        </tr></thead>
        <tbody>{rows.map(r=><tr key={r.side}>
          <th scope="row">{r.label}</th>
          <td className="fbis-market-price">{american(r.pinnoddsAmerican)}</td>
          <td className="fbis-market-probability">{percent(r.polymarketProbability)}</td>
          <td className="fbis-market-price">{american(r.polymarketAmerican)}</td>
          <td className="fbis-model-probability">{percent(r.fbisProbability)}</td>
          <td className="fbis-model-price">{american(r.fbisFairAmerican)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="gc-action-footnote muted">
      PinnOdds = captured decimal quote converted to American, provider quote time unverified.
      Polymarket = observed contract/ask-implied break-even probability and American equivalent before fees, not no-vig.
      FBIS = independent model probability and indicative fair price.
      {researchOnly ? " RESEARCH ONLY · NO WAGER AUTHORIZATION." : ""}
      {projectionState ? ` Projection status: ${String(projectionState).replaceAll("_"," ")}.` : ""}
      Missing or unmatched quotes show —.
    </div>
  </section>;
}
