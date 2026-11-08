"use client";
import { useState } from "react";
import { CreditCard, Wallet, X } from "lucide-react";
export type WidgetKind = "Savings" | "Credit";
export default function Widget({ kind, onRemove }: { kind: WidgetKind; onRemove?: () => void }) {
 const [open, setOpen] = useState(false);
 return <div className="widget-wrap"><button className={`circle-widget ${open ? "selected" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><span className="widget-icon">{kind === "Savings" ? <Wallet size={21} /> : <CreditCard size={21} />}</span><span>{kind}</span><span className="widget-value">{kind === "Savings" ? "$24,500" : "742"}</span><span className="widget-hint">{kind === "Savings" ? "Available balance" : "Credit score"}</span></button>{onRemove && <button className="remove-widget icon-button" aria-label={`Remove ${kind} widget`} onClick={onRemove}><X size={14} /></button>}{open && <div className="widget-detail" role="status"><strong>{kind === "Savings" ? "Your savings" : "Your credit"}</strong><p>{kind === "Savings" ? "$24,500 saved · $30,000 sample goal" : "742 · Good credit standing"}</p><small>Sample account information</small></div>}</div>;
}

