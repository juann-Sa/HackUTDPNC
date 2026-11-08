export type AccountType = "savings" | "credit" | "ira" | "loan" | "investment" | "cds";
export type OptionalAccountType = Exclude<AccountType, "savings" | "credit">;
export interface AccountMetric { label: string; value: string }
export interface AccountData { name: string; primary: AccountMetric; change?: string; metrics: AccountMetric[]; progress?: { label: string; value: number; detail: string } }
export const optionalAccounts: OptionalAccountType[] = ["ira", "loan", "investment", "cds"];
export const isOptionalAccount = (value: unknown): value is OptionalAccountType => typeof value === "string" && optionalAccounts.some(account => account === value);
// Shown only while live data loads: no numbers, so nothing on screen is invented.
export const accountData: Record<AccountType, AccountData> = {
 savings: { name: "Savings", primary: { label: "Loading", value: "…" }, metrics: [] },
 credit: { name: "Credit", primary: { label: "Loading", value: "…" }, metrics: [] },
 ira: { name: "IRA", primary: { label: "Loading", value: "…" }, metrics: [] },
 loan: { name: "Loans", primary: { label: "Loading", value: "…" }, metrics: [] },
 investment: { name: "Net worth", primary: { label: "Loading", value: "…" }, metrics: [] },
 cds: { name: "CDs", primary: { label: "Loading", value: "…" }, metrics: [] },
};
