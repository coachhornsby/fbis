const commons = (file) =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(file)}`;

const teams = [
  ["LG","LG Twins","LG Twins","LG Twins Cap Logo.svg","#C30452","#000000",["LG"]],
  ["HAN","Hanwha Eagles","Hanwha Eagles","Hanwha Eagles logo alt 3.png","#F37321","#111111",["HANWHA"]],
  ["SSG","SSG Landers","SSG Landers","SSG Landers insignia.png","#CE0E2D","#F4E3C1",["SSG"]],
  ["SAM","Samsung Lions","Samsung Lions","Samsung Lions insignia.svg","#074CA1","#FFFFFF",["SAMSUNG"]],
  ["KT","KT Wiz","KT Wiz","KT Wiz insignia.svg","#111111","#E60012",["KT"]],
  ["LOT","Lotte Giants","Lotte Giants","Lotte Giants insignia.svg","#041E42","#D71920",["LOTTE"]],
  ["DOO","Doosan Bears","Doosan Bears","Doosan Bears Cap Logo.png","#131230","#ED1C24",["DOOSAN"]],
  ["NC","NC Dinos","NC Dinos","NC Dinos insignia 2.svg","#315288","#C8A977",["NC"]],
  ["KIA","KIA Tigers","Kia Tigers","Kia Tigers insignia.svg","#EA0029","#111111",["KIA"]],
  ["KIW","Kiwoom Heroes","Kiwoom Heroes","Kiwoom Heroes insignia.png","#570514","#B07F4A",["KIWOOM"]]
].map(([abbr,displayName,wikiTitle,logoFile,color,altColor,officialAbbrs])=>({
  id:`kbo-${abbr.toLowerCase()}`,
  abbr,
  displayName,
  school:displayName,
  nickname:displayName.split(" ").slice(-1)[0],
  logo:commons(logoFile),
  color,
  altColor,
  wikiTitle,
  brandSource:"Wikimedia Commons team mark sourced from club/official team material",
  sources:{official:{abbrs:officialAbbrs},heritage:{names:[displayName]}}
}));
export default teams;
