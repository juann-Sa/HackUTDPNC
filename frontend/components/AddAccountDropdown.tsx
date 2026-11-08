"use client";
import { useLiveData } from "./live-data-provider";
import { useEffect, useRef, useState } from "react";
import { accountData as placeholder, type OptionalAccountType } from "@/lib/account-data";
export default function AddAccountDropdown({ available, onAdd }: { available: OptionalAccountType[]; onAdd: (account: OptionalAccountType) => void }) {
 const accountData = useLiveData().accounts ?? placeholder;
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 useEffect(() => { if (!open) return; const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); }; const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }; document.addEventListener("mousedown", close); document.addEventListener("keydown", escape); return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); }; }, [open]);
 return <div className="add-account-wrap" ref={ref}><button ref={trigger} className="add-account-button" aria-expanded={open} aria-controls="add-account-options" onClick={() => setOpen(!open)}>+ Add</button>{open && <div id="add-account-options" className="dropdown account-options"><p>Show another account</p>{available.length ? available.map(account => <button key={account} onClick={() => { onAdd(account); setOpen(false); trigger.current?.focus(); }}>{accountData[account].name}</button>) : <span className="account-options-empty">All account tabs have been added.</span>}<small>Only accounts this customer has are listed.</small></div>}</div>;
}
