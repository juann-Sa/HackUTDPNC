export type TimeRange = "1W" | "1M" | "3M" | "1Y" | "ALL";
export interface CashFlowPoint { date: string; income: number; spending: number }
export interface Payment { id: string; name: string; day: number; amount: number }
export const ranges: TimeRange[] = ["1W", "1M", "3M", "1Y", "ALL"];
export const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
// Demo fixtures only. Replace this module with an API adapter when integrating real accounts.
const samples = [1800, 2050, 1900, 2650, 2400, 3100, 2850, 3450, 3200, 3900, 3650, 4250];
export function getCashFlow(range: TimeRange): CashFlowPoint[] {
 const count = { "1W": 7, "1M": 12, "3M": 12, "1Y": 12, ALL: 12 }[range];
 const span = { "1W": 6, "1M": 30, "3M": 90, "1Y": 365, ALL: 730 }[range];
 return Array.from({ length: count }, (_, i) => { const date = new Date(2026, 10, 7); date.setDate(date.getDate() - span + Math.round(i * span / (count - 1))); return { date: date.toISOString().slice(0, 10), income: samples[i] + (range === "1Y" || range === "ALL" ? i * 110 : 0), spending: Math.round(samples[i] * .58 + Math.sin(i * 1.7) * 260) }; });
}
export function getPayments(month: number, year: number): Payment[] {
 const prefix = `${year}-${month}`;
 return [{ id: `${prefix}-phone`, name: "Phone bill", day: 5, amount: 75 }, { id: `${prefix}-internet`, name: "Internet", day: 12, amount: 60 }, { id: `${prefix}-credit`, name: "Credit card", day: 18, amount: month % 2 === 0 ? 240 : 210 }, { id: `${prefix}-rent`, name: "Rent", day: 25, amount: 1250 }];
}
