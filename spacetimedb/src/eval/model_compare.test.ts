// Offline checks of the model-comparison scoring (stubbed model replies, no network).
import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../math/forecast';
import { seedFromString } from '../math/rng';
import { AS_OF, loadCustomer } from './data';
import { type Chat, QUESTIONS, compareModels, markdown, scoreAnswer, scoreParse, summarize } from './model_compare';

const facts = [{ key: 'ask_cash', text: 'Cash in 180 days: about $27,700 if nothing changes, about $25,700 with this change' }];

describe('model comparison scoring', () => {
  it('valid JSON vs prose-wrapped JSON, and the reading checks', () => {
    const trip = QUESTIONS[0].expected;
    expect(scoreParse('{"supported": true, "one_off_cents": 200000, "one_off_in_days": 30}', trip)).toMatchObject({ validJson: true, correct: true });
    const wrapped = scoreParse('Sure! {"supported": true, "one_off_cents": 200000, "one_off_in_days": 30}', trip);
    expect(wrapped.validJson).toBe(false);
    expect(wrapped.correct).toBe(true); // production still extracts it; JSON validity is scored separately
    expect(scoreParse('{"supported": true, "one_off_cents": 2000, "one_off_in_days": 30}', trip).failedChecks).toEqual(['one_off ≈ $2,000']);
    const weather = QUESTIONS.find(q => q.q.includes('weather'))!.expected;
    expect(scoreParse('{"supported": false}', weather).correct).toBe(true);
    expect(scoreParse('{"supported": true}', weather).correct).toBe(false);
    expect(scoreParse('not json at all', weather).validJson).toBe(false);
  });

  it('faithfulness uses the production audit', () => {
    expect(scoreAnswer('You would likely have about $25,700 in cash in 180 days.', facts).pass).toBe(true);
    const bad = scoreAnswer('You would likely have about $31,250 in cash in 180 days.', facts);
    expect(bad.pass).toBe(false);
    expect(bad.unverified).toContain('$31,250');
  });

  it('end to end on C006 with a careful and a sloppy stub model', async () => {
    const { schedule, outflowCents } = loadCustomer('C006');
    expect(outflowCents).toBe(503_699); // matches book_snapshot.monthly_outflow_cents for C006
    const expectedJson = new Map(QUESTIONS.map(q => [q.q, JSON.stringify(q.expected.ideal ?? q.expected.scenario ?? { supported: false })]));
    let sloppyAnswers = 0;
    const chat: Chat = async (model, messages, json) => {
      const user = messages.find(m => m.role === 'user')!.content;
      const base = { ms: model === 'careful' ? 100 : 50, inTok: 1000, outTok: 200, error: '' };
      if (json) {
        const q = user;
        return { ...base, text: model === 'careful' ? expectedJson.get(q)! : `Here you go: ${expectedJson.get(q)!.replace('200000', '20000')}` };
      }
      const factLines = user.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
      if (model === 'careful') return { ...base, text: factLines.join('. ') + '.' };
      sloppyAnswers++;
      // sloppy: invents a number first, fixes it when given the audit feedback
      return { ...base, text: messages.length > 2 ? factLines.join('. ') + '.' : 'You will have about $123,456 left.' };
    };
    const rows = await compareModels({
      models: ['careful', 'sloppy'], chat, schedule, outflowCents, seed: seedFromString('C006'),
      assumptions: { ...DEFAULT_ASSUMPTIONS, pairs: 60 }, asOf: AS_OF,
    });
    const s = Object.fromEntries(summarize(rows).map(x => [x.model, x]));
    expect(s.careful).toMatchObject({ validJsonPct: 100, correctReadingPct: 100, auditFirstTryPct: 100, auditAfterRetryPct: 100, errors: 0 });
    expect(s.sloppy.validJsonPct).toBe(0);
    expect(s.sloppy.correctReadingPct).toBeLessThan(100); // the $2,000 trip read as $200
    expect(s.sloppy.auditFirstTryPct).toBe(0);
    expect(s.sloppy.auditAfterRetryPct).toBe(100);
    expect(sloppyAnswers).toBe(2 * QUESTIONS.filter(q => q.expected.scenario).length);
    expect(s.careful.costPerQuestionUsd).toBeNull(); // no list price for stub models
    const md = markdown(rows, { date: AS_OF, customer: 'C006' });
    expect(md).toContain('| careful | 100% | 100% | 100% | 100% |');
    expect(md).toContain('sloppy — "Can I afford a $2,000 trip next month?": one_off ≈ $2,000');
  }, 60_000);
});
