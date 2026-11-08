// Open vs. commercial model comparison (starter kit: "ask the same questions with different models;
// compare tool choice, valid JSON, faithfulness, tone, latency, cost and privacy").
//
// Runs the coach's real two-step pipeline for each model on the same questions:
//   1. parse: PARSE_PROMPT turns the question into scenario JSON (scored: valid JSON, supported flag,
//      key parameters vs. an expected reading)
//   2. answer: the engine evaluates the EXPECTED scenario (so every model explains identical facts),
//      then the model writes the answer with the production SYSTEM_PROMPT; auditReply checks every
//      number and label (faithfulness), with the same one-retry rule as production.
// Network calls go through an injectable `chat` function, so the scoring is unit-tested offline.
import { ANSWER_ASK, PARSE_PROMPT, evaluateQuestion, parseScenario } from '../math/ask';
import { type Assumptions } from '../math/forecast';
import { type Fact, SYSTEM_PROMPT, auditReply, unverifiedNumbers } from '../math/narrate';
import type { Schedule } from '../math/schedule';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

/** USD per 1M tokens [input, output]. List prices as of when this table was written (Nov 2026) — verify
 *  at https://groq.com/pricing before quoting. gpt-oss: morphllm.com/groq-pricing (dated Oct 13, 2026);
 *  Llama: Groq's last published list prices (that page now says "contact sales"). */
export const PRICES: Record<string, [number, number]> = {
  'openai/gpt-oss-120b': [0.15, 0.6],
  'openai/gpt-oss-20b': [0.075, 0.3],
  'llama-3.3-70b-versatile': [0.59, 0.79],
  'llama-3.1-8b-instant': [0.05, 0.08],
};

export const PRIVACY_NOTE =
  'All models here are open-weight (OpenAI gpt-oss, Meta Llama) but served by Groq in the cloud, so the question and the ' +
  'customer facts leave the machine. A local open model via Ollama would keep data on-device (not run here). ' +
  'Only synthetic challenge data is used.';

export interface Expected {
  supported: boolean;
  /** Checks on the parsed JSON; each returns true when the model read the question right. */
  checks: { name: string; ok: (p: Record<string, unknown>) => boolean }[];
  /** The reading every model's answer step is evaluated on (raw JSON in PARSE_PROMPT's format). */
  scenario?: Record<string, unknown>;
  /** A perfect parse reply when it differs from `scenario` (e.g. a routed question); used by the offline tests. */
  ideal?: Record<string, unknown>;
}
export interface Question { q: string; expected: Expected }

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const near = (x: unknown, target: number, tol: number) => Math.abs(num(x) - target) <= tol;
const mult = (p: Record<string, unknown>, cat: string) => num(((p.category_mults ?? {}) as Record<string, unknown>)[cat]);

export const QUESTIONS: Question[] = [
  { q: 'Can I afford a $2,000 trip next month?', expected: { supported: true,
    checks: [{ name: 'one_off ≈ $2,000', ok: p => near(p.one_off_cents, 200_000, 1) }, { name: 'in 20-45 days', ok: p => num(p.one_off_in_days) >= 20 && num(p.one_off_in_days) <= 45 }],
    scenario: { supported: true, one_off_cents: 200_000, one_off_in_days: 30 } } },
  { q: 'What if I lose my job for 3 months?', expected: { supported: true,
    checks: [{ name: 'job_loss_months = 3', ok: p => num(p.job_loss_months) === 3 }, { name: 'income not also cut', ok: p => p.income_mult === undefined || near(p.income_mult, 1, 1e-9) }],
    scenario: { supported: true, job_loss_months: 3 } } },
  { q: 'What if I cut dining out in half?', expected: { supported: true,
    checks: [{ name: 'dining × 0.5', ok: p => near(mult(p, 'dining'), 0.5, 0.01) }],
    scenario: { supported: true, category_mults: { dining: 0.5 } } } },
  { q: 'What if I get a 10% raise?', expected: { supported: true,
    checks: [{ name: 'income × 1.10', ok: p => near(p.income_mult, 1.1, 0.005) }],
    scenario: { supported: true, income_mult: 1.1 } } },
  { q: 'What if I use $3,000 of my savings to pay down my credit card?', expected: { supported: true,
    checks: [{ name: 'move_to_debt ≈ $3,000', ok: p => near(p.move_to_debt_cents, 300_000, 1) }, { name: 'not read as an expense', ok: p => !(num(p.one_off_cents) > 0) }],
    scenario: { supported: true, move_to_debt_cents: 300_000 } } },
  { q: 'If I buy a $30,000 car with $5,000 down, will I still have enough money for emergencies?', expected: { supported: true,
    checks: [
      { name: 'price ≈ $30,000', ok: p => near(p.purchase_price_cents, 3_000_000, 1) },
      { name: 'down ≈ $5,000', ok: p => near(p.down_payment_cents, 500_000, 1) },
      { name: 'read as a car loan, not a cash expense', ok: p => p.purchase_kind === 'car' && !(num(p.one_off_cents) > 0) },
    ],
    scenario: { supported: true, purchase_kind: 'car', purchase_price_cents: 3_000_000, down_payment_cents: 500_000, purchase_in_days: 30 } } },
  { q: 'How am I doing financially overall?', expected: { supported: false,
    checks: [{ name: 'routed to overview', ok: p => p.topic === 'overview' }], ideal: { supported: false, topic: 'overview' } } },
  { q: "What's the weather tomorrow?", expected: { supported: false, checks: [{ name: 'not routed to a summary', ok: p => p.topic === undefined || p.topic === 'none' }] } },
];

