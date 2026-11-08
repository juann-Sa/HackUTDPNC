// AI narration with a number guardrail.
// The model receives only "facts": sentences whose numbers were computed by this module.
// Every number in its reply must appear in those facts (or be a small calendar number);
// otherwise the reply is rejected and a deterministic template is used instead.

export interface Fact {
  key: string;
  text: string; // e.g. "Net cash today: $13,557"
}

export const usd = (cents: number) => {
  const v = Math.round(cents / 100);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

/** Numbers the model may use without a fact: day/month counts and the like. */
const FREE_NUMBERS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '30', '90', '180', '360', '100']);

const NUM_RE = /-?\$?\d[\d,]*(?:\.\d+)?%?/g;
const norm = (tok: string) => tok.replace(/[$,]/g, '').replace(/^-/, '');

export function allowedNumbers(facts: Fact[]): Set<string> {
  const s = new Set(FREE_NUMBERS);
  for (const f of facts) for (const m of f.text.match(NUM_RE) ?? []) s.add(norm(m));
  return s;
}

const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);

/**
 * Is `cand` an honest rounding of `fact`? Same kind (percent or not), at most 2% apart, and equal to
 * the fact rounded to fewer digits (e.g. $1,999 → $2,000, 1.46% → 1.5%). Invented or computed numbers fail.
 */
function isRounding(cand: string, fact: string): boolean {
  const cp = cand.endsWith('%');
  if (cp !== fact.endsWith('%')) return false;
  const c = Number(cand.replace('%', ''));
  const f = Number(fact.replace('%', ''));
  if (!Number.isFinite(c) || !Number.isFinite(f) || f === 0) return false;
  if (Math.abs(c - f) / Math.abs(f) > 0.02) return false;
  const fd = decimals(fact.replace('%', ''));
  for (let d = fd - 1; d >= 0; d--) if (Number(f.toFixed(d)) === c) return true;
  for (let k = 1; k <= 6; k++) {
    const p = 10 ** k;
    if (Math.round(f / p) * p === c) return true;
  }
  return false;
}

/**
 * Words that must appear near a fact's number (left of it in the same sentence, or right of it up to
 * the next number). Keeps each number tied to what it measures: "net cash" is not "cash".
 */
export const FACT_TERMS: Record<string, string[]> = {
  net_worth: ['net worth'],
  cash: ['cash', 'checking', 'savings'],
  runway: ['month', 'bills', 'cover'],
  dti: ['debt', 'income'],
  utilization: ['credit', 'card', 'utiliz'],
  carry: ['interest', 'earn', 'paid', 'pay'],
  fixable_leak: ['interest', 'save', 'saving'],
  income_6m: ['paycheck', 'earn', 'income', 'made', 'brought in', 'pay'],
  spending_6m: ['spen'],
  debt_interest_6m: ['interest'],
  external_6m: ['outside', 'other bank', 'other account', 'moved', 'transfer'],
  organic_6m: ['net worth'],
  net_cash_today: ['net cash'],
  continue_180: ['net cash'],
  coach_180: ['net cash'],
  coach_gain: ['coach', 'difference', 'better', 'more', 'ahead'],
  band_note: ['margin', 'plus or minus', '±', 'range', 'between', 'give or take', 'ups and downs', 'band'],
  p_low: ['chance', 'risk', 'odds', 'probab', 'likel', 'below', 'under', 'low'],
  stress_job_loss: ['income', 'job', 'paycheck', 'stop', 'lose', 'lost'],
  stress_bill: ['bill', 'surprise', 'expense'],
  action_move: ['move', 'debt', 'save', 'saving', 'chance', 'risk', 'low'],
  action_trim: ['trim', 'cut', 'dining', 'shopping', 'extras', 'month', 'year', 'save'],
  action_trim_category: ['trim', 'cut', 'spending', 'month', 'swing', 'worst', 'loss'],
  action_protect_income: ['income', 'cushion', 'trim', 'extras', 'month', 'worst', 'loss'],
  action_reserve: ['set aside', 'reserve', 'surprise', 'bill', 'worst', 'loss'],
  action_gap: ['outflow', 'income', 'gap', 'trim', 'extras', 'month', 'covers', 'cover'],
  es_worst: ['worst', 'bad', 'tough', 'fall', 'drop', 'lose', 'loss', 'shortfall'],
  dip: ['dip', 'drop', 'fall', 'low point', 'swing', 'down', 'worse'],
  top_risk: ['driver', 'risk', 'biggest', 'main', 'worst', 'bad', 'drive', 'uncertain'],
  top_lever: ['lever', 'help', 'most', 'biggest', 'cut', 'lower', 'change', 'more cash', 'boost'],
  danger: ['checking', 'dip', 'below', 'danger', 'low', 'chance', 'day'],
  ask_scenario: ['scenario', 'expense', 'trip', 'income', 'spending', 'debt', 'paycheck', 'cost', 'purchase', 'buy', 'spend', 'days'],
  ask_verdict: ['verdict', 'comfortable', 'tight', 'risky'],
  ask_cash: ['cash'],
  ask_risk: ['chance', 'risk', 'below', 'drop', 'odds'],
  ask_low: ['lowest', 'low', 'dip', 'bottom', 'point'],
  debt_free: ['debt', 'paid off', 'pay off', 'free', 'clear', 'mortgage'],
  interest_saved: ['interest', 'save', 'saving'],
  debt_stuck: ['shrink', 'balance', 'card', 'loan', 'debt'],
  goal: ['goal', 'chance', 'reach', 'save', 'month', 'target', 'by', 'raise', 'cash'],
};

const SPELLED = /\b(hundred|thousand|million|billion)s?\b/i;

/** Number tokens in a fact, normalized. */
const factNumbers = (f: Fact) => (f.text.match(NUM_RE) ?? []).map(norm);

