export type AccountType = "savings" | "credit" | "ira" | "loan" | "investment" | "cds";
export type OptionalAccountType = Exclude<AccountType, "savings" | "credit">;
export interface AccountMetric { label: string; value: string }
export interface AccountData { name: string; primary: AccountMetric; change?: string; metrics: AccountMetric[]; progress?: { label: string; value: number; detail: string } }
export const optionalAccounts: OptionalAccountType[] = ["ira", "loan", "investment", "cds"];
export const isOptionalAccount = (value: unknown): value is OptionalAccountType => typeof value === "string" && optionalAccounts.some(account => account === value);
// Placeholder shown while live data loads (real values come from lib/live-data.ts).
export const accountData: Record<AccountType, AccountData> = {
 savings: { name: "Savings", primary: { label: "Savings balance", value: "$24,500" }, change: "+8.2% from previous month", metrics: [{ label: "Savings goal", value: "$40,000" }], progress: { label: "Goal progress", value: 61, detail: "61% of savings goal" } },
 credit: { name: "Credit", primary: { label: "Credit score", value: "742" }, change: "+12 points · Good", metrics: [{ label: "Available credit", value: "$7,200" }, { label: "Current balance (debt)", value: "$2,800" }], progress: { label: "Credit utilization", value: 28, detail: "28% of credit limit used" } },
 ira: { name: "IRA", primary: { label: "IRA balance", value: "$18,200" }, change: "+6.4% from previous month", metrics: [{ label: "Annual contribution", value: "$5,500 / $7,000" }, { label: "Projected retirement value", value: "$312,000" }], progress: { label: "Contribution progress", value: 79, detail: "79% of annual contribution limit" } },
 loan: { name: "Loans", primary: { label: "Remaining loan debt", value: "$312,000" }, metrics: [{ label: "Interest rate", value: "5.75% APR" }, { label: "Principal paid", value: "$88,000" }, { label: "Original loan", value: "$400,000" }], progress: { label: "Principal repaid", value: 22, detail: "22% of original principal repaid" } },
 investment: { name: "Net worth", primary: { label: "Portfolio value", value: "$128,430" }, change: "+12.6% total return", metrics: [{ label: "Total gain", value: "+$14,390" }, { label: "YTD contributions", value: "$18,000" }] },
 cds: { name: "CDs", primary: { label: "CD balance", value: "$10,000" }, metrics: [{ label: "APY", value: "4.75%" }, { label: "Term", value: "12 months" }, { label: "Maturity date", value: "Nov 15, 2027" }, { label: "Interest earned", value: "$475" }] },
};
