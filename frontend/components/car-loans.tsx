"use client";
import { useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import LiveDataProvider, { useLiveData } from "@/components/live-data-provider";
import type { CarOptionRow } from "@/lib/live-data";

const usd = (c: number) => `${c < 0 ? "−" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const signed = (c: number) => (Math.round(c / 100) === 0 ? "No change" : `${c > 0 ? "+" : "−"}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}/mo`);
const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(100 * x)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (ym: string | null) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "Not at this pace");
const VERDICT: Record<string, string> = { comfortable: "Comfortable", tight: "Tight", risky: "Risky" };

const NEXT_STEP: Record<string, { title: string; action: string; kind: string }> = {
  keep: { title: "Your current loan is already the best fit", action: "Remind me to check again next month", kind: "Self-service" },
  extra: { title: "Set up an extra $100 a month toward principal", action: "Set up extra autopay", kind: "Self-service" },
  refinance: { title: "Refinance at the lower rate", action: "Start a refinance application", kind: "Eligible offer" },
  payoff: { title: "Pay off the loan from savings", action: "Get a payoff quote", kind: "Self-service" },
  trade_in: { title: "Trade in for this year's model", action: "Book a dealer appraisal", kind: "Follow-up" },
};

export default function CarLoans() {
  return <LiveDataProvider><CarLoansInner /></LiveDataProvider>;
}

function CarLoansInner() {
  const { data, customerId, error, call } = useLiveData();
  const vehicle = data?.vehicle?.[0];
  const options = (data?.car_option ?? []).slice().sort((a, b) => a.rank - b.rank);
  const best = options.find(o => o.is_best);
  const loanAccount = vehicle ? data?.account.find(a => a.account_id === vehicle.account_id) : undefined;
  const keep = options.find(o => o.kind === "keep");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ busy: boolean; text: string | null; error: string | null }>({ busy: false, text: null, error: null });
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const autoRan = useRef<string | null>(null);

  // customers with a car but no computed options yet: compute them once, automatically
  useEffect(() => {
    if (!vehicle || options.length || running || autoRan.current === customerId) return;
    autoRan.current = customerId;
    setRunning(true); setRunError(null);
    call("run_car_options", { customer_id: customerId }).catch(e => setRunError((e as Error).message)).finally(() => setRunning(false));
  }, [vehicle, options.length, customerId, running, call]);
  useEffect(() => { setExplain({ busy: false, text: null, error: null }); setDemoNote(null); }, [customerId]);

  async function explainOptions() {
    setExplain({ busy: true, text: null, error: null });
    try {
      const r = await fetch("/api/car-explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setExplain({ busy: false, text: body.text, error: null });
    } catch (e) { setExplain({ busy: false, text: null, error: (e as Error).message }); }
  }

  const rows: { label: string; cell: (o: CarOptionRow) => string; hint?: string }[] = [
    { label: "Monthly car payment", cell: o => (o.monthly_payment_cents > 0 ? `${usd(o.monthly_payment_cents)}/mo` : "None") },
    { label: "Change vs today", cell: o => (o.kind === "keep" ? "—" : signed(o.payment_change_cents)) },
    { label: "Cash needed today", cell: o => (o.upfront_cash_cents > 0 ? usd(o.upfront_cash_cents) : "$0") },
    { label: "Interest", cell: o => (o.kind === "trade_in" ? `${usd(o.interest_cents)} on new loan` : o.kind === "keep" ? `${usd(o.interest_cents)} left` : `Saves ${usd(o.interest_saved_cents)}`) },
    { label: "Car paid off", cell: o => (o.kind === "payoff" ? "Today" : month(o.payoff_month)) },
    { label: "Cash cushion after", cell: o => `${o.cushion_months.toFixed(1)} months`, hint: "Cash ÷ monthly bills (incl. the car). Guideline: 3+ months." },
    { label: "Chance of running low (180 days)", cell: o => pct(o.p_low), hint: "Chance cash drops under $500 in the next 180 days." },
    { label: "Debt payments ÷ income", cell: o => pct(o.dti_after) },
  ];

  return (
    <div className="pnc-dash car-page">
      <AppHeader current="cars" />
      <main className="car-main" aria-label="Car loans">
        <div className="car-heading">
          <h1>Car loans</h1>
          <p>Your Toyota and your options, each one run through your own cash forecast. What&apos;s the smartest next move?</p>
        </div>

        {error && <div className="live-error" role="alert">Can’t load live data from SpacetimeDB: {error}</div>}
        {data && !vehicle && (
          <section className="panel car-empty"><p>{customerId} doesn&apos;t have a financed vehicle in this data. Switch to a customer with a car loan, for example C006 or C002, from the account menu.</p></section>
        )}

        {vehicle && (
          <>
            <section className="panel car-vehicle" aria-label="Your vehicle">
              <div>
                <span className="car-eyebrow">Your vehicle</span>
                <h2>{vehicle.model_year} {vehicle.make} {vehicle.model}</h2>
                <p>{vehicle.mileage.toLocaleString("en-US")} miles</p>
              </div>
              <dl>
                <div><dt>Loan balance</dt><dd>{loanAccount ? usd(loanAccount.balance_cents) : "—"}</dd></div>
                <div><dt>Rate</dt><dd>{loanAccount ? `${loanAccount.apr_pct}% APR` : "—"}</dd></div>
                <div><dt>Payment</dt><dd>{keep ? `${usd(keep.monthly_payment_cents)}/mo` : "—"}</dd></div>
                <div><dt>Paid off at this pace</dt><dd>{keep ? month(keep.payoff_month) : "—"}</dd></div>
                <div><dt>Trade-in value</dt><dd>{usd(vehicle.trade_in_estimate_cents)} <small>estimate</small></dd></div>
              </dl>
            </section>

            <section className="panel car-options" aria-labelledby="car-options-title">
              <div className="panel-heading"><div><h2 id="car-options-title">Your options</h2><p className="car-sub">Same thousands of simulated futures for every option, so the differences come from the choice, not luck.</p></div></div>
              {running && <p className="car-status">Running your options through the forecast…</p>}
              {runError && <p className="coach-error" role="alert">{runError}</p>}
              {options.length > 0 && (
                <div className="car-table-wrap">
                  <table className="car-table">
                    <thead>
                      <tr>
                        <th scope="col"><span className="sr-only">Measure</span></th>
                        {options.map(o => (
                          <th key={o.kind} scope="col" className={o.is_best ? "is-best" : undefined}>
                            {o.is_best && <span className="car-badge best">Best money move</span>}
                            {o.kind === "trade_in" && <span className="car-badge upgrade">Upgrade</span>}
                            <strong>{o.label}</strong>
                            <span className="car-detail">{o.detail}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.label}>
                          <th scope="row">{r.label}{r.hint && <span className="car-hint">{r.hint}</span>}</th>
                          {options.map(o => <td key={o.kind} className={o.is_best ? "is-best" : undefined}>{r.cell(o)}</td>)}
                        </tr>
                      ))}
                      <tr>
                        <th scope="row">Verdict</th>
                        {options.map(o => <td key={o.kind} className={o.is_best ? "is-best" : undefined}><span className="coach-verdict" data-verdict={o.verdict}>{VERDICT[o.verdict] ?? o.verdict}</span></td>)}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="car-note">How the best move is picked (fixed rule, not the AI): the option that saves the most interest while the verdict is no worse than today and cash still covers 3+ months of bills. Trade-in is shown as an upgrade, not a money-saving pick.</p>
            </section>

            <div className="car-grid">
              <section className="panel car-explain" aria-labelledby="car-explain-title">
                <div className="panel-heading"><div><h2 id="car-explain-title">What the coach says</h2></div></div>
                <div className="car-body">
                  {!explain.text && <button type="button" className="car-button" disabled={explain.busy || !options.length} onClick={explainOptions}>{explain.busy ? "Explaining…" : "Explain my options"}</button>}
                  {explain.error && <p className="coach-error" role="alert">{explain.error}</p>}
                  {explain.text && <p className="coach-text">{explain.text}</p>}
                  <p className="car-note">Every number the coach says is checked against these results first. Offers are samples, the trade-in value is an estimate, and the data is synthetic — not financial advice.</p>
                </div>
              </section>
              {best && (
                <section className="panel car-next" aria-labelledby="car-next-title">
                  <div className="panel-heading"><div><h2 id="car-next-title">Your next step</h2></div></div>
                  <div className="car-body">
                    <span className="car-eyebrow">{NEXT_STEP[best.kind]?.kind}</span>
                    <p className="car-next-title">{NEXT_STEP[best.kind]?.title}</p>
                    <div className="car-actions">
                      <button type="button" className="car-button" onClick={() => setDemoNote(`Demo: in production this would start “${NEXT_STEP[best.kind]?.action}” for ${customerId}.`)}>{NEXT_STEP[best.kind]?.action}</button>
                      <button type="button" className="car-button secondary" onClick={() => setDemoNote(`Demo: in production this would schedule a call with a Toyota Financial Services advisor for ${customerId}.`)}>Talk to an advisor</button>
                    </div>
                    {demoNote && <p className="car-note" role="status">{demoNote}</p>}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
