import React from "react";
import "./cfbSeasonStatStrip.css";
const fmt = (v, places=3) => v === null || v === undefined || !Number.isFinite(Number(v))
  ? "—" : Number(Number(v).toFixed(places)).toString();
const stamp = s => s && Number.isFinite(Date.parse(s))
  ? new Date(s).toLocaleString("en-US", {timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})
  : "Unverified";
export default function CfbSeasonStatStrip({evidence}) {
  if (!evidence || evidence.state === "NOT_CFB") return null;
  if (evidence.state !== "SOURCE_OBSERVED" && evidence.state !== "INSUFFICIENT_SOURCE_GAMES")
    return <section className="cfb-sdv-strip is-unavailable" aria-label="CFB statistical source status">
      <strong>2026 CFB TEAM STATISTICS</strong>
      <span>{evidence.state === "IDENTITY_UNRESOLVED" ? "Exact team IDs unavailable — stats withheld" : "Statistics unavailable from source — no values fabricated"}</span>
    </section>;
  const a=evidence.away, h=evidence.home;
  const rows=[
    ["National EPA rank","nationalRank",0],
    ["Offensive EPA rank","offenseRank",0],
    ["Defensive EPA rank","defenseRank",0],
    ["Net adjusted EPA","netAdjEpa",3],
    ["Offensive adjusted EPA","offAdjEpa",3],
    ["Defensive adjusted EPA","defAdjEpa",3],
    ["Offensive success rate","offenseSuccess",3],
    ["Defensive success rate","defenseSuccess",3],
    ["Defensive havoc","havocDefense",3],
    ["Passing offense EPA/play","passingOffenseEpa",3],
    ["Passing defense EPA allowed","passingDefenseEpa",3],
    ["Rushing offense EPA/play","rushingOffenseEpa",3],
    ["Rushing defense EPA allowed","rushingDefenseEpa",3],
    ["Points/opportunity","pointsPerOpportunityOffense",2],
  ];
  return <section className="cfb-sdv-strip" aria-label="2026 CFB SportsDataverse team statistics">
    <header><strong>2026 FBS TEAM INTELLIGENCE</strong><span>SDV SOURCE DATA · DISPLAY ONLY</span></header>
    <div className="cfb-sdv-coverage">
      <span>{a?.name || "Away"}: {a?.games ?? "—"} valid summary games</span>
      <span>{h?.name || "Home"}: {h?.games ?? "—"} valid summary games</span>
    </div>
    <div className="cfb-sdv-scroll"><table>
      <thead><tr><th>Statistic</th><th>{a?.name||"Away"}</th><th>{h?.name||"Home"}</th></tr></thead>
      <tbody>{rows.map(([label,key,precision])=><tr key={key}><th>{label}</th>
        <td>{fmt(a?.[key],precision)}</td><td>{fmt(h?.[key],precision)}</td></tr>)}</tbody>
    </table></div>
    <p>Source retrieved {stamp(evidence.source?.observedAt)}. Provider publication time not verified. Retrospective summaries are not point-in-time model inputs and do not authorize wagers.</p>
  </section>;
}
