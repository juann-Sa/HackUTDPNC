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

/** Returns the numbers in `text` that do not come from the facts. */
export function unverifiedNumbers(text: string, facts: Fact[]): string[] {
  const ok = allowedNumbers(facts);
  const bad: string[] = [];
  for (const m of text.match(NUM_RE) ?? []) {
    const n = norm(m);
    if (!ok.has(n) && !ok.has(n.replace(/%$/, ''))) bad.push(m);
  }
  return bad;
}

export const SYSTEM_PROMPT = [
  'You are a friendly financial coach inside a banking app. Explain the customer\'s finances in plain language',
  '(8th-grade reading level, second person, warm and direct, no jargon).',
  'Rules: use ONLY the facts provided. Copy every number exactly as written in the facts (same format, e.g. "$13,557", "1.8%").',
  'Never calculate, round, combine or invent numbers. If a number you want is not in the facts, describe it in words instead.',
  'Forecasts are estimates: say "about" or "likely" when you use them. Do not recommend specific investments or products.',
  'Answer in at most 110 words, no headings, no lists.',
].join(' ');

export function userPrompt(topic: string, facts: Fact[]): string {
  const ask: Record<string, string> = {
    overview: 'Give a short 360° overview: where they have been, where they are, and where they are headed, and the single most useful next step.',
    past: 'Explain what happened to their money over the past months and why.',
    future: 'Explain the two paths for the next 180 days: continuing as they are versus following the coach, and how confident the forecast is.',
    coach: 'Explain the coach\'s recommended actions, what each one saves, and what it does to their risk of running low on cash.',
    risk: 'Explain how resilient they are to surprises, using the stress tests.',
  };
  return `${ask[topic] ?? ask.overview}\n\nFacts:\n${facts.map(f => `- ${f.text}`).join('\n')}`;
}

/** Deterministic fallback: the same facts as plain sentences. */
export function templateText(topic: string, facts: Fact[]): string {
  const pick = (keys: string[]) =>
    keys.flatMap(k => facts.filter(f => f.key === k)).map(f => f.text.replace(/:\s*/, ': '));
  const order: Record<string, string[]> = {
    overview: ['net_cash_today', 'organic_6m', 'external_6m', 'continue_180', 'coach_180', 'action_move', 'action_trim'],
    past: ['income_6m', 'spending_6m', 'debt_interest_6m', 'external_6m', 'organic_6m'],
    future: ['continue_180', 'coach_180', 'coach_gain', 'band_note'],
    coach: ['action_move', 'action_trim', 'fixable_leak'],
    risk: ['p_low', 'stress_job_loss', 'stress_bill', 'runway'],
  };
  const lines = pick(order[topic] ?? order.overview);
  return lines.length ? `${lines.join('. ')}.` : 'Not enough data yet to explain this view.';
}
