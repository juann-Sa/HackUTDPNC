import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../math/forecast';
import { seedFromString } from '../math/rng';
import { AS_OF, loadCustomer } from './data';
import type { Chat } from './model_compare';
import { LEVEL_QUESTIONS, compareLevels, levelsMarkdown, rankLevels, summarizeLevels } from './levels';

// Stand-in model. Reads questions perfectly and explains by restating the facts it was given (faithful);
// as a Level 2 agent it calls simulate_scenario with the right arguments, then restates the tool result;
// as critic it approves; as a Level 1 coach it invents a figure and always says "comfortable".
// Tool turns cost more input tokens (the tool schema rides along), as with a real API.
const stub: Chat = async (_model, messages, json, tools) => {
  const sys = messages[0].content;
  const userQ = messages.find(m => m.role === 'user')!.content;
  const last = messages[messages.length - 1];
  const r = (text: string, extra: object = {}, inTok = 1000) => ({ text, ms: 400, inTok, outTok: 150, error: '', ...extra });
  if (tools) {
    if (last.role !== 'tool') {
      const q = LEVEL_QUESTIONS.find(x => userQ.includes(x.q))!;
      const { supported: _s, ...args } = q.expected.scenario as Record<string, unknown>;
      return r('', { toolCalls: [{ id: 'call_1', name: 'simulate_scenario', args: JSON.stringify(args) }] }, 1800);
    }
    const lines = last.content.split('\n');
    const verdict = lines.find(l => l.startsWith('Verdict from'))!.split(': ')[1];
    return r(lines.filter(l => !l.startsWith('Scenario:')).join('. ') + `.\nVERDICT: ${verdict}`, {}, 2600);
  }
  if (sys.startsWith('You are the supervisor')) return r('{"intent":"what_if","tools":["simulate_scenario"],"reason":"what-if"}');
  if (sys.startsWith('You are a strict reviewer')) return r('{"approve": true, "issues": []}');
  if (sys.startsWith('You are a friendly bank financial coach')) return r('You would still have about $12,345.67 left, which is fine.\nVERDICT: comfortable');
  if (json) {
    const q = LEVEL_QUESTIONS.find(x => userQ.includes(x.q))!;
    return r(JSON.stringify(q.expected.scenario));
  }
  const facts = last.content.slice(last.content.indexOf('Facts:\n') + 7).split('\n').map(l => l.replace(/^- /, '')).join('. ');
  return r(facts + '.');
};

describe('level comparison', () => {
  it('scores levels on time, calls, tokens, cost, reading, verdict agreement and traceable numbers', async () => {
    const c = loadCustomer('C006');
    const rows = await compareLevels({
      models: ['openai/gpt-oss-120b'], chat: stub, schedule: c.schedule, outflowCents: c.outflowCents,
      book: { incomeCents: c.incomeCents, debtPaymentsCents: c.debtPaymentsCents }, context: c.context,
      seed: seedFromString('C006'), assumptions: { ...DEFAULT_ASSUMPTIONS, pairs: 60 }, asOf: AS_OF,
    });
    expect(rows).toHaveLength(4 * LEVEL_QUESTIONS.length);
    const s = Object.fromEntries(summarizeLevels(rows).map(x => [x.level, x]));
    expect(s['1'].llmCallsPerQ).toBe(1);
    expect(s['2'].llmCallsPerQ).toBe(2); // tool call turn + answer turn
    expect(s['3'].llmCallsPerQ).toBe(2); // read + explain
    expect(s['3+critic'].llmCallsPerQ).toBe(4); // supervisor + read + explain + critic
    expect(s['2'].inTokPerQ).toBeGreaterThan(s['3'].inTokPerQ);
    expect(s['1'].costPerQ!).toBeLessThan(s['3'].costPerQ!);
    expect(s['3'].costPerQ!).toBeLessThan(s['2'].costPerQ!);
    expect(s['3'].costPerQ!).toBeLessThan(s['3+critic'].costPerQ!);
    // Level 1 invented a number every time; tool and workflow levels only quote computed facts and match the engine
    expect(s['1'].cleanNumbersPct).toBe(0);
    expect(s['1'].untraceablePerQ).toBeGreaterThanOrEqual(1);
    for (const lv of ['2', '3', '3+critic']) {
      expect(s[lv].verdictAccuracyPct).toBe(100);
      expect(s[lv].cleanNumbersPct).toBe(100);
      expect(s[lv].readingOkPct).toBe(100);
    }
    expect(rows.filter(r => r.level === '2').every(r => r.toolsUsed.includes('simulate_scenario'))).toBe(true);
    // equal reliability → cheapest wins: Level 3, then Level 2, then 3 + critic; Level 1 last
    expect(rankLevels(rows).map(x => x.level)).toEqual(['3', '2', '3+critic', '1']);
    const md = levelsMarkdown(rows, { date: '2026-11-07', customer: 'C006', pairs: 60 });
    expect(md).toContain('**Best: Level 3: orchestrated workflow (production).**');
    expect(md).toContain('Est. $ / 1,000 questions');
    expect(c.context).toContain('Monthly income: $4,199.05');
  }, 120_000);
});