export interface ToolCall { id: string; name: string; args: string }
export interface ChatReply { text: string; ms: number; inTok: number; outTok: number; error: string; toolCalls?: ToolCall[] }
/** OpenAI-style message; tool turns carry `tool_calls` (assistant) or `tool_call_id` (tool). */
export type ChatMsg = { role: string; content: string; tool_calls?: unknown; tool_call_id?: string };
/** OpenAI-style tool (function) definitions, for the tool-using agent (Level 2). */
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Chat = (model: string, messages: ChatMsg[], json: boolean, tools?: ToolDef[]) => Promise<ChatReply>;

/** Valid JSON = the raw reply parses as a JSON object as-is (no extraction from surrounding prose). */
export function scoreParse(raw: string, expected: Expected) {
  let obj: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(raw);
    obj = v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { obj = null; }
  const parsed = parseScenario(raw); // what production does with it (tolerant extraction + clamping)
  const p = obj ?? (() => { try { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); return JSON.parse(raw.slice(s, e + 1)); } catch { return {}; } })();
  const supportedOk = parsed.supported === expected.supported;
  const failed = expected.checks.filter(c => !c.ok(p)).map(c => c.name);
  return { validJson: obj !== null, supportedOk, failedChecks: failed, correct: supportedOk && failed.length === 0 };
}

/** Faithfulness: the production audit (numbers + labels) on the first reply and after one corrective retry. */
export function scoreAnswer(text: string, facts: Fact[]) {
  const a = auditReply(text, facts);
  return { pass: a.ok, problems: a.problems, unverified: unverifiedNumbers(text, facts), words: text.split(/\s+/).filter(Boolean).length };
}

export interface Row {
  model: string; question: string;
  parse: { validJson: boolean; supportedOk: boolean; correct: boolean; failedChecks: string[]; ms: number; error: string; raw: string };
  answer?: { firstPass: boolean; finalPass: boolean; problems: string[]; unverified: string[]; words: number; ms: number; text: string; error: string };
  inTok: number; outTok: number; costUsd: number | null;
}

const cost = (model: string, i: number, o: number) => (PRICES[model] ? (i * PRICES[model][0] + o * PRICES[model][1]) / 1e6 : null);

