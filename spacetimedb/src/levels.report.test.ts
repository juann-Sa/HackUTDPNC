// Level 1 vs 2 vs 3 on Groq. Skipped unless GROQ_API_KEY and LEVELS_OUT are set:
//   cd spacetimedb && GROQ_API_KEY=... LEVELS_OUT=../analytics/levels/results.json npx vitest run src/levels.report.test.ts
// Optional: COMPARE_MODELS=openai/gpt-oss-120b,llama-3.1-8b-instant  COMPARE_CUSTOMER=C006
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_ASSUMPTIONS } from './math/forecast';
import { seedFromString } from './math/rng';
import { AS_OF, loadCustomer } from './eval/data';
import { groqChat } from './eval/model_compare';
import { LEVEL_QUESTIONS, compareLevels, levelsMarkdown, rankLevels, summarizeLevels } from './eval/levels';

it.skipIf(!process.env.GROQ_API_KEY || !process.env.LEVELS_OUT)('compare implementation levels', async () => {
  const out = process.env.LEVELS_OUT!;
  const cid = process.env.COMPARE_CUSTOMER ?? 'C006';
  const models = (process.env.COMPARE_MODELS ?? 'openai/gpt-oss-120b,llama-3.3-70b-versatile').split(',').map(m => m.trim()).filter(Boolean);
  const c = loadCustomer(cid);
  const pairs = 200;
  const rows = await compareLevels({
    models, chat: groqChat(process.env.GROQ_API_KEY!), schedule: c.schedule, outflowCents: c.outflowCents,
    book: { incomeCents: c.incomeCents, debtPaymentsCents: c.debtPaymentsCents }, context: c.context,
    seed: seedFromString(cid), assumptions: { ...DEFAULT_ASSUMPTIONS, pairs }, asOf: AS_OF,
    onRow: r => console.log(`L${r.level} ${r.model} | ${r.question} | ${r.calls} calls ${(r.ms / 1000).toFixed(1)}s | verdict ${r.verdict}/${r.truthVerdict} | untraceable ${r.untraceable.length} ${r.error}`),
  });
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ date, customer: cid, models, questions: LEVEL_QUESTIONS.map(q => q.q), summary: summarizeLevels(rows), ranking: rankLevels(rows), rows }, null, 1));
  writeFileSync(out.replace(/\.json$/, '') + '.md', levelsMarkdown(rows, { date, customer: cid, pairs }));
}, 1_800_000);
