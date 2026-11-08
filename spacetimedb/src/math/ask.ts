// Free-form questions → a bounded what-if scenario.
// The model only translates the question into parameters; code validates and clamps them,
// the engine computes the outcome, and the verdict comes from fixed rules, not the model.
import { CATEGORIES, type Category } from './calendar';
import { type Assumptions, type ForecastResult, type Scenario, habitAssumptions, makeTapes, runForecast } from './forecast';
import { type Fact, pct, usd } from './narrate';
import type { Schedule } from './schedule';

export const PARSE_PROMPT = [
  'You turn a banking customer\'s question into a what-if scenario. Reply with JSON only, no prose.',
  'Fields (use the default for anything the question does not mention):',
  '"supported": true if the question is about a change in income, spending, a one-time expense or purchase,',
  'using cash to pay down debt, or losing a job; otherwise false.',
  '"income_mult": income multiplier, default 1 (e.g. a 10% pay cut = 0.9, a 5% raise = 1.05).',
  `"category_mults": object of spending multipliers by category, default {}; categories: ${CATEGORIES.join(', ')}`,
  '(e.g. "eat out half as much" = {"dining": 0.5}).',
  '"one_off_cents": a single expense in cents, default 0 (e.g. "$2,000 trip" = 200000).',
  '"one_off_in_days": days from today until that expense, 0-179, default 30. Use the date you are given to convert dates.',
  '"move_to_debt_cents": cash used to pay down high-interest debt, in cents, default 0.',
  '"job_loss_months": months with no paycheck starting now, 0-6, default 0.',
  '"summary": a short restatement of the scenario in plain words.',
].join(' ');

export interface ParsedScenario {
  supported: boolean;
  incomeMult: number;
  categoryMult: Partial<Record<Category, number>>;
  oneOffCents: number;
  oneOffInDays: number;
  moveToDebtCents: number;
  jobLossMonths: number;
  summary: string;
}

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
    summary: typeof j.summary === 'string' ? j.summary.slice(0, 200) : '',
  };
}

export type Verdict = 'comfortable' | 'tight' | 'risky';

/** Fixed rules: risky if the chance of running low passes 20% or median cash ends below zero;
 *  tight if it passes 5% or median cash ends below one month of essential bills; else comfortable. */
export function verdict(pLow: number, endMedianCents: number, monthlyOutflowCents: number): Verdict {
  if (pLow > 0.2 || endMedianCents < 0) return 'risky';
  if (pLow > 0.05 || endMedianCents < monthlyOutflowCents) return 'tight';
  return 'comfortable';
}

export const ANSWER_ASK =
  'Answer the customer\'s question using only these facts. Start with the verdict in plain words, then the two or three numbers that matter most, then one practical tip.';

/** Run a parsed question against the baseline (same random draws) and build the facts for the answer. */
export function evaluateQuestion(s: Schedule, outflowCents: number, p: ParsedScenario, seed: number, a: Assumptions) {
  const tapes = makeTapes(seed, a, s.months.length + 1);
  const sc: Scenario = {
    id: 'what_if', label: 'What if', includeExternal: false, incomeMult: p.incomeMult, categoryMult: p.categoryMult,
    oneOff: p.oneOffCents > 0 ? { dayIndex: p.oneOffInDays, cents: p.oneOffCents } : undefined,
    moveToDebtCents: p.moveToDebtCents, jobLossMonths: p.jobLossMonths,
  };
  const baseRun = runForecast(s, a, { id: 'baseline', label: 'If nothing changes', includeExternal: false }, tapes);
  const whatIf: ForecastResult = runForecast(s, a, sc, tapes);
  const h = habitAssumptions(a);
  const habit: ForecastResult = runForecast(s, h, sc, makeTapes(seed, h, s.months.length + 1));
  const v = verdict(whatIf.pLow, whatIf.endLiquid.p50, outflowCents);

  const parts: string[] = [];
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
  const nextDanger = whatIf.danger.find(d => d.pBelow >= 0.1);
  if (nextDanger)
    facts.push({ key: 'danger', text: `Next day your checking could dip below ${usd(a.dangerThresholdCents)} with this change: ${nextDanger.date} (${pct(nextDanger.pBelow, 0)} chance)` });
  return { whatIf, habit, verdict: v, interpretation, facts, fallback: facts.map(f => f.text).join('. ') + '.' };
}
