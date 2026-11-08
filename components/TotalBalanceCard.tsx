"use client";
import { useRef, useState } from "react";
import { bankBalance, demoBankOptions, initialBanks, type ConnectedBank } from "@/lib/bank-data";
import { currency } from "@/lib/mock-data";

export default function TotalBalanceCard() {
 const [banks, setBanks] = useState<ConnectedBank[]>(initialBanks);
 const [selected, setSelected] = useState("all");
 const dialog = useRef<HTMLDialogElement>(null);
 const bank = banks.find(item => item.id === selected);
 const balance = bankBalance(bank ? [bank] : banks);
 const available = demoBankOptions.filter(option => !banks.some(item => item.id === option.id));
 function connect(option: ConnectedBank) {
  setBanks(previous => previous.some(item => item.id === option.id) ? previous : [...previous, option]);
  setSelected(option.id);
  dialog.current?.close();
 }
 return <div className="balance-card bank-balance-card">
  <div className="balance-label"><span>{bank ? `${bank.name} Balance` : "Total Balance"}</span><span className="balance-badge">{bank ? bank.name.toUpperCase() : "ALL ACCOUNTS"}</span></div>
  <div className="balance-value" aria-live="polite" aria-atomic="true"><span key={selected} className="bank-balance-number">{currency(balance)}</span><span>.00</span></div>
  <div className="bank-selection" role="group" aria-label="Select bank balance">
   <button aria-pressed={selected === "all"} onClick={() => setSelected("all")}>All Accounts</button>
   {banks.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.name}</button>)}
   <button aria-label="Connect a demo bank" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>+</button>
  </div>
  <div className="balance-bottom bank-demo-label"><span className="mock-label">Demo balance</span></div>
  <dialog className="bank-connect-dialog" ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
   <div className="bank-dialog-heading"><h2>Connect a demo bank</h2><button aria-label="Close connection dialog" onClick={() => dialog.current?.close()}>×</button></div>
   <p>Sample cash balances only. This does not connect a real bank account.</p>
   {available.length ? available.map(option => <button className="bank-connect-option" key={option.id} onClick={() => connect(option)}><span>{option.name}</span><span>{currency(bankBalance([option]))} · Add demo</span></button>) : <p>All available demo banks are connected.</p>}
   <button className="bank-dialog-cancel" onClick={() => dialog.current?.close()}>Cancel</button>
  </dialog>
 </div>;
}
