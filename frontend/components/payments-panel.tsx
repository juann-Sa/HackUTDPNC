"use client";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { currency } from "@/lib/mock-data";
import { paymentsFor, type LivePayment } from "@/lib/live-data";
import { useLiveData } from "./live-data-provider";
export default function PaymentsPanel() {
 const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
 const [completed, setCompleted] = useState<Set<string>>(new Set());
 const { data } = useLiveData();
 const bills: LivePayment[] = data ? paymentsFor(data, month.getMonth(), month.getFullYear()) : [];
 const expected = bills.some(b => b.expected);
 const moveMonth = (direction: number) => setMonth(previous => new Date(previous.getFullYear(), previous.getMonth() + direction, 1));
 const toggle = (id: string) => setCompleted(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
 const remaining = bills.filter(bill => !completed.has(bill.id));
 return <section className="panel payments-panel" aria-labelledby="payments-title"><div className="panel-heading"><div><h2 id="payments-title">Upcoming payments</h2></div><div className="month-nav"><button className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><span aria-live="polite">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span><button className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div></div><div className="payment-list">{bills.map(bill => <label key={bill.id} className={`payment-row ${completed.has(bill.id) ? "paid" : ""}`}><input type="checkbox" checked={completed.has(bill.id)} onChange={() => toggle(bill.id)} /><span className="custom-check">{completed.has(bill.id) && <Check size={13} />}</span><span className="bill-info"><span className="bill-title-row"><strong>{bill.name}</strong><span className="bill-date">{month.toLocaleDateString("en-US", { month: "short" })} {bill.day}{bill.risk && <span className="bill-risk" title={bill.risk}> · ⚠ {bill.risk}</span>}</span></span></span><strong className="bill-amount">{currency(bill.amount)}</strong></label>)}</div>{data && !expected && <p className="payments-note">{bills.length === 0 ? "No bills found for this month." : "Actual bills paid from checking."}</p>}<div className="payment-footer"><span>Remaining this month</span><strong>{currency(remaining.reduce((total, bill) => total + bill.amount, 0))}</strong></div></section>;
}

