"use client";
import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useLiveData } from "./live-data-provider";
import { asOfDate } from "@/lib/live-data";

const usd = (c: number) => `${c < 0 ? "−" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(100 * x)}%`);
const addDays = (iso: string, n: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Savings goals: create one, see the chance of reaching it and what it would take (goal / goal_result tables). */
export default function GoalsPanel() {
  const { data, customerId, call } = useLiveData();
  const asOf = data ? asOfDate(data) : "";
  const [name, setName] = useState("");
  const [kind, setKind] = useState("save_extra");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = new Map((data?.goal_result ?? []).map(r => [r.goal_id, r]));
  const goals = (data?.goal ?? []).slice().sort((a, b) => (a.target_date < b.target_date ? -1 : 1));
  const minDate = asOf ? addDays(asOf, 7) : undefined;
  const maxDate = asOf ? addDays(asOf, 365) : undefined;

  async function add(event: FormEvent) {
    event.preventDefault();
    const dollars = Number(amount.replace(/[$,\s]/g, ""));
    if (!name.trim() || !(dollars > 0) || !date) { setError("Give the goal a name, an amount and a date."); return; }
    setBusy(true); setError(null);
    try {
      await call("add_goal", { customer_id: customerId, name: name.trim(), kind, target_cents: Math.round(dollars * 100), target_date: date });
      setName(""); setAmount(""); setDate("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(goal_id: string) {
    setBusy(true); setError(null);
    try { await call("remove_goal", { goal_id }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="panel goals-panel" aria-labelledby="goals-title">
      <div className="panel-heading"><div><h2 id="goals-title">Savings goals</h2></div></div>
      <ul className="goal-list">
        
        {goals.map(g => {
          const r = results.get(g.goal_id);
          const p = r?.p_success ?? 0;
          return (
            <li key={g.goal_id} className="goal-card">
              <div className="goal-head">
                <div><strong>{g.name}</strong><span>{g.kind === "save_extra" ? `Save ${usd(g.target_cents)} more` : `Have ${usd(g.target_cents)} in cash`} by {pretty(g.target_date)}</span></div>
                <button type="button" className="icon-button" aria-label={`Remove goal ${g.name}`} disabled={busy} onClick={() => remove(g.goal_id)}><Trash2 size={14} /></button>
              </div>
              {r ? (
                <>
                  <div className="goal-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * p)} aria-label="Chance of reaching the goal"><span style={{ width: `${Math.max(2, 100 * p)}%` }} data-level={p >= 0.8 ? "good" : p >= 0.5 ? "ok" : "low"} /></div>
                  <p className="goal-line"><b>{pct(p)}</b> chance at today&apos;s pace · likely {usd(r.low_cents)} to {usd(r.high_cents)} {g.kind === "save_extra" ? "saved" : "in cash"} by then</p>
                  {p < 0.8 && (
                    r.needed_80_cents != null ? (
                      <p className="goal-tip">Keep an extra <b>{usd(r.needed_80_cents)} a month</b> for an 80% chance{r.needed_share_of_extras != null ? ` (${Math.round(100 * r.needed_share_of_extras)}% of your monthly dining, shopping and other spending)` : ""}.</p>
                    ) : (
                      <p className="goal-tip">Spending less alone can&apos;t get this to 80%; it needs more income, a smaller target or a later date.</p>
                    )
                  )}
                </>
              ) : <p className="goal-line">Working it out…</p>}
            </li>
          );
        })}
      </ul>
      <form className="goal-form" onSubmit={add}>
        <input aria-label="Goal name" placeholder="Goal name (e.g. Emergency fund)" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        <select aria-label="Goal type" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="save_extra">Save this much more</option>
          <option value="reach_balance">Have this much in cash</option>
        </select>
        <input aria-label="Amount in dollars" placeholder="$ amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <input aria-label="Target date" type="date" min={minDate} max={maxDate} value={date} onChange={e => setDate(e.target.value)} />
        <button type="submit" disabled={busy || !data}>{busy ? "Working…" : "Add goal"}</button>
      </form>
      {error && <p className="coach-error" role="alert">{error}</p>}
      <p className="goal-note">Dates count from the data&apos;s last day ({asOf ? pretty(asOf) : "…"}), between 1 week and 1 year out.</p>
    </section>
  );
}
