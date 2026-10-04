const teams = [
["LG","LG Twins","LG Twins"],
["HAN","Hanwha Eagles","Hanwha Eagles"],
["SSG","SSG Landers","SSG Landers"],
["SAM","Samsung Lions","Samsung Lions"],
["KT","KT Wiz","KT Wiz"],
["LOT","Lotte Giants","Lotte Giants"],
["DOO","Doosan Bears","Doosan Bears"],
["NC","NC Dinos","NC Dinos"],
["KIA","KIA Tigers","Kia Tigers"],
["KIW","Kiwoom Heroes","Kiwoom Heroes"]
].map(([abbr,displayName,wikiTitle])=>({
  id:`kbo-${abbr.toLowerCase()}`,abbr,displayName,school:displayName,nickname:displayName.split(" ").slice(-1)[0],
  logo:"",wikiTitle,sources:{heritage:{names:[displayName]}}
}));
export default teams;
