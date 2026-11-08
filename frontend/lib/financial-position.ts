import type { CustomerData } from './live-data';
export interface PositionCategory { name: string; cents: number }
export interface PositionSide { cents: number | null; categories: PositionCategory[] }
export interface FinancialPosition { assets: PositionSide; debt: PositionSide }
const assetTypes: Record<string,string> = { checking:'Checking', savings:'Savings', cd:'CDs', cds:'CDs', ira:'IRA', investment:'Investments', investments:'Investments', brokerage:'Investments' };
const debtTypes: Record<string,string> = { credit_card:'Credit cards', auto_loan:'Auto loans', personal_loan:'Personal loans', mortgage:'Mortgages', loan:'Loans' };
/** Classify account snapshots, not transactions or net worth. Never include a credit score. */
export function financialPosition(data: CustomerData | null): FinancialPosition {
 const assets: PositionSide = { cents:null,categories:[] }; const debt: PositionSide = { cents:null,categories:[] };
 if (!data || !Array.isArray(data.account) || !Array.isArray(data.external_account)) return {assets,debt};
 if (data.account.length + data.external_account.length === 0) return {assets,debt};
 const seen = new Set<string>(); const groups = { assets:new Map<string,number>(), debt:new Map<string,number>() }; const invalid = { assets:false,debt:false };
 for (const row of [...data.account,...data.external_account]) {
  if (!row.account_id || seen.has(row.account_id)) continue;
  seen.add(row.account_id);
  const type = row.account_type?.toLowerCase(); const side = assetTypes[type] ? 'assets' : debtTypes[type] ? 'debt' : null;
  if (!side) continue;
  if (typeof row.balance_cents !== 'number' || !Number.isFinite(row.balance_cents) || row.balance_cents < 0) { invalid[side]=true;continue; }
  const label = (side === 'assets' ? assetTypes : debtTypes)[type]; groups[side].set(label,(groups[side].get(label) ?? 0)+row.balance_cents);
 }
 for (const [side,result] of [['assets',assets],['debt',debt]] as const) { result.categories=[...groups[side]].map(([name,cents])=>({name,cents})); result.cents=invalid[side] ? null : result.categories.reduce((sum,item)=>sum+item.cents,0); }
 return {assets,debt};
}
export function positionShares(position: FinancialPosition): { assets:number; debt:number } | null {
 const a=position.assets.cents;const d=position.debt.cents;
 if (a === null || d === null || a+d <= 0) return null;
 return { assets:a/(a+d),debt:d/(a+d) };
}
export const positionCurrency = (cents:number | null) => cents === null ? 'Not available' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
