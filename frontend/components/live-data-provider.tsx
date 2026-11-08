"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { accountTabsFor, type CustomerData } from "@/lib/live-data";
import type { AccountData, AccountType, OptionalAccountType } from "@/lib/account-data";

const DEFAULT_CUSTOMER = "C006";
const storageKey = "pnc-navigator-customer-v1";

interface LiveData {
  reload: () => void;
  customerId: string;
  setCustomerId: (id: string) => void;
  customers: string[];
  data: CustomerData | null;
  loading: boolean;
  error: string | null;
  accounts: Record<AccountType, AccountData> | null;
  availableAccounts: OptionalAccountType[];
  /** Calls an allowed SpacetimeDB reducer, then reloads this customer's data. Throws the reducer's error. */
  call: (reducer: string, args: Record<string, unknown>) => Promise<void>;
}

const Ctx = createContext<LiveData | null>(null);

export function useLiveData(): LiveData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveData must be used inside LiveDataProvider");
  return v;
}

export default function LiveDataProvider({ children }: { children: ReactNode }) {
  const [customerId, setCustomer] = useState(DEFAULT_CUSTOMER);
  const [customers, setCustomers] = useState<string[]>([]);
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved && /^C\d{3}$/.test(saved)) setCustomer(saved); } catch { /* storage unavailable */ }
    fetch("/api/customers").then(r => r.json()).then(list => { if (Array.isArray(list)) setCustomers(list); }).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/customer/${customerId}`)
      .then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`); return body as CustomerData; })
      .then(body => { if (live) { setData(body); setError(null); } })
      .catch(e => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [customerId, version]);

  const setCustomerId = useCallback((id: string) => {
    setCustomer(id);
    try { localStorage.setItem(storageKey, id); } catch { /* storage unavailable */ }
  }, []);

  const call = useCallback(async (reducer: string, args: Record<string, unknown>) => {
    const r = await fetch(`/api/call/${reducer}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    setVersion(v => v + 1);
  }, []);

  const reload = useCallback(() => setVersion(value => value + 1), []);

  const tabs = useMemo(() => (data ? accountTabsFor(data) : null), [data]);

  const value: LiveData = {
    customerId, setCustomerId, customers, data, loading, error, reload,
    accounts: tabs?.data ?? null, availableAccounts: tabs?.available ?? [], call,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
