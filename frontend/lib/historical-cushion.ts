import type { CustomerData } from './live-data';
export interface CashFlowSelection { date:string; chartDate:string; resolution:'daily'|'weekly'|'monthly' }
export function chartSelection(chartDate:string,range:string,asOf:string):CashFlowSelection {
 const resolution=range==='1Y'||range==='ALL'?'monthly':range==='3M'?'weekly':'daily';
 const date=new Date(`${chartDate}T12:00:00Z`);
 if(resolution==='monthly')date.setUTCMonth(date.getUTCMonth()+1,0);
 if(resolution==='weekly')date.setUTCDate(date.getUTCDate()+6);
 return {chartDate,date:[date.toISOString().slice(0,10),asOf].sort()[0],resolution};
}
export function historicalCushion(data:CustomerData|null,date:string):number|null {
 const bills=data?.book_snapshot[0]?.monthly_outflow_cents;
 const row=data?.timeline_360?.find(point=>point.date===date&&point.day_offset<=0);
 if(!row||row.actual_net_cash_cents==null||!Number.isFinite(row.actual_net_cash_cents)||bills==null||!Number.isFinite(bills)||bills<=0)return null;
 return row.actual_net_cash_cents/bills;
}
