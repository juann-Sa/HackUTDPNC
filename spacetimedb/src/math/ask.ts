// Free-form questions → a bounded what-if scenario.
// The model only translates the question into parameters; code validates and clamps them,
// the engine computes the outcome, and the verdict comes from fixed rules, not the model.
import { CATEGORIES, type Category } from './calendar';
import { type Assumptions, type ForecastResult, type NewLoan, type Scenario, amortizedPayment, habitAssumptions, makeTapes, runForecast } from './forecast';
import { type Fact, pct, usd } from './narrate';
import type { Schedule } from './schedule';

export const PARSE_PROMPT = [
  'You turn a banking customer\'s question into a what-if scenario. Reply with JSON only, no prose.',
  'Fields (use the default for anything the question does not mention):',
  '"supported": true if the question is about a change in income, spending, a one-time expense or purchase, buying something with a loan,',
  'using cash to pay down debt, or losing a job; otherwise false.',
  '"income_mult": income multiplier, default 1 (e.g. a 10% pay cut = 0.9, a 5% raise = 1.05).',
  `"category_mults": object of spending multipliers by category, default {}; categories: ${CATEGORIES.join(', ')}`,
  '(e.g. "eat out half as much" = {"dining": 0.5}).',
  '"one_off_cents": a single expense in cents, default 0 (e.g. "$2,000 trip" = 200000).',
  '"one_off_in_days": days from today until that expense, 0-179, default 30. Use the date you are given to convert dates.',
  '"move_to_debt_cents": cash used to pay down high-interest debt, in cents, default 0.',
  '"job_loss_months": months with no paycheck starting now, 0-6, default 0.',
  'For buying something with a loan (a car, a home, furniture on financing), use these instead of one_off_cents:',
  '"purchase_kind": "car", "home" or "other", default "";',
  '"purchase_price_cents": full price in cents, default 0; "down_payment_cents": cash paid up front in cents, default 0;',
  '"loan_apr_pct": the loan\'s yearly interest rate in percent if the customer gives one, else null;',
  '"loan_term_months": loan length in months if given, else null; "purchase_in_days": days from today until the purchase, 0-179, default 30.',
  'If the customer buys something outright with cash, use one_off_cents instead.',
  '"summary": a short restatement of the scenario in plain words.',
  'If the question is NOT a what-if (supported false), set "topic" to the summary that answers it best:',
  '"overview" (overall financial health, net worth, how am I doing), "past" (what happened to my money, where it went),',
  '"future" (where am I headed, what will my balance be), "coach" (what should I do, paying off debt, when will I be debt-free, saving interest),',
  '"risk" (how safe am I, emergencies, worst case, could I run out of money), "goals" (my savings goals),',
  'or "none" if it is not about their own finances. Default "none".',
].join(' ');

/** Summaries the router can send a non-what-if question to (same topics as the narrate procedure). */
export const ROUTE_TOPICS = ['overview', 'past', 'future', 'coach', 'risk', 'goals'] as const;
export type RouteTopic = (typeof ROUTE_TOPICS)[number];
export const TOPIC_LABELS: Record<RouteTopic, string> = {
  overview: 'your overall financial health', past: 'what happened to your money', future: 'where your money is headed',
  coach: 'what to do next and paying off debt', risk: 'how well you could handle a shock', goals: 'your savings goals',
};

export interface ParsedScenario {
  supported: boolean;
  incomeMult: number;
  categoryMult: Partial<Record<Category, number>>;
  oneOffCents: number;
  oneOffInDays: number;
  moveToDebtCents: number;
  jobLossMonths: number;
  /** financed purchase; undefined when the question has none */
  purchase?: { kind: 'car' | 'home' | 'other'; priceCents: number; downCents: number; aprPct: number; termMonths: number; inDays: number; aprGiven: boolean; termGiven: boolean };
  summary: string;
  /** for non-what-if questions: which summary answers it ('none' = off-topic) */
  topic: RouteTopic | 'none';
}

/** Defaults when the customer doesn't say (in line with the starter data's loans: auto 7.5%, mortgage 6.5%). */
export const LOAN_DEFAULTS = {
  car: { aprPct: 7.5, termMonths: 60 },
  home: { aprPct: 6.5, termMonths: 360 },
  other: { aprPct: 11, termMonths: 36 },
} as const;

