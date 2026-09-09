/**
 * Home stadium reference for weather when ESPN venue fields are absent
 * (e.g. soft-odds stub games). Indoor / closed roofs skip outdoor weather.
 */

const NFL_HOME = {
  ari: { venue: "State Farm Stadium", city: "Glendale", state: "AZ", indoor: false, lat: 33.5276, lon: -112.2626 },
  atl: { venue: "Mercedes-Benz Stadium", city: "Atlanta", state: "GA", indoor: false, lat: 33.7554, lon: -84.4009 },
  bal: { venue: "M&T Bank Stadium", city: "Baltimore", state: "MD", indoor: false, lat: 39.278, lon: -76.6227 },
  buf: { venue: "Highmark Stadium", city: "Orchard Park", state: "NY", indoor: false, lat: 42.7738, lon: -78.787 },
  car: { venue: "Bank of America Stadium", city: "Charlotte", state: "NC", indoor: false, lat: 35.2251, lon: -80.8529 },
  chi: { venue: "Soldier Field", city: "Chicago", state: "IL", indoor: false, lat: 41.8623, lon: -87.6167 },
  cin: { venue: "Paycor Stadium", city: "Cincinnati", state: "OH", indoor: false, lat: 39.0954, lon: -84.516 },
  cle: { venue: "Huntington Bank Field", city: "Cleveland", state: "OH", indoor: false, lat: 41.5061, lon: -81.6995 },
  dal: { venue: "AT&T Stadium", city: "Arlington", state: "TX", indoor: false, lat: 32.7473, lon: -97.0945 },
  den: { venue: "Empower Field at Mile High", city: "Denver", state: "CO", indoor: false, lat: 39.7439, lon: -105.0201 },
  det: { venue: "Ford Field", city: "Detroit", state: "MI", indoor: true, lat: 42.3400, lon: -83.0456 },
  gb: { venue: "Lambeau Field", city: "Green Bay", state: "WI", indoor: false, lat: 44.5013, lon: -88.0622 },
  hou: { venue: "NRG Stadium", city: "Houston", state: "TX", indoor: false, lat: 29.6847, lon: -95.4107 },
  ind: { venue: "Lucas Oil Stadium", city: "Indianapolis", state: "IN", indoor: true, lat: 39.7601, lon: -86.1639 },
  jax: { venue: "EverBank Stadium", city: "Jacksonville", state: "FL", indoor: false, lat: 30.3239, lon: -81.6373 },
  kc: { venue: "GEHA Field at Arrowhead Stadium", city: "Kansas City", state: "MO", indoor: false, lat: 39.0489, lon: -94.4839 },
  lac: { venue: "SoFi Stadium", city: "Inglewood", state: "CA", indoor: true, lat: 33.9535, lon: -118.3390 },
  lar: { venue: "SoFi Stadium", city: "Inglewood", state: "CA", indoor: true, lat: 33.9535, lon: -118.3390 },
  lv: { venue: "Allegiant Stadium", city: "Las Vegas", state: "NV", indoor: true, lat: 36.0908, lon: -115.1830 },
  mia: { venue: "Hard Rock Stadium", city: "Miami Gardens", state: "FL", indoor: false, lat: 25.9580, lon: -80.2389 },
  min: { venue: "U.S. Bank Stadium", city: "Minneapolis", state: "MN", indoor: true, lat: 44.9736, lon: -93.2575 },
  ne: { venue: "Gillette Stadium", city: "Foxborough", state: "MA", indoor: false, lat: 42.0909, lon: -71.2643 },
  no: { venue: "Caesars Superdome", city: "New Orleans", state: "LA", indoor: true, lat: 29.9511, lon: -90.0812 },
  nyg: { venue: "MetLife Stadium", city: "East Rutherford", state: "NJ", indoor: false, lat: 40.8128, lon: -74.0742 },
  nyj: { venue: "MetLife Stadium", city: "East Rutherford", state: "NJ", indoor: false, lat: 40.8128, lon: -74.0742 },
  phi: { venue: "Lincoln Financial Field", city: "Philadelphia", state: "PA", indoor: false, lat: 39.9008, lon: -75.1675 },
  pit: { venue: "Acrisure Stadium", city: "Pittsburgh", state: "PA", indoor: false, lat: 40.4468, lon: -80.0158 },
  sea: { venue: "Lumen Field", city: "Seattle", state: "WA", indoor: false, lat: 47.5952, lon: -122.3316 },
  sf: { venue: "Levi's Stadium", city: "Santa Clara", state: "CA", indoor: false, lat: 37.4030, lon: -121.9700 },
  tb: { venue: "Raymond James Stadium", city: "Tampa", state: "FL", indoor: false, lat: 27.9759, lon: -82.5033 },
  ten: { venue: "Nissan Stadium", city: "Nashville", state: "TN", indoor: false, lat: 36.1665, lon: -86.7713 },
  wsh: { venue: "Northwest Stadium", city: "Landover", state: "MD", indoor: false, lat: 38.9077, lon: -76.8645 },
};

