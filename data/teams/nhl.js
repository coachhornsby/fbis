const teams = [
["ANA","Anaheim Ducks"],["BOS","Boston Bruins"],["BUF","Buffalo Sabres"],["CGY","Calgary Flames"],
["CAR","Carolina Hurricanes"],["CHI","Chicago Blackhawks"],["COL","Colorado Avalanche"],["CBJ","Columbus Blue Jackets"],
["DAL","Dallas Stars"],["DET","Detroit Red Wings"],["EDM","Edmonton Oilers"],["FLA","Florida Panthers"],
["LA","Los Angeles Kings"],["MIN","Minnesota Wild"],["MTL","Montreal Canadiens"],["NSH","Nashville Predators"],
["NJ","New Jersey Devils"],["NYI","New York Islanders"],["NYR","New York Rangers"],["OTT","Ottawa Senators"],
["PHI","Philadelphia Flyers"],["PIT","Pittsburgh Penguins"],["SEA","Seattle Kraken"],["SJ","San Jose Sharks"],
["STL","St. Louis Blues"],["TB","Tampa Bay Lightning"],["TOR","Toronto Maple Leafs"],["UTA","Utah Mammoth"],
["VAN","Vancouver Canucks"],["VGK","Vegas Golden Knights"],["WSH","Washington Capitals"],["WPG","Winnipeg Jets"]
].map(([abbr,displayName]) => ({
  id: `nhl-${abbr.toLowerCase()}`,
  abbr,
  displayName,
  school: displayName,
  nickname: displayName.split(" ").slice(-1)[0],
  logo: `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr.toLowerCase()}.png`,
  sources: { espn: { abbr, name: displayName }, heritage: { names: [displayName] } },
}));
export default teams;
