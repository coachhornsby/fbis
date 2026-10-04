const teams = [
["HT","Hanshin Tigers","Hanshin Tigers"],
["YDB","Yokohama DeNA BayStars","Yokohama DeNA BayStars"],
["YG","Yomiuri Giants","Yomiuri Giants"],
["CD","Chunichi Dragons","Chunichi Dragons"],
["HC","Hiroshima Toyo Carp","Hiroshima Toyo Carp"],
["TYS","Tokyo Yakult Swallows","Tokyo Yakult Swallows"],
["FSH","Fukuoka SoftBank Hawks","Fukuoka SoftBank Hawks"],
["HNF","Hokkaido Nippon-Ham Fighters","Hokkaido Nippon-Ham Fighters"],
["OB","Orix Buffaloes","Orix Buffaloes"],
["TRE","Tohoku Rakuten Golden Eagles","Tohoku Rakuten Golden Eagles"],
["SSL","Saitama Seibu Lions","Saitama Seibu Lions"],
["CLM","Chiba Lotte Marines","Chiba Lotte Marines"]
].map(([abbr,displayName,wikiTitle])=>({
  id:`npb-${abbr.toLowerCase()}`,abbr,displayName,school:displayName,nickname:displayName.split(" ").slice(-1)[0],
  logo:"",wikiTitle,sources:{heritage:{names:[displayName,displayName.replace("Saitama ","").replace("Chiba ","")]}}
}));
export default teams;
