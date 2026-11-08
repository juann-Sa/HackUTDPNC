"use client";
import { useEffect, useState } from "react";
import { isOptionalAccount, optionalAccounts, type AccountType, type OptionalAccountType } from "@/lib/account-data";
import AccountTabs from "./AccountTabs";
import AccountContent from "./AccountContent";
import AddAccountDropdown from "./AddAccountDropdown";
import { useLiveData } from "./live-data-provider";
const storageKey = "pnc-navigator-account-tabs-v2";
export default function AccountsWidget() {
 const { availableAccounts, data } = useLiveData();
 const [added, setAdded] = useState<OptionalAccountType[]>([]);
 const [selected, setSelected] = useState<AccountType>("savings");
 const [ready, setReady] = useState(false);
 useEffect(() => {
  try {
   const current = localStorage.getItem(storageKey);
   const legacy = current === null;
   const raw = current ?? localStorage.getItem("pnc-navigator-account-tabs-v1");
   if (raw) {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored === "object" && stored !== null && "added" in stored && Array.isArray(stored.added)) {
     const restored = [...new Set(stored.added.filter(isOptionalAccount).filter(account => !legacy || account !== "investment"))];
     setAdded(restored);
     if ("selected" in stored && (stored.selected === "savings" || stored.selected === "credit" || (isOptionalAccount(stored.selected) && restored.includes(stored.selected)))) setSelected(stored.selected);
    }
   }
  } catch { /* Storage can be unavailable or contain invalid preferences. */ }
  setReady(true);
 }, []);
 useEffect(() => { if (!ready) return; try { localStorage.setItem(storageKey, JSON.stringify({ added, selected })); } catch { /* Keep preferences usable in memory when storage is unavailable. */ } }, [added, selected, ready]);
 function add(account: OptionalAccountType) { setAdded(previous => previous.includes(account) ? previous : [...previous, account]); setSelected(account); }
 function remove(account: OptionalAccountType) { setAdded(previous => previous.filter(item => item !== account)); if (selected === account) setSelected("savings"); }
 return <section className="accounts-widget" aria-labelledby="accounts-title"><header className="accounts-header"><h2 id="accounts-title">Breakdowns</h2><AddAccountDropdown available={(data ? availableAccounts : optionalAccounts).filter(account => !added.includes(account))} onAdd={add} /></header><AccountTabs accounts={["savings", "credit", ...(data ? added.filter(a => availableAccounts.includes(a)) : added)]} selected={selected} onSelect={setSelected} onRemove={remove} /><AccountContent account={data && isOptionalAccount(selected) && !availableAccounts.includes(selected) ? "savings" : selected} /></section>;
}
