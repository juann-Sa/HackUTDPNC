// Level 1 vs 2 vs 3 (starter kit "three implementation levels"), measured on the same questions and model:
//   Level 1  – one LLM call gets the customer's data and answers on its own (does its own math).
//   Level 2  – tool-using agent: the LLM decides which approved tools to call (get_accounts,
//              calculate_health_metrics, simulate_scenario), reads their results, and writes the answer.
//   Level 3  – orchestrated workflow = our production design: an LLM only reads the question into scenario
//              JSON → code validates and routes → the engine computes → an LLM explains → the number audit
//              checks it (one corrective retry, then a template fallback).
//   Level 3 + critic – Level 3 plus a supervisor LLM up front and a separate critic LLM that reviews the
//              answer and asks for a revision ("several LLM agents").
// Ground truth for every question = the engine on the intended reading (verdict + computed facts).
// Scored per answer: time, LLM calls, tokens, cost, verdict agreement with the engine, whether the question
// was read right (scenario parameters), and numbers in the answer that can't be traced to the customer's data,
// a tool result or the engine's facts (wrong math / made-up figures).
import { ANSWER_ASK, PARSE_PROMPT, evaluateQuestion, parseScenario } from '../math/ask';
import type { Assumptions } from '../math/forecast';
import { type Fact, SYSTEM_PROMPT, auditReply, pct, unverifiedNumbers, usd } from '../math/narrate';
import type { Schedule } from '../math/schedule';
import { type Chat, type ChatMsg, PRICES, QUESTIONS, type Question, type ToolDef } from './model_compare';

export const LEVELS = ['1', '2', '3', '3+critic'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_NAMES: Record<Level, string> = {
  '1': 'Level 1: one LLM call, raw data',
  '2': 'Level 2: tool-using agent',
  '3': 'Level 3: orchestrated workflow (production)',
  '3+critic': 'Level 3 + critic LLM',
};

/** What-if questions only: those have an engine ground truth (verdict) to score against. */
export const LEVEL_QUESTIONS: Question[] = QUESTIONS.filter(q => q.expected.scenario);

const VERDICT_RULE =
  'Finish with one line "VERDICT: comfortable", "VERDICT: tight" or "VERDICT: risky" (risky: a real chance of running out of cash; tight: little room to spare or under 3 months of bills in cash afterwards; comfortable: otherwise).';

export const LEVEL1_SYSTEM =
  'You are a friendly bank financial coach. Answer the customer\'s question from their data in a short paragraph with the key numbers. ' + VERDICT_RULE;

export const LEVEL2_SYSTEM =
  'You are a friendly bank financial coach with tools. Use the tools to fetch the customer\'s data and to compute any what-if; ' +
  'do not do the arithmetic yourself — quote the numbers the tools return. Answer in a short paragraph with the key numbers. ' + VERDICT_RULE;

/** The approved tools a Level 2 agent may call (same engine as production behind simulate_scenario). */
export const LEVEL2_TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'get_accounts', description: 'The customer profile, account balances, rates and the last 6 months of income and spending.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'calculate_health_metrics', description: 'Cash on hand, monthly income and bills, months of bills covered by cash, share of income going to debt, savings rate.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: {
    name: 'simulate_scenario',
    description: 'Run the bank\'s 180-day cash forecast (thousands of simulated futures) with a what-if change and return the computed facts and a verdict. All money in cents. Leave out anything the question does not change.',
    parameters: { type: 'object', properties: {
      income_mult: { type: 'number', description: 'income multiplier, e.g. 0.9 for a 10% pay cut' },
      category_mults: { type: 'object', description: 'spending multipliers by category (housing, utilities, groceries, dining, transport, shopping, other_spending), e.g. {"dining": 0.5}' },
      one_off_cents: { type: 'number', description: 'a single cash expense' }, one_off_in_days: { type: 'number', description: 'days until it, 0-179' },
      move_to_debt_cents: { type: 'number', description: 'cash used to pay down high-interest debt' },
      job_loss_months: { type: 'number', description: 'months with no paycheck starting now, 0-6' },
      purchase_kind: { type: 'string', enum: ['car', 'home', 'other'], description: 'for something bought with a loan' },
      purchase_price_cents: { type: 'number' }, down_payment_cents: { type: 'number' },
      loan_apr_pct: { type: 'number' }, loan_term_months: { type: 'number' }, purchase_in_days: { type: 'number' },
    } },
  } },
];