export async function compareModels(opts: {
  models: string[]; questions?: Question[]; chat: Chat; schedule: Schedule; outflowCents: number; seed: number;
  assumptions: Assumptions; asOf: string; onRow?: (r: Row) => void;
}): Promise<Row[]> {
  const qs = opts.questions ?? QUESTIONS;
  // facts depend only on the expected scenario, so compute them once and share them across models
  const factsFor = new Map<string, { facts: Fact[] }>();
  for (const q of qs) if (q.expected.scenario) {
    const ev = evaluateQuestion(opts.schedule, opts.outflowCents, parseScenario(JSON.stringify(q.expected.scenario)), opts.seed, opts.assumptions);
    factsFor.set(q.q, { facts: ev.facts });
  }
  const rows: Row[] = [];
  for (const model of opts.models) for (const q of qs) {
    const pr = await opts.chat(model, [{ role: 'system', content: `${PARSE_PROMPT} Today is ${opts.asOf}.` }, { role: 'user', content: q.q }], true);
    const ps = pr.error ? { validJson: false, supportedOk: false, failedChecks: ['no reply'], correct: false } : scoreParse(pr.text, q.expected);
    const row: Row = { model, question: q.q, parse: { ...ps, ms: pr.ms, error: pr.error, raw: pr.text.slice(0, 600) }, inTok: pr.inTok, outTok: pr.outTok, costUsd: null };
    const f = factsFor.get(q.q);
    if (f) {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${ANSWER_ASK} The question was: "${q.q}"\n\nFacts:\n${f.facts.map(x => `- ${x.text}`).join('\n')}` },
      ];
      const a1 = await opts.chat(model, messages, false);
      row.inTok += a1.inTok; row.outTok += a1.outTok;
      const s1 = scoreAnswer(a1.text, f.facts);
      let final = s1, ms = a1.ms, text = a1.text;
      if (!a1.error && !s1.pass) {
        const fb = auditReply(a1.text, f.facts).feedback;
        const a2 = await opts.chat(model, [...messages, { role: 'assistant', content: a1.text }, { role: 'user', content: fb }], false);
        row.inTok += a2.inTok; row.outTok += a2.outTok; ms += a2.ms;
        if (!a2.error) { final = scoreAnswer(a2.text, f.facts); text = a2.text; }
      }
      row.answer = { firstPass: !a1.error && s1.pass, finalPass: !a1.error && final.pass, problems: final.problems.slice(0, 5), unverified: final.unverified, words: final.words, ms, text, error: a1.error };
    }
    row.costUsd = cost(model, row.inTok, row.outTok);
    rows.push(row);
    opts.onRow?.(row);
  }
  return rows;
}

const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const pctOf = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);

export function summarize(rows: Row[]) {
  const models = [...new Set(rows.map(r => r.model))];
  return models.map(model => {
    const rs = rows.filter(r => r.model === model);
    const ans = rs.filter(r => r.answer).map(r => r.answer!);
    const costs = rs.map(r => r.costUsd).filter((c): c is number => c !== null);
    return {
      model,
      questions: rs.length,
      validJsonPct: pctOf(rs.map(r => r.parse.validJson)),
      correctReadingPct: pctOf(rs.map(r => r.parse.correct)),
      auditFirstTryPct: pctOf(ans.map(a => a.firstPass)),
      auditAfterRetryPct: pctOf(ans.map(a => a.finalPass)),
      medianParseMs: median(rs.map(r => r.parse.ms)),
      medianAnswerMs: median(ans.map(a => a.ms)),
      medianWords: median(ans.map(a => a.words)),
      costPerQuestionUsd: costs.length === rs.length ? costs.reduce((s, c) => s + c, 0) / rs.length : null,
      errors: rs.filter(r => r.parse.error || r.answer?.error).length,
    };
  });
}

export function markdown(rows: Row[], meta: { date: string; customer: string }): string {
  const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const lines = [
    `# Model comparison — ${meta.date}, customer ${meta.customer}`,
    '',
    'Same questions, same prompts, same engine facts for every model (Groq OpenAI-compatible API).',
    '',
    '| Model | Valid JSON | Correct reading | Faithful (1st try) | Faithful (after retry) | Median parse ms | Median answer ms | Median words | Est. $/question | Errors |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...summarize(rows).map(s => `| ${s.model} | ${f(s.validJsonPct)}% | ${f(s.correctReadingPct)}% | ${f(s.auditFirstTryPct)}% | ${f(s.auditAfterRetryPct)}% | ${f(s.medianParseMs)} | ${f(s.medianAnswerMs)} | ${f(s.medianWords)} | ${s.costPerQuestionUsd === null ? '—' : '$' + s.costPerQuestionUsd.toFixed(5)} | ${s.errors} |`),
    '',
    '- **Valid JSON**: the parse reply is a JSON object as-is. **Correct reading**: supported/unsupported is right and the key parameters match (e.g. $2,000 → 200000 cents).',
    '- **Faithful**: every number and label in the answer passes the production audit (`auditReply`); production retries once with the audit feedback, then falls back to a template.',
    '- **Cost**: tokens × list prices in `eval/model_compare.ts` (verify current Groq prices). Latency is wall-clock from this machine.',
    `- **Privacy**: ${PRIVACY_NOTE}`,
    '- **Tone**: read the answers in the JSON file (`answer.text`).',
    '',
    '## Misreadings',
    ...rows.filter(r => !r.parse.correct).map(r => `- ${r.model} — "${r.question}": ${r.parse.error || (!r.parse.supportedOk ? 'wrong supported flag' : r.parse.failedChecks.join(', '))}`),
  ];
  return lines.join('\n') + '\n';
}

/** Groq chat over fetch with timeout and 429 backoff. */
export function groqChat(key: string, opts: { timeoutMs?: number; delayMs?: number } = {}): Chat {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const delayMs = opts.delayMs ?? 1_500;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  return async (model, messages, json, tools) => {
    const body = JSON.stringify({
      model, temperature: 0.2, max_completion_tokens: 700, messages,
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    });
    for (let attempt = 0; ; attempt++) {
      await sleep(delayMs);
      const t0 = Date.now();
      try {
        const res = await fetch(GROQ_URL, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const ms = Date.now() - t0;
        if (res.status === 429 && attempt < 5) {
          const wait = Number(res.headers.get('retry-after')) * 1000 || 2_000 * 2 ** attempt;
          await sleep(Math.min(wait, 60_000));
          continue;
        }
        const j = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) return { text: '', ms, inTok: 0, outTok: 0, error: `http ${res.status}: ${String(j?.error?.message ?? '').slice(0, 160)}` };
        const msg = j.choices?.[0]?.message ?? {};
        const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
          ? msg.tool_calls.map((c: any) => ({ id: String(c.id), name: String(c.function?.name ?? ''), args: String(c.function?.arguments ?? '{}') }))
          : [];
        return { text: String(msg.content ?? '').trim(), ms, inTok: j.usage?.prompt_tokens ?? 0, outTok: j.usage?.completion_tokens ?? 0, error: '', ...(toolCalls.length ? { toolCalls } : {}) };
      } catch (e) {
        return { text: '', ms: Date.now() - t0, inTok: 0, outTok: 0, error: String(e).slice(0, 160) };
      }
    }
  };
}
