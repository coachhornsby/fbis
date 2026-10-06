const commons = (file) =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(file)}`;

const teams = [
  ["HT","Hanshin Tigers","Hanshin Tigers","Hanshin tigers insignia.svg","#FFD400","#000000",["HAN"]],
  ["YDB","Yokohama DeNA BayStars","Yokohama DeNA BayStars","Yokohama DeNA BayStars insignia.svg","#0076B8","#FFFFFF",["DEN"]],
  ["YG","Yomiuri Giants","Yomiuri Giants","Yomiuri Giants logo.svg","#F15A24","#000000",["YOM"]],
  ["CD","Chunichi Dragons","Chunichi Dragons","Chunichi Dragons insignia.svg","#004EA2","#FFFFFF",["CHU"]],
  ["HC","Hiroshima Toyo Carp","Hiroshima Toyo Carp","Hiroshima Toyo Carp insignia.svg","#D71920","#FFFFFF",["HIR"]],
  ["TYS","Tokyo Yakult Swallows","Tokyo Yakult Swallows","Tokyo Yakult Swallows insignia.svg","#003F8A","#FFFFFF",["YAK"]],
  ["FSH","Fukuoka SoftBank Hawks","Fukuoka SoftBank Hawks","Fukuoka SoftBank Hawks insignia.svg","#FFCC00","#000000",["SBH"]],
  ["HNF","Hokkaido Nippon-Ham Fighters","Hokkaido Nippon-Ham Fighters","Hokkaido Nippon-Ham Fighters insignia.svg","#00A0E9","#111111",["HAM"]],
  ["OB","Orix Buffaloes","Orix Buffaloes","Orix Buffaloes insignia.svg","#00205B","#B9975B",["ORI"]],
  ["TRE","Tohoku Rakuten Golden Eagles","Tohoku Rakuten Golden Eagles","Rakuten eagles 2024 logo.svg","#870010","#FFFFFF",["RAK"]],
  ["SSL","Saitama Seibu Lions","Saitama Seibu Lions","Seibu lions insignia.svg","#003F7D","#FFFFFF",["SEI"]],
  ["CLM","Chiba Lotte Marines","Chiba Lotte Marines","Chiba Lotte Marines insignia.svg","#111111","#FFFFFF",["LOT"]]
].map(([abbr,displayName,wikiTitle,logoFile,color,altColor,officialAbbrs])=>({
  id:`npb-${abbr.toLowerCase()}`,
  abbr,
  displayName,
  school:displayName,
  nickname:displayName.split(" ").slice(-1)[0],
  logo:commons(logoFile),
  color,
  altColor,
  wikiTitle,
  brandSource:"Wikimedia Commons team mark sourced from club/official team material",
  sources:{
    official:{abbrs:officialAbbrs},
    heritage:{names:[displayName,displayName.replace("Saitama ","").replace("Chiba ",""),...({SSL:["Seibu","Seibu Lions"],CLM:["Chiba Lotte","Lotte Marines"],HNF:["Nippon Ham","Nippon-Ham Fighters"],FSH:["SoftBank","SoftBank Hawks"],TRE:["Rakuten","Rakuten Eagles"],YDB:["DeNA","Yokohama DeNA"],TYS:["Yakult","Yakult Swallows"],HC:["Hiroshima","Hiroshima Carp"],YG:["Yomiuri","Giants"],CD:["Chunichi"],HT:["Hanshin"],OB:["Orix"]}[abbr]||[])]}
  }
}));
export default teams;