const clamp = (x: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof x === 'number' && Number.isFinite(x) ? x : dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** Validate and clamp whatever the model returned; anything malformed falls back to "no change". */
export function parseScenario(raw: string): ParsedScenario {
  let j: Record<string, unknown> = {};
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    j = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    j = {};
  }
  const cm: Partial<Record<Category, number>> = {};
  const rawCm = (j.category_mults ?? {}) as Record<string, unknown>;
  for (const c of CATEGORIES) if (rawCm && typeof rawCm === 'object' && c in rawCm) cm[c] = clamp(rawCm[c], 0, 3, 1);
  return {
    supported: j.supported === true,
    incomeMult: clamp(j.income_mult, 0, 1.5, 1),
    categoryMult: cm,
    oneOffCents: Math.round(clamp(j.one_off_cents, 0, 100_000_000, 0)),
    oneOffInDays: Math.round(clamp(j.one_off_in_days, 0, 179, 30)),
    moveToDebtCents: Math.round(clamp(j.move_to_debt_cents, 0, 100_000_000, 0)),
    jobLossMonths: Math.round(clamp(j.job_loss_months, 0, 6, 0)),
    purchase: parsePurchase(j),
    summary: typeof j.summary === 'string' ? j.summary.slice(0, 200) : '',
    topic: (ROUTE_TOPICS as readonly string[]).includes(j.topic as string) ? (j.topic as RouteTopic) : 'none',
  };
}

function parsePurchase(j: Record<string, unknown>): ParsedScenario['purchase'] {
  const price = Math.round(clamp(j.purchase_price_cents, 0, 200_000_000, 0));
  if (price <= 0) return undefined;
  const kind = j.purchase_kind === 'car' || j.purchase_kind === 'home' ? j.purchase_kind : 'other';
  const d = LOAN_DEFAULTS[kind];
  const aprGiven = typeof j.loan_apr_pct === 'number' && Number.isFinite(j.loan_apr_pct);
  const termGiven = typeof j.loan_term_months === 'number' && Number.isFinite(j.loan_term_months);
  return {
    kind,
    priceCents: price,
    downCents: Math.round(clamp(j.down_payment_cents, 0, price, 0)),
    aprPct: clamp(j.loan_apr_pct, 0, 36, d.aprPct),
    termMonths: Math.round(clamp(j.loan_term_months, 6, 360, d.termMonths)),
    inDays: Math.round(clamp(j.purchase_in_days, 0, 179, 30)),
    aprGiven,
    termGiven,
  };
}

export type Verdict = 'comfortable' | 'tight' | 'risky';

/** Fixed rules: risky if the chance of running low passes 20% or median cash ends below zero;
 *  tight if it passes 5% or median cash ends below one month of essential bills; else comfortable. */
export function verdict(pLow: number, endMedianCents: number, monthlyOutflowCents: number, cushionMonths?: number): Verdict {
  if (pLow > 0.2 || endMedianCents < 0 || (cushionMonths !== undefined && cushionMonths < 1)) return 'risky';
  if (pLow > 0.05 || endMedianCents < monthlyOutflowCents || (cushionMonths !== undefined && cushionMonths < EMERGENCY_MONTHS)) return 'tight';
  return 'comfortable';
}

/** Emergency-fund guideline used for purchase questions: cash covering this many months of bills
 *  (same 3-month cushion the coach keeps). With a purchase, the verdict is at best "tight" below it. */
export const EMERGENCY_MONTHS = 3;

export const ANSWER_TOPIC = (q: string) =>
  `Answer the customer's question in two to four sentences using only the facts that bear on it; if the facts do not answer it, say what you can and what is not known. The question was: "${q}"`;

export const ANSWER_ASK =
  'Answer the customer\'s question using only these facts. Start with the verdict in plain words, then the two or three numbers that matter most, then one practical tip.';

