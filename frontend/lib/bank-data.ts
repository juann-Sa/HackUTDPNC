export interface ConnectedBank {
 id: string;
 name: string;
 accounts: { id: string; kind: "checking" | "savings"; balance: number; eligible: boolean }[];
}
export const initialBanks: ConnectedBank[] = [
 { id: "pnc", name: "PNC", accounts: [{ id: "pnc-checking", kind: "checking", balance: 45000, eligible: true }] },
 { id: "chase", name: "Chase", accounts: [{ id: "chase-checking", kind: "checking", balance: 32000, eligible: true }] },
 { id: "boa", name: "Bank of America", accounts: [{ id: "boa-savings", kind: "savings", balance: 23000, eligible: true }] },
];
export const demoBankOptions: ConnectedBank[] = [
 { id: "capital-one", name: "Capital One", accounts: [{ id: "capital-one-checking", kind: "checking", balance: 8500, eligible: true }] },
 { id: "wells-fargo", name: "Wells Fargo", accounts: [{ id: "wells-fargo-savings", kind: "savings", balance: 12000, eligible: true }] },
];
export function bankBalance(banks: ConnectedBank[]): number {
 return banks.reduce((total, bank) => total + bank.accounts.filter(account => account.eligible).reduce((sum, account) => sum + account.balance, 0), 0);
}