export interface Audit {
  ok: boolean;
  problems: string[]; // short, for logs
  feedback: string; // instruction sent back to the model on retry
}

/** Check a reply: every number must come from a fact (or honestly round one) and keep that fact's label. */
export function auditReply(text: string, facts: Fact[]): Audit {
  const unverified: string[] = [];
  const mislabeled: { tok: string; label: string }[] = [];
  const spelled = SPELLED.test(text);
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const hits = [...sentence.matchAll(NUM_RE)];
    hits.forEach((m, i) => {
      const tok = m[0];
      const n = norm(tok);
      const plain = !tok.includes('$') && !tok.includes('%');
      if (plain && FREE_NUMBERS.has(n)) return;
      const candidates = facts.filter(f => factNumbers(f).some(x => x === n || x === n.replace(/%$/, '') || isRounding(n, x)));
      if (!candidates.length) {
        unverified.push(tok);
        return;
      }
      const left = sentence.slice(0, m.index).toLowerCase();
      const end = i + 1 < hits.length ? hits[i + 1].index! : sentence.length;
      const right = sentence.slice(m.index! + tok.length, end).toLowerCase();
      const labeled = candidates.some(f => (FACT_TERMS[f.key] ?? []).length === 0 ||
        (FACT_TERMS[f.key] ?? []).some(term => left.includes(term) || right.includes(term)));
      if (!labeled) mislabeled.push({ tok, label: (FACT_TERMS[candidates[0].key] ?? [''])[0] });
    });
  }
  const problems = [
    ...unverified.map(x => `unverified ${x}`),
    ...mislabeled.map(x => `${x.tok} missing label "${x.label}"`),
    ...(spelled ? ['spelled-out amount'] : []),
  ];
  const feedback = [
    unverified.length ? `These numbers are not in the facts: ${unverified.join(', ')}.` : '',
    ...mislabeled.map(x => `${x.tok} must be described as "${x.label}", exactly as in the facts.`),
    spelled ? 'Write every amount with digits, never words like "thousand".' : '',
    'Rewrite the answer using only numbers copied from the facts, each with its own label.',
  ].filter(Boolean).join(' ');
  return { ok: problems.length === 0, problems, feedback };
}

/** Numbers in `text` that are neither in the facts nor an honest rounding of one (label not checked). */
export function unverifiedNumbers(text: string, facts: Fact[]): string[] {
  const ok = allowedNumbers(facts);
  const bad: string[] = [];
  for (const m of text.match(NUM_RE) ?? []) {
    const n = norm(m);
    if (ok.has(n) || ok.has(n.replace(/%$/, ''))) continue;
    if ([...ok].some(f => isRounding(n, f))) continue;
    bad.push(m);
  }
  return bad;
}

export const SYSTEM_PROMPT = [
  'You are a friendly financial coach inside a banking app. Explain the customer\'s finances in plain language',
  '(8th-grade reading level, second person, warm and direct, no jargon).',
  'Rules: use ONLY the facts provided. Copy every number exactly as written in the facts (same format, e.g. "$13,557", "1.8%").',
  'Never calculate, round, combine or invent numbers. If a number you want is not in the facts, describe it in words instead.',
  'Keep each number with the exact label it has in the facts: "net cash" (cash minus high-interest debt) is not "cash", and "net worth" is not either of them.',
  'Forecasts are estimates: say "about" or "likely" when you use them. Do not recommend specific investments or products.',
  'Answer in at most 110 words, no headings, no lists.',
].join(' ');

export function userPrompt(topic: string, facts: Fact[]): string {
  const ask: Record<string, string> = {
    overview: 'Give a short 360° overview: where they have been, where they are, and where they are headed, and the single most useful next step.',
    past: 'Explain what happened to their money over the past months and why.',
    future: 'Explain the two paths for the next 180 days: continuing as they are versus following the coach, and how confident the forecast is.',
    coach: 'Explain the coach\'s recommended actions, what each one saves, and what it does to their risk of running low on cash and to their worst-case outcome.',
    goals: 'For each goal, say how likely they are to reach it and what it would take if the chance is low.',
    risk: 'Explain how resilient they are: their worst-case outcome, what drives it most, the deepest dip they might see, the stress tests, and the single spending change that helps most.',
  };
  return `${ask[topic] ?? ask.overview}\n\nFacts:\n${facts.map(f => `- ${f.text}`).join('\n')}`;
}

/** Deterministic fallback: the same facts as plain sentences. */
export function templateText(topic: string, facts: Fact[]): string {
  const pick = (keys: string[]) =>
    keys.flatMap(k => facts.filter(f => f.key === k)).map(f => f.text.replace(/:\s*/, ': '));
  const order: Record<string, string[]> = {
    overview: ['net_cash_today', 'organic_6m', 'external_6m', 'continue_180', 'coach_180', 'top_risk', 'action_move', 'action_protect_income', 'action_trim_category', 'action_reserve', 'action_gap', 'action_trim'],
    past: ['income_6m', 'spending_6m', 'debt_interest_6m', 'external_6m', 'organic_6m'],
    future: ['continue_180', 'coach_180', 'coach_gain', 'band_note', 'danger'],
    coach: ['debt_free', 'interest_saved', 'debt_stuck', 'action_move', 'action_protect_income', 'action_trim_category', 'action_reserve', 'action_gap', 'action_trim', 'fixable_leak'],
    goals: ['goal'],
    risk: ['p_low', 'danger', 'es_worst', 'top_risk', 'dip', 'stress_job_loss', 'stress_bill', 'top_lever', 'runway'],
  };
  const lines = pick(order[topic] ?? order.overview);
  return lines.length ? `${lines.join('. ')}.` : 'Not enough data yet to explain this view.';
}
