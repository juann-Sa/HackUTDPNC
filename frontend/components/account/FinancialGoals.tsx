"use client";
import { useEffect, useState } from "react";
import { useLiveData } from "../live-data-provider";
import GoalCard from "./GoalCard";
import GoalModal from "./GoalModal";
import AccountModal from "./AccountModal";
import { validGoal, type PlanningGoal } from "./goal-model";
export default function FinancialGoals() {
 const { customerId, data } = useLiveData();
 const [goals, setGoals] = useState<PlanningGoal[]>([]); const [loadedFor, setLoadedFor] = useState(""); const [editing, setEditing] = useState<PlanningGoal | null | undefined>(undefined); const [deleting, setDeleting] = useState<PlanningGoal | null>(null); const [status, setStatus] = useState("");
 const key = `pnc-account-planning-goals-v1-${customerId}`;
 useEffect(() => { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); setGoals(Array.isArray(value) ? value.filter(validGoal) : []); setStatus(""); } catch { setGoals([]); setStatus("Saved plans could not be read. You can still create goals for this session."); } setLoadedFor(customerId); }, [key, customerId]);
 function persist(next: PlanningGoal[], message: string) { setGoals(next); try { localStorage.setItem(key, JSON.stringify(next)); setStatus(message); } catch { setStatus(`${message} Storage is unavailable; this change lasts for this session only.`); } }
 const accounts = (data?.account ?? []).filter(account => account.account_type === "savings").map(account => ({ id: account.account_id, name: "PNC savings" }));
 for (const account of data?.external_account ?? []) if (account.account_type === "savings") accounts.push({ id: account.account_id, name: account.nickname || `${account.institution} savings` });
 return <section className="account-section" aria-labelledby="financial-goals-title"><div className="account-section-heading"><div><h2 id="financial-goals-title">Your Financial Goals</h2></div><button disabled={loadedFor !== customerId} onClick={() => setEditing(null)}>+ Add Goal</button></div><p className="account-status" role="status">{status}</p><div className="planning-goal-sections">{(["short", "long"] as const).map(term => <div key={term}><h3>{term === "short" ? "Short-Term Goals" : "Long-Term Goals"}</h3><div className="planning-goals-grid">{loadedFor === customerId && goals.filter(goal => goal.term === term).map(goal => <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} onDelete={() => setDeleting(goal)} />)}</div>{loadedFor === customerId && !goals.some(goal => goal.term === term) && <p className="planning-empty">Add a {term === "short" ? "short-term" : "long-term"} goal to get started.</p>}</div>)}</div>{editing !== undefined && <GoalModal goal={editing} accounts={accounts} onClose={() => setEditing(undefined)} onSave={goal => { persist(goals.some(item => item.id === goal.id) ? goals.map(item => item.id === goal.id ? goal : item) : [...goals, goal], "Goal saved."); setEditing(undefined); }} />}{deleting && <AccountModal title="Delete goal?" onClose={() => setDeleting(null)}><p>Delete “{deleting.name}” from your local plans?</p><div className="account-modal-actions"><button onClick={() => setDeleting(null)}>Cancel</button><button className="account-primary-button" onClick={() => { persist(goals.filter(goal => goal.id !== deleting.id), "Goal deleted."); setDeleting(null); }}>Delete Goal</button></div></AccountModal>}</section>;
}
