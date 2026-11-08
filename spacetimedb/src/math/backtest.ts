// Spec §10 backtest: forecast a period we already know, using only data from before it.
//   cutoff: rebuild every balance as of the cutoff and drop later ledger entries
//   forecast: same schedule + Monte Carlo as live, habit view (normal variation only)
//   compare: day by day against what actually happened
// The synthetic "external cash management" transfers reset checking to a random target each month
// (a calibration artifact, not behavior). The primary comparison removes them from the actuals and
// from the forecast ("organic" cash); the raw comparison keeps both in, for transparency.
import { dayNumber, isoFromDayNumber } from './dates';
import { type Assumptions, habitAssumptions, makeTapes, runForecast } from './forecast';
import { type AccountRow, type LedgerRow, buildSchedule } from './schedule';

export interface BacktestAccount extends AccountRow {
  opening_balance_cents: number;
}

export interface BacktestDay {
  date: string;
  dayIndex: number;
  actual: number; // organic (external transfers removed)
  actualRaw: number;
  p5: number;
  p50: number;
  p95: number;
  inside: boolean;
}

export interface BacktestResult {
  cutoff: string;
  end: string;
  days: BacktestDay[];
  coverage90: number; // share of days the organic actual sat inside the 5–95% band (target ≈ 0.90)
  coverage90Raw: number; // same, raw actuals vs a forecast that includes average external transfers
  endErrorPct: number; // |median − actual| at the last day, as % of cash at the cutoff
  endHalfWidthPct: number; // half the band width at the last day, as % of cash at the cutoff
  pinball: number; // mean quantile loss over p5/p50/p95, % of cash at the cutoff
}

function balancesAt(ledger: LedgerRow[], accounts: BacktestAccount[], cutoff: string): AccountRow[] {
  const last = new Map<string, LedgerRow>();
  for (const t of ledger) {
    if (t.posted_date > cutoff) continue;
    const prev = last.get(t.account_id);
    if (!prev || t.posted_date > prev.posted_date || (t.posted_date === prev.posted_date && t.transaction_id > prev.transaction_id))
      last.set(t.account_id, t);
  }
  return accounts.map(a => ({ ...a, balance_cents: last.get(a.account_id)?.balance_after_cents ?? a.opening_balance_cents }));
}

export function backtestCustomer(
  ledger: LedgerRow[],
  accounts: BacktestAccount[],
  cutoff: string,
  end: string,
  a: Assumptions,
  seed: number
): BacktestResult {
  const horizon = dayNumber(end) - dayNumber(cutoff);
  const h: Assumptions = habitAssumptions({ ...a, horizonDays: horizon });
  const past = ledger.filter(t => t.posted_date <= cutoff);
  const atCutoff = balancesAt(ledger, accounts, cutoff);
  const s = buildSchedule(past, atCutoff, cutoff, horizon);
  const tapes = makeTapes(seed, h, s.months.length + 1);
  const organic = runForecast(s, h, { id: 'backtest', label: 'Backtest', includeExternal: false }, tapes);
  const raw = runForecast(s, h, { id: 'backtest_raw', label: 'Backtest (raw)', includeExternal: true }, tapes);

  // actual liquid balance and cumulative external transfers after the cutoff, day by day
  const liquidTypes = new Set(['checking', 'savings']);
  const entries = ledger
    .filter(t => liquidTypes.has(t.account_type) && t.posted_date > cutoff && t.posted_date <= end)
    .sort((x, y) => (x.posted_date < y.posted_date ? -1 : x.posted_date > y.posted_date ? 1 : x.transaction_id < y.transaction_id ? -1 : 1));
  const bal = new Map(atCutoff.filter(x => liquidTypes.has(x.account_type)).map(x => [x.account_id, x.balance_cents]));
  let ext = 0;
  let i = 0;
  const days: BacktestDay[] = [];
  const start = s.startLiquid;
  let inside = 0;
  let insideRaw = 0;
  let pin = 0;
  const loss = (q: number, y: number, f: number) => Math.max(q * (y - f), (q - 1) * (y - f));
  for (let k = 1; k <= horizon; k++) {
    const date = isoFromDayNumber(dayNumber(cutoff) + k);
    while (i < entries.length && entries[i].posted_date <= date) {
      const e = entries[i++];
      bal.set(e.account_id, e.balance_after_cents);
      if (e.flow_class === 'external_transfer') ext += e.balance_change_cents;
    }
    const actualRaw = [...bal.values()].reduce((p, v) => p + v, 0);
    const actual = actualRaw - ext;
    const b = organic.bands[k];
    const r = raw.bands[k];
    const isIn = actual >= b.p5 && actual <= b.p95;
    inside += isIn ? 1 : 0;
    insideRaw += actualRaw >= r.p5 && actualRaw <= r.p95 ? 1 : 0;
    pin += (loss(0.05, actual, b.p5) + loss(0.5, actual, b.p50) + loss(0.95, actual, b.p95)) / 3;
    days.push({ date, dayIndex: k, actual, actualRaw, p5: b.p5, p50: b.p50, p95: b.p95, inside: isIn });
  }
  const lastDay = days[days.length - 1];
  return {
    cutoff,
    end,
    days,
    coverage90: inside / horizon,
    coverage90Raw: insideRaw / horizon,
    endErrorPct: Math.abs(lastDay.p50 - lastDay.actual) / start,
    endHalfWidthPct: (lastDay.p95 - lastDay.p5) / 2 / start,
    pinball: pin / horizon / start,
  };
}