/** Run a parsed question against the baseline (same random draws) and build the facts for the answer. */
export function evaluateQuestion(
  s: Schedule, outflowCents: number, p: ParsedScenario, seed: number, a: Assumptions,
  book?: { incomeCents: number; debtPaymentsCents: number },
) {
  const tapes = makeTapes(seed, a, s.months.length + 1);
  const pu = p.purchase;
  const newLoan: NewLoan | undefined = pu && {
    dayIndex: pu.inDays,
    downCents: pu.downCents,
    principalCents: pu.priceCents - pu.downCents,
    aprPct: pu.aprPct,
    paymentCents: Math.round(amortizedPayment(pu.priceCents - pu.downCents, pu.aprPct, pu.termMonths)),
    label: pu.kind === 'other' ? 'purchase' : pu.kind,
  };
  const sc: Scenario = {
    id: 'what_if', label: 'What if', includeExternal: false, incomeMult: p.incomeMult, categoryMult: p.categoryMult,
    oneOff: p.oneOffCents > 0 ? { dayIndex: p.oneOffInDays, cents: p.oneOffCents } : undefined,
    moveToDebtCents: p.moveToDebtCents, jobLossMonths: p.jobLossMonths, newLoan,
  };
  const baseRun = runForecast(s, a, { id: 'baseline', label: 'If nothing changes', includeExternal: false }, tapes);
  const whatIf: ForecastResult = runForecast(s, a, sc, tapes);
  const h = habitAssumptions(a);
  const habit: ForecastResult = runForecast(s, h, sc, makeTapes(seed, h, s.months.length + 1));
  // emergency cushion: median cash right after the purchase, in months of bills (bills now include the new payment)
  const nlPay = newLoan?.paymentCents ?? 0;
  const cushionNow = baseRun.bands[0].p50 / Math.max(outflowCents, 1);
  const afterIdx = Math.min(whatIf.bands.length - 1, (newLoan?.dayIndex ?? 0) + 1);
  const cushionAfter = newLoan ? whatIf.bands[afterIdx].p50 / Math.max(outflowCents + nlPay, 1) : undefined;
  const v = verdict(whatIf.pLow, whatIf.endLiquid.p50, outflowCents + nlPay, cushionAfter);

  const parts: string[] = [];
  if (pu && newLoan)
    parts.push(
      `a ${usd(pu.priceCents)} ${newLoan.label} in ${pu.inDays} days with ${usd(pu.downCents)} down, ` +
        `borrowing ${usd(newLoan.principalCents)} at ${pu.aprPct}% for ${pu.termMonths} months` +
        (pu.aprGiven && pu.termGiven ? '' : ' (rate/term assumed where not given)'),
    );
  if (p.oneOffCents > 0) parts.push(`a one-time expense of ${usd(p.oneOffCents)} in ${p.oneOffInDays} days`);
  if (p.incomeMult !== 1) parts.push(`income ${p.incomeMult > 1 ? 'up' : 'down'} ${pct(Math.abs(1 - p.incomeMult), 0)}`);
  for (const [c, m] of Object.entries(p.categoryMult)) if (m !== 1) parts.push(`${c.replace('_', ' ')} spending ${(m as number) > 1 ? 'up' : 'down'} ${pct(Math.abs(1 - (m as number)), 0)}`);
  if (p.moveToDebtCents > 0) parts.push(`${usd(p.moveToDebtCents)} of cash used to pay down debt`);
  if (p.jobLossMonths > 0) parts.push(`no paycheck for ${p.jobLossMonths} months`);
  const interpretation = parts.length ? parts.join(', ') : 'no change';
  const lowest = whatIf.bands.reduce((mn, b) => Math.min(mn, b.p5), Infinity);
  const facts: Fact[] = [
    { key: 'ask_scenario', text: `Scenario checked: ${interpretation}` },
    { key: 'ask_verdict', text: `Verdict from the bank's rules: ${v}` },
    { key: 'ask_cash', text: `Cash in 180 days: about ${usd(baseRun.endLiquid.p50)} if nothing changes, about ${usd(whatIf.endLiquid.p50)} with this change` },
    { key: 'ask_risk', text: `Chance cash drops below ${usd(a.thresholdCents)} in the next 180 days: ${pct(baseRun.pLow)} now, ${pct(whatIf.pLow)} with this change` },
    { key: 'ask_low', text: `Lowest likely cash point with this change (only a 1-in-20 chance of lower): ${usd(lowest)}` },
  ];
  if (pu && newLoan) {
    const totalInterest = newLoan.paymentCents * pu.termMonths - newLoan.principalCents;
    facts.push({ key: 'ask_payment', text: `New loan payment: ${usd(newLoan.paymentCents)} a month for ${pu.termMonths} months; total interest about ${usd(Math.max(0, totalInterest))}` });
    facts.push({
      key: 'ask_cushion',
      text: `Emergency cushion (cash divided by monthly bills): about ${cushionNow.toFixed(1)} months now, about ${cushionAfter!.toFixed(1)} months right after the purchase; the bank's guideline is at least ${EMERGENCY_MONTHS} months`,
    });
    if (book && book.incomeCents > 0) {
      const before = book.debtPaymentsCents / book.incomeCents;
      const after = (book.debtPaymentsCents + newLoan.paymentCents) / book.incomeCents;
      facts.push({ key: 'ask_dti', text: `Share of income going to debt payments: ${pct(before, 0)} now, ${pct(after, 0)} with the new loan (36% or less is the usual lender guideline)` });
    }
    if (!pu.aprGiven || !pu.termGiven)
      facts.push({ key: 'ask_assumed', text: `Assumed loan terms where you didn't say: ${pu.aprPct}% interest, ${pu.termMonths} months` });
  }
  const nextDanger = whatIf.danger.find(d => d.pBelow >= 0.1);
  if (nextDanger)
    facts.push({ key: 'danger', text: `Next day your checking could dip below ${usd(a.dangerThresholdCents)} with this change: ${nextDanger.date} (${pct(nextDanger.pBelow, 0)} chance)` });
  return { whatIf, habit, verdict: v, interpretation, facts, cushionNow, cushionAfter, fallback: facts.map(f => f.text).join('. ') + '.' };
}