export const SUPERVISOR_PROMPT = [
  'You are the supervisor of a banking coach. Classify the customer\'s question and choose tools. Reply with JSON only:',
  '{"intent": "what_if" | "status" | "other", "tools": [subset of "get_accounts", "calculate_health_metrics", "forecast_balances", "simulate_scenario"], "reason": short text}.',
].join(' ');

export const CRITIC_PROMPT = [
  'You are a strict reviewer. Check the coach\'s answer against the facts. Approve only if every number and claim is supported by the facts,',
  'nothing important is missing for the question, and the tone is clear and not alarmist. Reply with JSON only: {"approve": true|false, "issues": [short strings]}.',
].join(' ');

export interface LevelRow {
  level: Level; model: string; question: string;
  calls: number; ms: number; engineMs: number; inTok: number; outTok: number; costUsd: number | null;
  verdict: string | null; truthVerdict: string; verdictOk: boolean;
  /** question read into the right scenario parameters (Levels 2-3); null for Level 1, which never states one */
  readingOk: boolean | null;
  toolsUsed: string[];
  untraceable: string[]; clean: boolean; fallback: boolean; text: string; error: string;
}

const cost = (model: string, i: number, o: number) => (PRICES[model] ? (i * PRICES[model][0] + o * PRICES[model][1]) / 1e6 : null);
const verdictIn = (text: string) => (text.match(/VERDICT:\s*(comfortable|tight|risky)/i)?.[1]?.toLowerCase() ?? null);
const withoutVerdict = (text: string) => text.replace(/VERDICT:.*$/im, '').trim();
const jsonOf = (raw: string): Record<string, unknown> => { try { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); return JSON.parse(raw.slice(s, e + 1)); } catch { return {}; } };
const MAX_AGENT_TURNS = 5;

/** Numbers a coach may legitimately quote: everything in the data it was given. */
export function dataFacts(context: string): Fact[] {
  return context.split('\n').filter(Boolean).map((text, i) => ({ key: `data_${i}`, text }));
}

/** The health metrics a Level 2 agent gets from calculate_health_metrics (as quotable facts). */
export function healthFacts(s: Schedule, outflowCents: number, book: { incomeCents: number; debtPaymentsCents: number }): Fact[] {
  const cash = s.startLiquid;
  return [
    { key: 'hm_cash', text: `Cash in checking and savings: ${usd(cash)}` },
    { key: 'hm_income', text: `Monthly income: ${usd(book.incomeCents)}; monthly bills including debt payments: ${usd(outflowCents)}` },
    { key: 'hm_runway', text: `Months of bills covered by cash: ${(cash / outflowCents).toFixed(1)}` },
    { key: 'hm_dti', text: `Share of income going to debt payments: ${pct(book.debtPaymentsCents / book.incomeCents, 0)}` },
    { key: 'hm_savings', text: `Savings rate (income left after bills): ${pct((book.incomeCents - outflowCents) / book.incomeCents, 0)}` },
  ];
}

