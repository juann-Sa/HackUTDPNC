"use client";
import { useLiveData } from "./live-data-provider";
import type { CoachActionRow } from "@/lib/live-data";

const usd = (c: number) => `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const pct = (x: number) => (x > 0 && x < 0.001 ? "<0.1%" : `${(100 * x).toFixed(1)}%`);
const TITLES: Record<string, (a: CoachActionRow) => string> = {
  move_cash_to_debt: a => `Put ${usd(a.amount_cents)} toward debt`,
  close_monthly_gap: a => `Reduce spending by ${usd(a.amount_cents)} per month`,
  trim_discretionary: a => `Reduce extras by ${usd(a.amount_cents)} per month`,
  trim_category: a => `Cut ${a.driver.replace("spend:", "").replace(/_/g, " ") || "category spending"} by ${usd(a.amount_cents)} per month`,
  protect_income: () => "Protect your income",
  reserve_for_surprises: a => `Reserve ${usd(a.amount_cents)} for surprises`,
};
const ORDER = ["move_cash_to_debt", "close_monthly_gap", "trim_category", "trim_discretionary", "reserve_for_surprises", "protect_income"];

/** The coach's recommended actions for this customer (coach_action table), with what each one changes. */
export default function CoachActions({ title = "Recommendation", maxItems }: { title?: string; maxItems?: number }) {
  const { data, error, loading } = useLiveData();
  const actions = (data?.coach_action ?? []).slice().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const visibleActions = maxItems == null ? actions : actions.slice(0, maxItems);
  return (
    <section className="panel coach-actions" aria-labelledby="actions-title">
      <div className="panel-heading"><div><h2 id="actions-title">{title}</h2></div></div>
      {loading ? <p className="actions-empty" role="status">Loading…</p> : error ? (
        <p className="actions-empty" role="alert">Recommendations are unavailable right now.</p>
      ) : !data ? (
        <p className="actions-empty">No recommendation data is available.</p>
      ) : actions.length === 0 ? (
        <p className="actions-empty">No recommendations yet. Run <code>run_forecast</code> for this customer.</p>
      ) : (
        <ol className="action-list">
          {visibleActions.map(a => {
            const riskChanged = Math.abs(a.p_low_after - a.p_low_before) >= 0.0005;
            const esChanged = Math.abs(a.es_after_cents - a.es_before_cents) >= 100;
            return (
              <li key={a.kind} className="action-card">
                <strong>{(TITLES[a.kind] ?? (() => a.kind.replace(/_/g, " ")))(a)}</strong>
                <details className="action-details"><summary>View details</summary><p>{a.detail}</p><div className="action-chips">{esChanged && <span className={`chip ${a.es_after_cents < a.es_before_cents ? "chip-good" : "chip-warn"}`}>Bad-case loss: {usd(a.es_before_cents)} → {usd(a.es_after_cents)}</span>}</div></details>
                <div className="action-chips">
                  {a.annual_saving_cents > 0 && <span className="chip chip-good">Saves {usd(a.annual_saving_cents)} a year</span>}
                  {riskChanged && <span className={`chip ${a.p_low_after > a.p_low_before ? "chip-warn" : "chip-good"}`}>Risk of running low: {pct(a.p_low_before)} → {pct(a.p_low_after)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
