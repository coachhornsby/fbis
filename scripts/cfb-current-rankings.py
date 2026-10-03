#!/usr/bin/env python3
"""Publish current FPR team ranking and v5 conference-strength ranking."""
from pathlib import Path
import json
import pandas as pd
OUT=Path("artifacts/cfb-final/rankings");OUT.mkdir(parents=True,exist_ok=True)

def main():
 w=pd.read_csv("artifacts/cfb-final/fpr/weekly-fpr.csv")
 w=w[w.season.eq(w.season.max())].copy()
 latest=w.sort_values(["week","game_id"]).drop_duplicates("team_id",keep="last")
 latest=latest.sort_values("fpr",ascending=False).reset_index(drop=True)
 latest.insert(0,"fpr_rank",range(1,len(latest)+1))
 latest.to_csv(OUT/"fpr-current.csv",index=False)

 c=pd.read_csv("artifacts/cfb-final/v5-context/conference-rankings.csv")
 season=int(c.season.max()) if "season" in c else int(w.season.max())
 cur=c[c.season.eq(season)].copy() if "season" in c else c.copy()
 # Prefer latest PIT week if present, then rank strongest conference first.
 if "week" in cur:
  cur=cur[cur.week.eq(cur.week.max())].copy()
 strength=next((x for x in ["conference_strength","rating","strength","power"] if x in cur),None)
 if strength:
  cur=cur.sort_values(strength,ascending=False).reset_index(drop=True)
  cur.insert(0,"conference_rank",range(1,len(cur)+1))
 cur.to_csv(OUT/"conference-current.csv",index=False)
 print(json.dumps({"season":season,"fprTeams":len(latest),"conferenceRows":len(cur),"fprTop25":latest.head(25).to_dict("records"),"conferenceRanking":cur.to_dict("records")},default=str))

if __name__=="__main__":main()