export async function compareLevels(opts: {
  models: string[]; levels?: readonly Level[]; questions?: Question[]; chat: Chat; schedule: Schedule; outflowCents: number;
  book: { incomeCents: number; debtPaymentsCents: number }; context: string; seed: number; assumptions: Assumptions; asOf: string;
  onRow?: (r: LevelRow) => void;
}): Promise<LevelRow[]> {
  const qs = opts.questions ?? LEVEL_QUESTIONS;
  const levels = opts.levels ?? LEVELS;
  const known = dataFacts(opts.context);
  const health = healthFacts(opts.schedule, opts.outflowCents, opts.book);
  const run = (scenarioJson: string) => {
    const t0 = Date.now();
    const ev = evaluateQuestion(opts.schedule, opts.outflowCents, parseScenario(scenarioJson), opts.seed, opts.assumptions, opts.book);
    return { ev, ms: Date.now() - t0 };
  };
  const truth = new Map(qs.map(q => [q.q, run(JSON.stringify(q.expected.scenario)).ev]));
  const rows: LevelRow[] = [];
  const readOk = (q: Question, p: Record<string, unknown>) => q.expected.checks.every(c => c.ok(p));

  for (const model of opts.models) for (const level of levels) for (const q of qs) {
    const gt = truth.get(q.q)!;
    const r: LevelRow = {
      level, model, question: q.q, calls: 0, ms: 0, engineMs: 0, inTok: 0, outTok: 0, costUsd: null,
      verdict: null, truthVerdict: gt.verdict, verdictOk: false, readingOk: null, toolsUsed: [],
      untraceable: [], clean: false, fallback: false, text: '', error: '',
    };
    const call = async (messages: ChatMsg[], json: boolean, tools?: ToolDef[]) => {
      const x = await opts.chat(model, messages, json, tools);
      r.calls++; r.ms += x.ms; r.inTok += x.inTok; r.outTok += x.outTok;
      if (x.error && !r.error) r.error = x.error;
      return x;
    };

    if (level === '1') {
      const a = await call([{ role: 'system', content: LEVEL1_SYSTEM }, { role: 'user', content: `${opts.context}\n\nQuestion: ${q.q}` }], false);
      r.text = a.text;
      r.verdict = verdictIn(a.text);
      r.untraceable = unverifiedNumbers(withoutVerdict(a.text), [...known, ...gt.facts]);
    } else if (level === '2') {
      // tool-using agent: the model chooses tools; we execute them and feed results back until it answers
      const seen: Fact[] = [];
      const messages: ChatMsg[] = [
        { role: 'system', content: `${LEVEL2_SYSTEM} Today is ${opts.asOf}.` },
        { role: 'user', content: q.q },
      ];
      let readings: boolean[] = [];
      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        const a = await call(messages, false, LEVEL2_TOOLS);
        if (a.error) break;
        if (!a.toolCalls?.length) { r.text = a.text; break; }
        messages.push({ role: 'assistant', content: a.text, tool_calls: a.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
        for (const c of a.toolCalls) {
          r.toolsUsed.push(c.name);
          let out: string;
          if (c.name === 'get_accounts') { out = opts.context; seen.push(...known); }
          else if (c.name === 'calculate_health_metrics') { out = health.map(f => f.text).join('\n'); seen.push(...health); }
          else if (c.name === 'simulate_scenario') {
            const args = jsonOf(c.args);
            readings.push(readOk(q, args));
            const { ev, ms } = run(JSON.stringify({ ...args, supported: true }));
            r.engineMs += ms;
            out = `Scenario: ${ev.interpretation}\nVerdict from the bank's rules: ${ev.verdict}\n${ev.facts.map(f => f.text).join('\n')}`;
            seen.push(...ev.facts, { key: 'sim_scenario', text: ev.interpretation });
          } else out = `Unknown tool ${c.name}`;
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
      }
      r.readingOk = readings.length ? readings[readings.length - 1] : false;
      r.verdict = verdictIn(r.text);
      r.untraceable = unverifiedNumbers(withoutVerdict(r.text), [...seen, { key: 'q', text: q.q }]);
    } else {
      // Level 3: production workflow (with or without the extra supervisor + critic LLMs)
      const critic = level === '3+critic';
      if (critic) await call([{ role: 'system', content: SUPERVISOR_PROMPT }, { role: 'user', content: q.q }], true);
      const p = await call([{ role: 'system', content: `${PARSE_PROMPT} Today is ${opts.asOf}.` }, { role: 'user', content: q.q }], true);
      r.toolsUsed.push('simulate_scenario');
      const parsed = parseScenario(p.text);
      r.readingOk = parsed.supported && readOk(q, jsonOf(p.text));
      if (!parsed.supported) {
        r.text = 'That question is outside what I can check.';
      } else {
        const { ev, ms } = run(p.text);
        r.engineMs = ms;
        r.verdict = ev.verdict;
        const messages: ChatMsg[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${ANSWER_ASK} The question was: "${q.q}"\n\nFacts:\n${ev.facts.map(f => `- ${f.text}`).join('\n')}` },
        ];
        let a = await call(messages, false);
        let audit = auditReply(a.text, ev.facts);
        if (critic && !a.error) {
          const c = await call([{ role: 'system', content: CRITIC_PROMPT }, { role: 'user', content: `Facts:\n${ev.facts.map(f => `- ${f.text}`).join('\n')}\n\nQuestion: ${q.q}\n\nAnswer:\n${a.text}` }], true);
          const review = jsonOf(c.text);
          if (review.approve !== true || !audit.ok) {
            const issues = [...(Array.isArray(review.issues) ? review.issues.map(String) : []), ...(audit.ok ? [] : [audit.feedback])];
            a = await call([...messages, { role: 'assistant', content: a.text }, { role: 'user', content: `Revise the answer. Problems: ${issues.join(' | ') || 'unclear'}` }], false);
            audit = auditReply(a.text, ev.facts);
          }
        } else if (!a.error && !audit.ok) {
          a = await call([...messages, { role: 'assistant', content: a.text }, { role: 'user', content: audit.feedback }], false);
          audit = auditReply(a.text, ev.facts);
        }
        r.fallback = !audit.ok || !!a.error;
        r.text = r.fallback ? ev.fallback : a.text;
        r.untraceable = unverifiedNumbers(r.text, ev.facts);
      }
    }
    r.ms += r.engineMs;
    r.verdictOk = r.verdict === r.truthVerdict;
    r.clean = r.untraceable.length === 0 && !!r.text;
    r.costUsd = cost(model, r.inTok, r.outTok);
    rows.push(r);
    opts.onRow?.(r);
  }
  return rows;
}

const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const pctOf = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export function summarizeLevels(rows: LevelRow[]) {
  const keys = [...new Set(rows.map(r => `${r.level}|${r.model}`))];
  // (level names contain no '|')
  return keys.map(k => {
    const [lv, model] = k.split('|');
    const rs = rows.filter(r => `${r.level}|${r.model}` === k);
    const costs = rs.map(r => r.costUsd).filter((c): c is number => c !== null);
    return {
      level: lv as Level, model, questions: rs.length,
      readingOkPct: lv === '1' ? NaN : pctOf(rs.map(r => r.readingOk === true)),
      llmCallsPerQ: mean(rs.map(r => r.calls)),
      medianSeconds: median(rs.map(r => r.ms)) / 1000,
      tokensPerQ: mean(rs.map(r => r.inTok + r.outTok)),
      inTokPerQ: mean(rs.map(r => r.inTok)),
      outTokPerQ: mean(rs.map(r => r.outTok)),
      costPerQ: costs.length === rs.length ? mean(costs) : null,
      verdictAccuracyPct: pctOf(rs.map(r => r.verdictOk)),
      cleanNumbersPct: pctOf(rs.map(r => r.clean)),
      untraceablePerQ: mean(rs.map(r => r.untraceable.length)),
      fallbackPct: pctOf(rs.map(r => r.fallback)),
      errors: rs.filter(r => r.error).length,
    };
  });
}

/** "Best" = the cheapest/fastest level that is fully reliable: highest verdict accuracy and clean-number rate first,
 *  then lower cost, then lower latency. Returns the ranking with a one-line reason. */
export function rankLevels(rows: LevelRow[]) {
  const byLevel = LEVELS.map(level => {
    const rs = rows.filter(r => r.level === level);
    if (!rs.length) return null;
    const costs = rs.map(r => r.costUsd).filter((c): c is number => c !== null);
    return {
      level, accuracy: pctOf(rs.map(r => r.verdictOk && r.clean)),
      cost: costs.length ? mean(costs) : Infinity, seconds: median(rs.map(r => r.ms)) / 1000,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  return byLevel.sort((a, b) => b.accuracy - a.accuracy || a.cost - b.cost || a.seconds - b.seconds);
}

export function levelsMarkdown(rows: LevelRow[], meta: { date: string; customer: string; pairs: number }): string {
  const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const money = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : '$' + x.toFixed(5));
  const s = summarizeLevels(rows);
  const rank = rankLevels(rows);
  const best = rank[0];
  const per1k = (x: { costPerQ: number | null }) => (x.costPerQ === null ? '—' : '$' + (x.costPerQ * 1000).toFixed(2));
  const tools = (lv: Level) => {
    const rs = rows.filter(r => r.level === lv && r.toolsUsed.length);
    const counts = new Map<string, number>();
    for (const r of rs) for (const t of new Set(r.toolsUsed)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([t, n]) => `${t} (${n}/${rows.filter(r => r.level === lv).length})`).join(', ') || '—';
  };
  return [
    `# Implementation levels compared — ${meta.date}, customer ${meta.customer}`,
    '',
    `Same ${LEVEL_QUESTIONS.length} what-if questions, same model(s), same customer for every level. Ground truth = the forecast engine on the intended reading of each question (${meta.pairs * 2} simulated paths).`,
    '',
    '## Time and cost',
    '',
    '| Level | Model | LLM calls / question | Median time (s) | Input tokens / q | Output tokens / q | Est. $ / question | Est. $ / 1,000 questions |',
    '|---|---|---|---|---|---|---|---|',
    ...s.map(x => `| ${LEVEL_NAMES[x.level]} | ${x.model} | ${f(x.llmCallsPerQ, 1)} | ${f(x.medianSeconds, 1)} | ${f(x.inTokPerQ)} | ${f(x.outTokPerQ)} | ${money(x.costPerQ)} | ${per1k(x)} |`),
    '',
    '## Accuracy',
    '',
    '| Level | Model | Question read right | Verdict matches engine | Answers with only traceable numbers | Untraceable numbers / answer | Template fallback |',
    '|---|---|---|---|---|---|---|',
    ...s.map(x => `| ${LEVEL_NAMES[x.level]} | ${x.model} | ${x.level === '1' ? 'n/a' : f(x.readingOkPct) + '%'} | ${f(x.verdictAccuracyPct)}% | ${f(x.cleanNumbersPct)}% | ${f(x.untraceablePerQ, 1)} | ${x.level === '3' || x.level === '3+critic' ? f(x.fallbackPct) + '%' : 'n/a'} |`),
    '',
    `Level 2 tool use: ${tools('2')}.`,
    '',
    '## Ranking (reliable first: verdict right AND every number traceable; then cost; then time)',
    ...rank.map((x, i) => `${i + 1}. ${LEVEL_NAMES[x.level]}: ${f(x.accuracy)}% fully reliable answers, ~${money(x.cost)} and ${f(x.seconds, 1)} s per question`),
    '',
    best ? `**Best: ${LEVEL_NAMES[best.level]}.**` : '',
    '',
    '- **Level 1**: one call; the model gets the raw data and does its own math. **Level 2**: the model picks approved tools (accounts, health metrics, the forecast engine) and writes the answer from their results. **Level 3**: an LLM only reads the question into parameters; code validates them, the engine computes, an LLM explains, and the number audit checks the answer (+1 retry, else a template). **+ critic**: adds a supervisor LLM and a reviewer LLM.',
    '- **Question read right**: the scenario parameters the model produced (Level 3) or passed to the simulator (Level 2) match the question (e.g. $30,000 car, $5,000 down).',
    '- **Untraceable numbers**: figures in the answer that appear nowhere in the data, tool results or engine facts the model was given (wrong arithmetic or invented figures). Level 1 is checked against the data plus the engine facts, so a correct number it happened to compute still counts as traceable.',
    '- **Time** is wall-clock for the LLM calls plus engine compute (Groq network included). **Cost** = input tokens × input price + output tokens × output price, using the list prices in `eval/model_compare.ts` (verify current prices).',
  ].join('\n') + '\n';
}
