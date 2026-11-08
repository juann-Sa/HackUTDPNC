"use client";
import { useState, type FormEvent } from "react";
import AccountModal from "./AccountModal";
import { todayISO, type PlanningGoal } from "./goal-model";
interface GoalModalProps { goal: PlanningGoal | null; accounts: { id: string; name: string }[]; onSave: (goal: PlanningGoal) => void; onClose: () => void }
export default function GoalModal({ goal, accounts, onSave, onClose }: GoalModalProps) {
 const [name, setName] = useState(goal?.name ?? ""); const [term, setTerm] = useState<PlanningGoal["term"]>(goal?.term ?? "short");
 const [target, setTarget] = useState(String(goal?.target ?? "")); const [saved, setSaved] = useState(String(goal?.saved ?? 0)); const [date, setDate] = useState(goal?.date ?? "");
 const [description, setDescription] = useState(goal?.description ?? ""); const [accountId, setAccountId] = useState(goal?.accountId ?? ""); const [error, setError] = useState("");
 function submit(event: FormEvent) {
  event.preventDefault(); const targetAmount = Number(target); const savedAmount = Number(saved); const parsedDate = new Date(`${date}T12:00:00`);
  if (!name.trim()) { setError("Enter a goal name."); return; }
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) { setError("Target amount must be greater than zero."); return; }
  if (!Number.isFinite(savedAmount) || savedAmount < 0) { setError("Saved amount cannot be negative."); return; }
  if (!date || !Number.isFinite(parsedDate.getTime()) || todayISO(parsedDate) !== date || date <= todayISO()) { setError("Choose a valid future date."); return; }
  onSave({ id: goal?.id ?? crypto.randomUUID(), name: name.trim(), term, target: targetAmount, saved: savedAmount, date, description: description.trim(), accountId });
 }
 return <AccountModal title={goal ? "Edit goal" : "Add a financial goal"} onClose={onClose}><form className="account-form" onSubmit={submit} noValidate>
  <label>Goal name<input autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="e.g. Emergency fund" required /></label>
  <label>Goal type<select value={term} onChange={e => setTerm(e.target.value === "long" ? "long" : "short")}><option value="short">Short-term</option><option value="long">Long-term</option></select></label>
  <div className="account-form-grid"><label>Target amount (USD)<input type="number" min="0.01" step="0.01" value={target} onChange={e => setTarget(e.target.value)} required /></label><label>Currently saved (USD)<input type="number" min="0" step="0.01" value={saved} onChange={e => setSaved(e.target.value)} required /></label></div>
  <label>Target date<input type="date" value={date} min={todayISO()} onChange={e => setDate(e.target.value)} required /></label>
  <label>Description <span>(optional)</span><textarea value={description} maxLength={400} onChange={e => setDescription(e.target.value)} rows={3} /></label>
  <label>Linked savings account <span>(optional)</span><select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">No linked account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}{accountId && !accounts.some(account => account.id === accountId) && <option value={accountId}>Previously linked account (unavailable)</option>}</select></label>
  <p className="account-note">Saved amounts are entered by you. Linking an account adds a reference; it does not move money.</p>
  {error && <p className="account-error" role="alert">{error}</p>}<div className="account-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="account-primary-button" type="submit">Save Goal</button></div>
 </form></AccountModal>;
}
