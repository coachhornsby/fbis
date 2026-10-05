/**
 * Heritage-compatible soccer derivative pricing from an independent score matrix.
 * Returns probabilities only. Sportsbook prices are joined after projection freeze.
 */
function splitQuarter(line){
  const x=Number(line);
  const q=Math.round(x*4)/4;
  const frac=Math.abs(q*4)%2;
  return frac===1 ? [q-0.25,q+0.25] : [q];
}
function settleHandicap(diff,line){
  const v=diff+line;
  return v>0?"win":v<0?"loss":"push";
}
function settleTotal(total,line,side){
  const d=side==="over"?total-line:line-total;
  return d>0?"win":d<0?"loss":"push";
}
function settleSplit(outcomes){
  if(outcomes.length===1)return {[outcomes[0]]:1};
  const a=outcomes[0],b=outcomes[1];
  if(a===b)return {[a]:1};
  const out={};out[a]=(out[a]||0)+0.5;out[b]=(out[b]||0)+0.5;return out;
}
function add(bucket,outcome,p){
  for(const [k,w] of Object.entries(outcome))bucket[k]=(bucket[k]||0)+p*w;
}
export function priceSoccerScoreMatrix(matrix=[]){
  let home=0,draw=0,away=0,bttsYes=0;
  const exactScore={},exactTotal={};
  for(const c of matrix){
    const h=Number(c.home),a=Number(c.away),p=Number(c.p)||0,t=h+a;
    if(h>a)home+=p; else if(h<a)away+=p; else draw+=p;
    if(h>0&&a>0)bttsYes+=p;
    exactScore[`${h}-${a}`]=(exactScore[`${h}-${a}`]||0)+p;
    exactTotal[String(t)]=(exactTotal[String(t)]||0)+p;
  }
  const dnb={homeWin:home,awayWin:away,push:draw};
  const noDraw=home+away;
  return {
    matchResult:{home,draw,away},
    doubleChance:{homeOrDraw:home+draw,noDraw,awayOrDraw:away+draw},
    drawNoBet:dnb,
    willThereBeDraw:{yes:draw,no:noDraw},
    btts:{yes:bttsYes,no:1-bttsYes},
    exactScore,
    exactTotal,
    totalAt(line){
      const over={win:0,push:0,loss:0},under={win:0,push:0,loss:0};
      const parts=splitQuarter(line);
      for(const c of matrix){
        const t=Number(c.home)+Number(c.away),p=Number(c.p)||0;
        add(over,settleSplit(parts.map(x=>settleTotal(t,x,"over"))),p);
        add(under,settleSplit(parts.map(x=>settleTotal(t,x,"under"))),p);
      }
      return{line:Number(line),over,under};
    },
    asianHandicapAt(line){
      const homeSide={win:0,push:0,loss:0},awaySide={win:0,push:0,loss:0};
      const parts=splitQuarter(line);
      for(const c of matrix){
        const diff=Number(c.home)-Number(c.away),p=Number(c.p)||0;
        add(homeSide,settleSplit(parts.map(x=>settleHandicap(diff,x))),p);
        add(awaySide,settleSplit(parts.map(x=>settleHandicap(-diff,-x))),p);
      }
      return{homeLine:Number(line),home:homeSide,awayLine:-Number(line),away:awaySide};
    }
  };
}

export function heritageSoccerFullMatchMenu(priced){
  const totals=[1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.25,3.5,3.75,4].map(x=>priced.totalAt(x));
  const handicaps=[-1.5,-1.25,-1,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1,1.25,1.5].map(x=>priced.asianHandicapAt(x));
  return{
    matchResult:priced.matchResult,
    doubleChance:priced.doubleChance,
    drawNoBet:priced.drawNoBet,
    willThereBeDraw:priced.willThereBeDraw,
    btts:priced.btts,
    totals,
    handicaps,
    exactTotal:priced.exactTotal,
    exactScore:priced.exactScore,
    unsupportedWithoutAdditionalProcessModel:["first-half","first-to-score","race-to-goals","to-advance"],
  };
}
