const domains={LG:"lgtwins.com",HAN:"hanwhaeagles.co.kr",SSG:"ssglanders.com",SAM:"samsunglions.com",KT:"ktwiz.co.kr",LOT:"giantsclub.com",DOO:"doosanbears.com",NC:"ncdinos.com",KIA:"tigers.co.kr",KIW:"heroesbaseball.co.kr"};
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
  logo:`https://www.google.com/s2/favicons?domain=${domains[abbr]}&sz=256`,wikiTitle,sources:{heritage:{names:[displayName]}}
}));
export default teams;
