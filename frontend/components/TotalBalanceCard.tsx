"use client";
import { useRef, useState } from "react";
import { bankBalance, demoBankOptions, initialBanks, type ConnectedBank } from "@/lib/bank-data";
import { banksFor } from "@/lib/live-data";
import { useLiveData } from "./live-data-provider";

const whole = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, roundingMode: "trunc" } as Intl.NumberFormatOptions).format(Math.trunc(value));
const cents = (value: number) => `.${String(Math.round(Math.abs(value) * 100) % 100).padStart(2, "0")}`;

export default function TotalBalanceCard() {
 const { data, customerId, call } = useLiveData();
 const banks: ConnectedBank[] = data ? banksFor(data) : initialBanks;
 const [selected, setSelected] = useState("all");
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const bank = banks.find(item => item.id === selected);
 const balance = bankBalance(bank ? [bank] : banks);
 const available = demoBankOptions.filter(option => !banks.some(item => item.name === option.name));
 async function connect(option: ConnectedBank) {
  const acct = option.accounts[0];
  setBusy(true); setError(null);
  try {
   // Links an outside account in SpacetimeDB (add_external_account); the book is recomputed server-side.
   await call("add_external_account", { customer_id: customerId, institution: option.name, account_type: acct.kind, nickname: `${option.name} ${acct.kind}`, balance_cents: Math.round(acct.balance * 100), apr_pct: 0, annual_yield_pct: acct.kind === "savings" ? 4 : 0, monthly_payment_cents: 0 });
   setSelected(`ext-${option.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
   dialog.current?.close();
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 return <div className="balance-card bank-balance-card">
  <div className="balance-label"><span>{bank ? `${bank.name} Balance` : "Total Balance"}</span><span className="balance-badge">{bank ? bank.name.toUpperCase() : "ALL ACCOUNTS"}</span></div>
  <div className="balance-value" aria-live="polite" aria-atomic="true"><span key={selected} className="bank-balance-number">{whole(balance)}</span><span>{cents(balance)}</span></div>
  <div className="bank-selection" role="group" aria-label="Select bank balance">
   <button aria-pressed={selected === "all"} onClick={() => setSelected("all")}>All Accounts</button>
   {banks.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.name}</button>)}
   <button aria-label="Link an outside bank account" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>+</button>
  </div>
  <div className="balance-bottom bank-demo-label"><span className="mock-label">{data ? "Checking + savings" : "Loading…"}</span></div>
  <dialog className="bank-connect-dialog" ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
   <div className="bank-dialog-heading"><h2>Link an outside account</h2><button aria-label="Close connection dialog" onClick={() => dialog.current?.close()}>×</button></div>
   <p>Adds a sample outside account for {customerId} to the database. It counts toward net worth; forecasts leave it out unless asked.</p>
   {error && <p role="alert">{error}</p>}
   {available.length ? available.map(option => <button className="bank-connect-option" key={option.id} disabled={busy} onClick={() => connect(option)}><span>{option.name}</span><span>{whole(bankBalance([option]))} {option.accounts[0].kind} · Link</span></button>) : <p>All sample banks are linked.</p>}
   <button className="bank-dialog-cancel" onClick={() => dialog.current?.close()}>Cancel</button>
  </dialog>
 </div>;
}
