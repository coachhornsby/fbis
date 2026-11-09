export function cfbdPublicationDates({targetDate,targetDates,reuse=false}={}){
 if(targetDate&&targetDates)throw Error('TARGET_DATE_AMBIGUOUS');
 const dates=targetDates?targetDates.split(','):targetDate?[targetDate]:[];
 if((reuse&&!dates.length)||dates.length>4||new Set(dates).size!==dates.length||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))throw Error('TARGET_DATE_INVALID');
 return dates;
}
