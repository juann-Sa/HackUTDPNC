export type PlanetState='thriving'|'balanced'|'pressure'|'unknown';
export interface PlanetForecastPoint { day:number; midCents:number|null; lowCents:number|null }
export interface PlanetOutcome { state:PlanetState; title:string; explanation:string; reason:string; coverage:number|null; baselineCoverage:number|null }
const titles:Record<PlanetState,string>={thriving:'Thriving',balanced:'Balanced',pressure:'Under Pressure',unknown:'Not enough data'};
/** Educational thresholds: midpoint below zero OR lower band below zero OR final coverage <1 month => pressure.
 * At least 6 months at the end and at least 1 month throughout the lower band => thriving; otherwise balanced.
 * Coverage uses the same forecast net cash as Chart View and latest recorded monthly bills. No new simulation. */
export function planetOutcome(points:PlanetForecastPoint[],baseline:PlanetForecastPoint[],monthlyBills:number|null):PlanetOutcome{
 const unknown:PlanetOutcome={state:'unknown',title:titles.unknown,explanation:'Apply a scenario after your forecast loads to see your financial planet.',reason:'A complete 180-day forecast and a positive monthly bills amount are needed. The neutral planet is not a financial assessment.',coverage:null,baselineCoverage:null};
 const sorted=points.filter(point=>point.day>=0&&point.day<=180).slice().sort((a,b)=>a.day-b.day);
 if(monthlyBills==null||!Number.isFinite(monthlyBills)||monthlyBills<=0||sorted.length!==181||sorted.some((point,index)=>point.day!==index)||sorted[0]?.day!==0||sorted.at(-1)?.day!==180||sorted.some(point=>point.midCents==null||!Number.isFinite(point.midCents)))return unknown;
 const end=sorted.at(-1)!.midCents!;const coverage=end/monthlyBills;const min=Math.min(...sorted.map(point=>point.midCents!));
 const hasBand=sorted.every(point=>point.lowCents!=null&&Number.isFinite(point.lowCents));const low=hasBand?Math.min(...sorted.map(point=>point.lowCents!)):null;
 const baselineEnd=baseline.find(point=>point.day===180)?.midCents;const baselineCoverage=baselineEnd!=null&&Number.isFinite(baselineEnd)?baselineEnd/monthlyBills:null;
 const state:PlanetState=min<0||(low!==null&&low<0)||coverage<1?'pressure':coverage>=6&&low!==null&&low/monthlyBills>=1?'thriving':'balanced';
 const explanation=state==='thriving'?'Your projection leaves a strong cash buffer, with room for unexpected expenses.':state==='pressure'?'This scenario could leave less cash for bills or bring part of your forecast below zero.':'This scenario looks manageable, but your cash buffer still needs care.';
 const comparison=baselineCoverage===null?`Projected end-of-period cash coverage: ${coverage.toFixed(1)} months.`:`End-of-period cash coverage: ${baselineCoverage.toFixed(1)} months on your current path → ${coverage.toFixed(1)} months in this view.`;
 return {state,title:titles[state],explanation,coverage,baselineCoverage,reason:`${comparison} Under Pressure means a projected negative cash point, a negative lower forecast band, or less than one month left. Thriving means at least six months left and one month throughout the lower band. Otherwise Balanced. Coverage is forecast net cash after high-interest debt divided by latest monthly bills.${hasBand?'':' The lower forecast band is unavailable, so Thriving cannot be determined.'} This is an educational visual, not a validated health score.`};
}
