#!/usr/bin/env python3
import json, re
import requests
from bs4 import BeautifulSoup

URLS={
  "hitter":"https://www.koreabaseball.com/Record/Player/HitterBasic/Basic1.aspx?sort=GAME_CN",
  "pitcher":"https://www.koreabaseball.com/Record/Player/PitcherBasic/Basic1.aspx?sort=GAME_CN",
}
HEADERS={"User-Agent":"Mozilla/5.0 (compatible; FBIS-KBO-PID/1.0)"}

def scrape(kind):
    url=URLS[kind]
    s=requests.Session(); s.headers.update(HEADERS)
    first=s.get(url,timeout=30); first.raise_for_status()
    soup=BeautifulSoup(first.text,"lxml")
    vs=soup.find("input",id="__VIEWSTATE")
    ev=soup.find("input",id="__EVENTVALIDATION")
    if not vs or not ev: raise RuntimeError("missing aspnet state")
    base={
      "__VIEWSTATE":vs.get("value",""),
      "__EVENTVALIDATION":ev.get("value",""),
      "__EVENTTARGET":"ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$lbtnOrderBy",
      "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$smData":"ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$udpContent|ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$lbtnOrderBy",
      "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSeries$ddlSeries":"0",
      "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSeason$ddlSeason":"2025",
      "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$hfOrderByCol":"GAME_CN",
      "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$hfOrderBy":"DESC",
    }
    out=[]
    for page in range(1,100):
      payload=dict(base)
      payload["ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$hfPage"]=str(page)
      r=s.post(url,data=payload,timeout=30); r.raise_for_status()
      p=BeautifulSoup(r.text,"lxml")
      head=p.select_one("thead tr")
      if not head: break
      cols=[th.get_text(strip=True) for th in head.find_all("th")]
      rows=p.select("tbody tr")
      if not rows: break
      added=0
      for tr in rows:
        a=tr.find("a",href=re.compile(r"playerId=\d+"))
        if not a: continue
        m=re.search(r"playerId=(\d+)",a.get("href",""))
        vals=[td.get_text(strip=True) for td in tr.find_all("td")]
        if not m or len(vals)!=len(cols): continue
        row={"P_ID":m.group(1)}
        row.update(dict(zip(cols,vals)))
        out.append(row); added+=1
      if added==0: break
      # KBO repeats the last page if hfPage is out of range; stop on duplicate page.
      if len(out)>=2*added and out[-added:]==out[-2*added:-added]: out=out[:-added]; break
    return out

result={}
for kind in ["hitter","pitcher"]:
    rows=scrape(kind)
    pairs=[(r.get("선수명"),r.get("팀명")) for r in rows]
    result[kind]={
      "count":len(rows),
      "keys":list(rows[0].keys()) if rows else [],
      "uniquePid":len({r["P_ID"] for r in rows}),
      "uniqueNameTeam":len(set(pairs)),
      "duplicateNameTeam":len(rows)-len(set(pairs)),
      "sample":rows[:5]
    }
print("KBO_PID_DIRECTORY_PROBE="+json.dumps(result,ensure_ascii=False))
