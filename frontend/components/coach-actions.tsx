"use client";
import { useLiveData } from "./live-data-provider";
import type { CoachActionRow } from "@/lib/live-data";

const usd = (c: number) => `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const pct = (x: number) => (x > 0 && x < 0.001 ? "<0.1%" : `${(100 * x).toFixed(1)}%`);
const TITLES: Record<string, (a: CoachActionRow) => string> = {
  move_cash_to_debt: a => `Put ${usd(a.amount_cents)} of spare cash toward expensive debt`,
  close_monthly_gap: () => "Close the monthly gap",
  trim_discretionary: a => `Trim extras by ${Math.round(100 * a.fraction)}%`,
  trim_category: a => `Trim ${a.driver.replace("spend:", "").replace("_", " ") || "one category"}`,
  protect_income: () => "Protect your income",
  reserve_for_surprises: a => `Set aside ${usd(a.amount_cents)} for surprise bills`,
};
const ORDER = ["move_cash_to_debt", "close_monthly_gap", "trim_category", "trim_discretionary", "reserve_for_surprises", "protect_income"];

/** The coach's recommended actions for this customer (coach_action table), with what each one changes. */
export default function CoachActions() {
  const { data } = useLiveData();
  const actions = (data?.coach_action ?? []).slice().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <section className="panel coach-actions" aria-labelledby="actions-title">
      <div className="panel-heading"><div><h2 id="actions-title">What the coach recommends</h2><p className="coach-sub">Specific moves, each tested on the same simulated futures.</p></div></div>
      {!data ? <p className="actions-empty">Loading…</p> : actions.length === 0 ? (
        <p className="actions-empty">No recommendations yet. Run <code>run_forecast</code> for this customer.</p>
      ) : (
        <ol className="action-list">
          {actions.map(a => {
            const riskChanged = Math.abs(a.p_low_after - a.p_low_before) >= 0.0005;
            const esChanged = Math.abs(a.es_after_cents - a.es_before_cents) >= 100;
            return (
              <li key={a.kind} className="action-card">
                <strong>{(TITLES[a.kind] ?? (() => a.kind.replace(/_/g, " ")))(a)}</strong>
                <p>{a.detail}</p>
                <div className="action-chips">
                  {a.annual_saving_cents > 0 && <span className="chip chip-good">Saves {usd(a.annual_saving_cents)} a year</span>}
                  {riskChanged && <span className={`chip ${a.p_low_after > a.p_low_before ? "chip-warn" : "chip-good"}`}>Chance of running low: {pct(a.p_low_before)} → {pct(a.p_low_after)}</span>}
                  {esChanged && <span className={`chip ${a.es_after_cents < a.es_before_cents ? "chip-good" : "chip-warn"}`}>Bad-case loss: {usd(a.es_before_cents)} → {usd(a.es_after_cents)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