const ALIAS = {
  arizona: "ari",
  cardinals: "ari",
  atlanta: "atl",
  falcons: "atl",
  baltimore: "bal",
  ravens: "bal",
  buffalo: "buf",
  bills: "buf",
  carolina: "car",
  panthers: "car",
  chicago: "chi",
  bears: "chi",
  cincinnati: "cin",
  bengals: "cin",
  cleveland: "cle",
  browns: "cle",
  dallas: "dal",
  cowboys: "dal",
  denver: "den",
  broncos: "den",
  detroit: "det",
  lions: "det",
  "green bay": "gb",
  packers: "gb",
  houston: "hou",
  texans: "hou",
  indianapolis: "ind",
  colts: "ind",
  jacksonville: "jax",
  jaguars: "jax",
  "kansas city": "kc",
  chiefs: "kc",
  chargers: "lac",
  "la chargers": "lac",
  "los angeles chargers": "lac",
  rams: "lar",
  "la rams": "lar",
  "los angeles rams": "lar",
  "las vegas": "lv",
  raiders: "lv",
  miami: "mia",
  dolphins: "mia",
  minnesota: "min",
  vikings: "min",
  "new england": "ne",
  patriots: "ne",
  "new orleans": "no",
  saints: "no",
  giants: "nyg",
  "new york giants": "nyg",
  jets: "nyj",
  "new york jets": "nyj",
  philadelphia: "phi",
  eagles: "phi",
  pittsburgh: "pit",
  steelers: "pit",
  seattle: "sea",
  seahawks: "sea",
  "san francisco": "sf",
  "49ers": "sf",
  "san francisco 49ers": "sf",
  "tampa bay": "tb",
  buccaneers: "tb",
  tennessee: "ten",
  titans: "ten",
  washington: "wsh",
  commanders: "wsh",
};

function teamKey(team = {}) {
  const abbr = String(team.abbr || "").toLowerCase();
  if (NFL_HOME[abbr]) return abbr;
  const name = String(team.name || team.school || "").toLowerCase();
  if (ALIAS[name]) return ALIAS[name];
  for (const [alias, key] of Object.entries(ALIAS)) {
    if (name.includes(alias)) return key;
  }
  return null;
}

export function lookupNflHomeStadium(team = {}) {
  const key = teamKey(team);
  return key ? { ...NFL_HOME[key], key } : null;
}

/** Fill missing venue fields from home-team stadium when sport is NFL. */
export function enrichGameVenue(game = {}) {
  if (!game || (game.sport && game.sport !== "nfl")) return game;
  if (game.venueLat != null && game.venueLon != null) return game;
  if (game.venueIndoor === true || game.venue) {
    // Keep ESPN venue; still fill coords from catalog when possible.
  }
  const home = lookupNflHomeStadium(game.home);
  if (!home) return game;
  return {
    ...game,
    venue: game.venue || home.venue,
    venueCity: game.venueCity || home.city,
    venueState: game.venueState || home.state,
    venueIndoor: game.venueIndoor == null ? home.indoor : game.venueIndoor,
    venueLat: game.venueLat ?? home.lat,
    venueLon: game.venueLon ?? home.lon,
    venueRoof: game.venueRoof || (home.indoor ? "Indoor" : null),
  };
}

export function enrichGamesVenues(games = []) {
  return (games || []).map(enrichGameVenue);
}
