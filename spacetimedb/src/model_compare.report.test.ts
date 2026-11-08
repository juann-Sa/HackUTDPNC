// Open vs. commercial model comparison on Groq. Skipped unless GROQ_API_KEY and COMPARE_OUT are set:
//   cd spacetimedb && GROQ_API_KEY=... COMPARE_OUT=../analytics/model_compare/results.json npx vitest run src/model_compare.report.test.ts
// Optional: COMPARE_MODELS=openai/gpt-oss-120b,llama-3.1-8b-instant  COMPARE_CUSTOMER=C006
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_ASSUMPTIONS } from './math/forecast';
import { seedFromString } from './math/rng';
import { AS_OF, loadCustomer } from './eval/data';
import { DEFAULT_MODELS, PRICES, PRIVACY_NOTE, QUESTIONS, compareModels, groqChat, markdown, summarize } from './eval/model_compare';

it.skipIf(!process.env.GROQ_API_KEY || !process.env.COMPARE_OUT)('compare Groq models on the coach pipeline', async () => {
  const out = process.env.COMPARE_OUT!;
  const cid = process.env.COMPARE_CUSTOMER ?? 'C006';
  const chat = groqChat(process.env.GROQ_API_KEY!);
  const wanted = (process.env.COMPARE_MODELS ?? DEFAULT_MODELS.join(',')).split(',').map(m => m.trim()).filter(Boolean);
  const models: string[] = [];
  for (const m of wanted) {
    const probe = await chat(m, [{ role: 'user', content: 'Reply with OK.' }], false);
    if (probe.error) console.log(`skipping ${m}: ${probe.error}`);
    else models.push(m);
  }
  if (!models.length) throw new Error('No usable models for this key');
  const { schedule, outflowCents } = loadCustomer(cid);
  const rows = await compareModels({
    models, chat, schedule, outflowCents, seed: seedFromString(cid),
    assumptions: { ...DEFAULT_ASSUMPTIONS, pairs: 200 }, asOf: AS_OF,
    onRow: r => console.log(`${r.model} | ${r.question} | json=${r.parse.validJson} correct=${r.parse.correct} audit=${r.answer?.finalPass ?? '-'} ${r.parse.error}`),
  });
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ date, customer: cid, models, questions: QUESTIONS.map(q => q.q), prices_usd_per_1m: PRICES, privacy: PRIVACY_NOTE, summary: summarize(rows), rows }, null, 1));
  writeFileSync(out.replace(/\.json$/, '') + '.md', markdown(rows, { date, customer: cid }));
}, 900_000);
