// Forecast engine checks on real synthetic customers (pure functions, no database).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchedule, type LedgerRow, type AccountRow } from './math/schedule';
import { DEFAULT_ASSUMPTIONS, amortizedPayment, makeTapes, runForecast } from './math/forecast';
import { analyze, RISK_CAP } from './math/coach';
import { Draws, Tape, invNorm, seedFromString } from './math/rng';
import { PARSE_PROMPT, ROUTE_TOPICS, evaluateQuestion, parseScenario, verdict } from './math/ask';
import { auditReply } from './math/narrate';
import { addMonths, simulatePayoff } from './math/payoff';

const ROOT = process.env.ST360_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
function csv(name: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(join(ROOT, 'data', name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l: string) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c: string, i: number) => [c, v[i] ?? '']));
  });
}
function cents(s: string): number {
  const neg = s.startsWith('-');
  const [w, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -v : v;
}
const TX = csv('transactions.csv');
const AC = csv('accounts.csv');
function customer(cid: string): { ledger: LedgerRow[]; accounts: AccountRow[] } {
  return {
    ledger: TX.filter(r => r.customer_id === cid).map(r => ({
      transaction_id: r.transaction_id, account_id: r.account_id, account_type: r.account_type,
      posted_date: r.posted_date, transaction_type: r.transaction_type, category: r.category,
      description: r.description, flow_class: r.flow_class, amount_cents: cents(r.amount),
      balance_change_cents: cents(r.balance_change), balance_after_cents: cents(r.balance_after),
      transfer_id: r.transfer_id,
    })),
    accounts: AC.filter(r => r.customer_id === cid).map(r => ({
      account_id: r.account_id, account_type: r.account_type, balance_cents: cents(r.balance),
      apr_pct: Number(r.apr_pct), annual_yield_pct: Number(r.annual_yield_pct), monthly_payment_cents: cents(r.monthly_payment),
    })),
  };
}
const usd = (c: number) => `$${(c / 100).toFixed(0)}`;

describe('random numbers', () => {
  it('inverse normal is accurate and antithetic pairs mirror exactly', () => {
    expect(invNorm(0.975)).toBeCloseTo(1.959964, 5);
    expect(invNorm(0.001)).toBeCloseTo(-3.090232, 5);
    const tape = new Tape(42, 100, 500);
    const a = new Draws(tape, false);
    const b = new Draws(tape, true);
    for (let i = 0; i < 20; i++) expect(a.studentT(5) + b.studentT(5)).toBeCloseTo(0, 9);
  });
  it('student-t draws have unit variance', () => {
    const tape = new Tape(7, 20000, 100000);
    const d = new Draws(tape, false);
    const xs = Array.from({ length: 20000 }, () => d.studentT(5));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(v).toBeGreaterThan(0.85);
    expect(v).toBeLessThan(1.15);
  });
});

describe('forecast engine', () => {
  const { ledger, accounts } = customer('C006');
  const sched = buildSchedule(ledger, accounts, '2026-10-31', 180);
  const a = { ...DEFAULT_ASSUMPTIONS };

  it('builds a sensible schedule from the ledger', () => {
    expect(sched.months.map(m => m.m)).toEqual([11, 12, 1, 2, 3, 4]);
    expect(sched.startLiquid).toBe(2966516);
    console.log('C006 schedule:', JSON.stringify({
      income: sched.income.map(i => [i.day, usd(i.cents)]),
      card: sched.card && { pay: sched.card.payDay, paydown: usd(sched.card.paydown) },
      loans: sched.loans.map(l => [l.type, usd(l.payment), l.day]),
      locked: sched.locked.map(l => [l.type, usd(l.contribution)]),
      external: { in: usd(sched.external.inPerMonth), out: usd(sched.external.outPerMonth) },
      sigma: [sched.sigmaShared.toFixed(4), sched.sigmaIdio.toFixed(4), sched.phi.toFixed(2), sched.incomeSigma.toFixed(4)],
      novSpend: Object.fromEntries(Object.entries(sched.spend).map(([k, v]) => [k, usd(v.base[0])])),
      decShopping: usd(sched.spend.shopping.base[1]), janShopping: usd(sched.spend.shopping.base[2]),
    }));
  });

  it('is deterministic (same seed, same answer) and ES decomposes exactly', () => {
    const t1 = makeTapes(seedFromString('C006'), a, 7);
    const t2 = makeTapes(seedFromString('C006'), a, 7);
    const sc = { id: 'baseline', label: 'b', includeExternal: false };
    const r1 = runForecast(sched, a, sc, t1);
    const r2 = runForecast(sched, a, sc, t2);
    expect(r1.pLow).toBe(r2.pLow);
    expect(r1.bands[180].p50).toBe(r2.bands[180].p50);
    const esSum = r1.sources.reduce((s, x) => s + x.esContribution, 0);
    expect(esSum).toBeCloseTo(r1.es95, 4);
    const varSum = r1.sources.reduce((s, x) => s + x.varShare, 0);
    expect(varSum).toBeCloseTo(1, 6);
  });

  it('deterministic drift matches the ledger’s recent cash drift (external flows excluded)', () => {
    // last 6 months of the ledger: change in liquid minus net external transfers
    const liquid = ledger.filter(t => (t.account_type === 'checking' || t.account_type === 'savings') && t.posted_date >= '2026-05-01');
    const flow = liquid.reduce((s, t) => s + t.balance_change_cents, 0);
    const ext = liquid.filter(t => t.flow_class === 'external_transfer').reduce((s, t) => s + t.balance_change_cents, 0);
    const histMonthly = (flow - ext) / 6;
    const a2 = { ...a, pairs: 2 };
    const r = runForecast(sched, a2, { id: 'b', label: 'b', includeExternal: false }, makeTapes(1, a2, 7));
    const fcMonthly = r.deterministicChange / 6;
    console.log('C006 monthly drift: history', usd(histMonthly), 'forecast', usd(fcMonthly));
    expect(Math.abs(fcMonthly - histMonthly)).toBeLessThan(Math.abs(histMonthly) * 0.25 + 20_000);
  });

  it('runs the full analysis for C006 and C002', () => {
    for (const cid of ['C006', 'C002']) {
      const c = cid === 'C006' ? { ledger, accounts } : customer(cid);
      const s = buildSchedule(c.ledger, c.accounts, '2026-10-31', 180);
      for (const ext of [false, true]) {
        const t0 = Date.now();
        const an = analyze(s, a, seedFromString(cid), ext, cid === 'C006' ? 503699 : 0);
        const b = an.baseline;
        console.log(`\n${cid} external=${ext} (${Date.now() - t0} ms)`);
        console.log(`  baseline: P(low)=${(b.pLow * 100).toFixed(1)}%±${(b.pLowSe * 100).toFixed(1)}  end p5/p50/p95=${usd(b.endLiquid.p5)}/${usd(b.endLiquid.p50)}/${usd(b.endLiquid.p95)}  VaR95=${usd(b.var95)} ES95=${usd(b.es95)} MDD95=${usd(b.mddP95)} NW50=${usd(b.endNetWorth.p50)}`);
        console.log('  ES by source:', b.sources.filter(x => Math.abs(x.esContribution) > 1000).map(x => `${x.source}=${usd(x.esContribution)}`).join(' '));
        console.log('  stresses:', an.stresses.map(x => `${x.scenario.id}: P(low)=${(x.pLow * 100).toFixed(1)}% end50=${usd(x.endLiquid.p50)}`).join(' | '));
        console.log('  sensitivities:', an.sensitivities.map(x => `${x.lever} ΔP=${(x.deltaPLow * 100).toFixed(1)}pp Δend=${usd(x.deltaEndP50)}`).join(' | '));
        console.log('  frontier:', an.frontier.map(f => `${usd(f.moveCents)}→${(f.pLow * 100).toFixed(1)}%/${usd(f.annualSavingCents)}${f.recommended ? '*' : ''}`).join(' '));
        console.log('  actions:', an.actions.map(x => `${x.kind} ${usd(x.amountCents)} save ${usd(x.annualSavingCents)}/yr P ${(x.pLowBefore * 100).toFixed(1)}%→${(x.pLowAfter * 100).toFixed(1)}%`).join(' | '));
        console.log(`  coach: P(low)=${(an.coach.pLow * 100).toFixed(1)}% end50=${usd(an.coach.endLiquid.p50)} NW50=${usd(an.coach.endNetWorth.p50)}`);
        const rec = an.actions.find(x => x.kind === 'move_cash_to_debt');
        if (rec) expect(rec.pLowAfter).toBeLessThanOrEqual(RISK_CAP);
      }
    }
  }, 60_000);
});

describe('free-form questions', () => {
  it('validates and clamps whatever the model returns', () => {
    const p = parseScenario('Sure! {"supported": true, "income_mult": 5, "category_mults": {"dining": 0.5, "yachts": 0}, "one_off_cents": 200000, "one_off_in_days": 400, "summary": "trip"}');
    expect(p).toMatchObject({ supported: true, incomeMult: 1.5, categoryMult: { dining: 0.5 }, oneOffCents: 200000, oneOffInDays: 179 });
    expect(parseScenario('not json').supported).toBe(false);
    expect(parseScenario('{"supported": "yes"}').supported).toBe(false);
  });
  it('verdict comes from fixed rules', () => {
    expect(verdict(0.01, 500_000, 300_000)).toBe('comfortable');
    expect(verdict(0.08, 500_000, 300_000)).toBe('tight');
    expect(verdict(0.01, 200_000, 300_000)).toBe('tight');
    expect(verdict(0.3, 500_000, 300_000)).toBe('risky');
  });
  it('answers "can I afford a $2,000 trip in a month" for C006 with audited facts', () => {
    const { ledger, accounts } = customer('C006');
    const s = buildSchedule(ledger, accounts, '2026-10-31', 180);
    const p = parseScenario('{"supported": true, "one_off_cents": 200000, "one_off_in_days": 30}');
    const ev = evaluateQuestion(s, 503699, p, seedFromString('C006'), { ...DEFAULT_ASSUMPTIONS, pairs: 200 });
    expect(ev.interpretation).toBe('a one-time expense of $2,000 in 30 days');
    expect(['comfortable', 'tight', 'risky']).toContain(ev.verdict);
    expect(ev.whatIf.endLiquid.p50).toBeLessThan(ev.whatIf.endLiquid.p95);
    // the template answer itself passes the audit, and a plausible AI answer does too
    expect(auditReply(ev.fallback, ev.facts).ok).toBe(true);
    const cash = ev.facts.find(f => f.key === 'ask_cash')!.text.match(/\$[\d,]+/g)!;
    expect(auditReply(`Yes, it looks ${ev.verdict}: your cash would likely be about ${cash[1]} in 180 days instead of ${cash[0]}.`, ev.facts).ok).toBe(true);
    console.log(ev.fallback);
  }, 60_000);
});

describe('debt payoff', () => {
  it('matches the closed-form amortization for a plain loan', () => {
    // $10,000 at 12% APR, $222.45/month (222.44 rounded up) = 60 months (standard amortization)
    const r = simulatePayoff([{ id: 'L', type: 'personal_loan', balance: 1_000_000, aprPct: 12, payment: 22_245, isCard: false, paydown: 0 }], 0, false);
    expect(r.debts[0].months).toBe(60);
    expect(Math.abs(r.debts[0].interest - (60 * 22_245 - 1_000_000))).toBeLessThan(100);
  });
  it('a card that is not shrinking never pays off; the coach plan clears it and saves interest', () => {
    const debts = [
      { id: 'C', type: 'credit_card', balance: 500_000, aprPct: 22.5, payment: 0, isCard: true, paydown: -500 },
      { id: 'P', type: 'personal_loan', balance: 800_000, aprPct: 11, payment: 25_000, isCard: false, paydown: 0 },
      { id: 'A', type: 'auto_loan', balance: 900_000, aprPct: 7.5, payment: 20_000, isCard: false, paydown: 0 },
    ];
    const now = simulatePayoff(debts, 0, false);
    const plan = simulatePayoff(debts, 500_000, true);
    expect(now.debts[0].months).toBeUndefined();
    expect(now.consumerMonths).toBeUndefined();
    expect(plan.debts[0].months).toBe(0);
    expect(plan.consumerMonths!).toBeLessThan(now.debts[2].months!);
    expect(plan.totalInterest).toBeLessThan(now.totalInterest);
  });
  it('adds months across year ends', () => {
    expect(addMonths('2026-10-31', 3)).toBe('2027-01');
    expect(addMonths('2026-10-31', 14)).toBe('2027-12');
    expect(addMonths('2026-10-31', 0)).toBe('2026-10');
  });
});

describe('financed purchase (car loan)', () => {
  const { ledger, accounts } = customer('C006');
  const s = buildSchedule(ledger, accounts, '2026-10-31', 180);
  const a = { ...DEFAULT_ASSUMPTIONS, pairs: 150 };
  it('amortized payment matches the standard formula', () => {
    // $25,000 at 7.5% for 60 months = $500.95/month
    expect(Math.round(amortizedPayment(2_500_000, 7.5, 60))).toBe(50_095);
    expect(amortizedPayment(1_200_000, 0, 12)).toBe(100_000);
  });
  it('parses a car question, filling assumed terms, and clamps', () => {
    const p = parseScenario('{"supported": true, "purchase_kind": "car", "purchase_price_cents": 3000000, "down_payment_cents": 500000, "loan_apr_pct": null, "loan_term_months": null, "purchase_in_days": 400}');
    expect(p.purchase).toMatchObject({ kind: 'car', priceCents: 3_000_000, downCents: 500_000, aprPct: 7.5, termMonths: 60, inDays: 179, aprGiven: false });
    expect(parseScenario('{"supported": true, "purchase_price_cents": 100000, "down_payment_cents": 900000}').purchase!.downCents).toBe(100_000);
    expect(parseScenario('{"supported": true}').purchase).toBeUndefined();
  });
  it('a $30k car with $5k down: down payment and monthly payments hit cash; facts state cushion and DTI', () => {
    const p = parseScenario('{"supported": true, "purchase_kind": "car", "purchase_price_cents": 3000000, "down_payment_cents": 500000, "purchase_in_days": 30}');
    const base = parseScenario('{"supported": true}');
    const ev = evaluateQuestion(s, 503699, p, seedFromString('C006'), a, { incomeCents: 419905, debtPaymentsCents: 217218 });
    const ev0 = evaluateQuestion(s, 503699, base, seedFromString('C006'), a);
    // same random draws: before day 30 identical, after it lower by the down payment plus the payments made
    expect(ev.whatIf.bands[29].p50).toBeCloseTo(ev0.whatIf.bands[29].p50, 0);
    const gap = ev0.whatIf.bands[180].p50 - ev.whatIf.bands[180].p50;
    expect(gap).toBeGreaterThan(500_000 + 4 * 50_000);
    expect(gap).toBeLessThan(500_000 + 6 * 51_000);
    const keys = ev.facts.map(f => f.key);
    expect(keys).toEqual(expect.arrayContaining(['ask_payment', 'ask_cushion', 'ask_dti', 'ask_assumed']));
    expect(ev.facts.find(f => f.key === 'ask_payment')!.text).toContain('$501 a month');
    expect(ev.facts.find(f => f.key === 'ask_dti')!.text).toMatch(/52% now, 64% with the new loan/);
    expect(ev.cushionAfter!).toBeLessThan(ev.cushionNow);
    expect(ev.interpretation).toMatch(/\$30,000 car in 30 days with \$5,000 down, borrowing \$25,000 at 7.5% for 60 months/);
    // the template fallback passes the number audit
    expect(auditReply(ev.fallback, ev.facts).ok).toBe(true);
  });
  it('verdict caps at tight below a 3-month cushion and risky below 1 month', () => {
    expect(verdict(0.01, 900_000, 300_000, 2.5)).toBe('tight');
    expect(verdict(0.01, 900_000, 300_000, 0.5)).toBe('risky');
    expect(verdict(0.01, 900_000, 300_000, 4)).toBe('comfortable');
  });
});

describe('question router', () => {
  it('sends non-what-if questions to a summary topic and rejects unknown topics', () => {
    expect(parseScenario('{"supported": false, "topic": "coach"}').topic).toBe('coach');
    expect(parseScenario('{"supported": false, "topic": "risk"}').topic).toBe('risk');
    expect(parseScenario('{"supported": false, "topic": "weather"}').topic).toBe('none');
    expect(parseScenario('{"supported": false}').topic).toBe('none');
    expect(parseScenario('garbage').topic).toBe('none');
  });
  it('the prompt lists every routable topic', () => {
    for (const t of ROUTE_TOPICS) expect(PARSE_PROMPT).toContain(`"${t}"`);
  });
});
