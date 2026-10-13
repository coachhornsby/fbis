import MatchupSignals from "./MatchupSignals.jsx";

const slots=[
  {id:"five-v-five",icon:"5V5",label:"5V5 xG"},
  {id:"goaltending",icon:"G",label:"GOALTENDING"},
  {id:"special-teams",icon:"ST",label:"SPECIAL TEAMS"},
  {id:"high-danger",icon:"HD",label:"HIGH DANGER"},
  {id:"rest",icon:"RST",label:"REST"},
];

/** NHL-specific factor definitions; visual rendering is shared across sports. */
export default function NhlMatchupSignals({game,away,home}){
 return <MatchupSignals game={game} away={away} home={home} sport="nhl" slots={slots} />;
}
