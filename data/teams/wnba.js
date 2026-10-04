const teams = [
["ATL","Atlanta Dream"],["CHI","Chicago Sky"],["CON","Connecticut Sun"],["DAL","Dallas Wings"],
["GSV","Golden State Valkyries"],["IND","Indiana Fever"],["LVA","Las Vegas Aces"],["LAS","Los Angeles Sparks"],
["MIN","Minnesota Lynx"],["NYL","New York Liberty"],["PHX","Phoenix Mercury"],["POR","Portland Fire"],["SEA","Seattle Storm"],
["TOR","Toronto Tempo"],["WAS","Washington Mystics"]
].map(([abbr,displayName]) => ({
  id: `wnba-${abbr.toLowerCase()}`,
  abbr,
  displayName,
  school: displayName,
  nickname: displayName.split(" ").slice(-1)[0],
  logo: `https://a.espncdn.com/i/teamlogos/wnba/500/${abbr.toLowerCase()}.png`,
  sources: { espn: { abbr, name: displayName }, heritage: { names: [displayName] } },
}));
export default teams;
