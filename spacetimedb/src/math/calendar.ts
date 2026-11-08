// Spending seasonality priors and the holiday event calendar.
// Monthly factors: Census retail sales, not seasonally adjusted, 2015-2019 & 2022-2025
// (analytics/model/seasonality.py). Utilities pattern is ASSUMED. Housing is flat.
// Event timing within a month is ASSUMED; events move spend to a day, never add to the total.
import { dayNumber, isoFromDayNumber } from './dates';

export const CATEGORIES = ['housing', 'utilities', 'groceries', 'other_spending', 'dining', 'transport', 'shopping'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DISCRETIONARY: Category[] = ['dining', 'shopping', 'other_spending'];

const FACTORS: Record<Category, number[]> = {
  dining: [0.9034, 0.9027, 1.0281, 1.0042, 1.0517, 1.0213, 1.024, 1.0449, 0.9886, 1.0243, 0.9656, 1.041],
  groceries: [0.9823, 0.9111, 0.9979, 0.9735, 1.0294, 0.996, 1.0232, 1.0185, 0.9816, 1.0068, 1.0183, 1.0614],
  transport: [0.8789, 0.8521, 0.9885, 0.998, 1.0961, 1.0542, 1.089, 1.0798, 1.0251, 1.0497, 0.9662, 0.9224],
  shopping: [0.8418, 0.8587, 0.9747, 0.9529, 1.0288, 0.9776, 0.9816, 1.0218, 0.9257, 0.9809, 1.0883, 1.3671],
  other_spending: [0.8974, 0.8705, 0.9922, 0.9758, 1.0401, 1.0034, 1.0182, 1.0252, 0.9733, 1.0149, 1.0399, 1.149],
  utilities: [1.0675, 1.0082, 0.9094, 0.8699, 0.939, 1.0675, 1.1664, 1.1862, 1.0379, 0.8896, 0.8699, 0.9885],
  housing: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

/** Population log seasonal factor for category, month 1..12. */
export function popLogFactor(cat: string, month: number): number {
  const f = FACTORS[cat as Category];
  return f ? Math.log(f[month - 1]) : 0;
}

export function lastDayOfMonth(y: number, m: number): number {
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return Number(isoFromDayNumber(dayNumber(next) - 1).slice(8, 10));
}

/** n-th weekday (Mon=0..Sun=6) of a month; n = -1 means last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const wd = (iso: string) => (((dayNumber(iso) + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday (3)
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  if (n > 0) {
    const first = wd(`${ym}-01`);
    return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
  }
  const last = lastDayOfMonth(y, m);
  return last - ((wd(`${ym}-${String(last).padStart(2, '0')}`) - weekday + 7) % 7);
}

export interface CalendarEvent {
  category: Category;
  day: number;
  share: number;
  name: string;
}

/** Events for month (y, m). Mirrors analytics/model/seasonality.py events_for. */
export function eventsFor(y: number, m: number): CalendarEvent[] {
  const last = lastDayOfMonth(y, m);
  const ev: CalendarEvent[] = [];
  const add = (category: Category, day: number, share: number, name: string) =>
    ev.push({ category, day: Math.min(Math.max(day, 1), last), share, name });
  if (m === 2) {
    add('dining', 14, 0.3, "Valentine's Day");
    add('shopping', 13, 0.15, "Valentine's gifts");
    add('groceries', nthWeekday(y, 2, 6, 2) - 1, 0.12, 'Super Bowl weekend');
  }
  if (m === 5) {
    add('dining', nthWeekday(y, 5, 6, 2), 0.2, "Mother's Day");
    add('shopping', nthWeekday(y, 5, 6, 2) - 2, 0.1, "Mother's Day gifts");
    add('transport', nthWeekday(y, 5, 0, -1) - 3, 0.15, 'Memorial Day travel');
  }
  if (m === 6) add('dining', nthWeekday(y, 6, 6, 3), 0.15, "Father's Day");
  if (m === 7) {
    add('groceries', 3, 0.2, 'July 4th cookout');
    add('transport', 2, 0.15, 'July 4th travel');
    add('shopping', 25, 0.2, 'Back-to-school');
  }
  if (m === 8) {
    add('shopping', 8, 0.3, 'Back-to-school');
    add('shopping', 15, 0.15, 'Back-to-school');
  }
  if (m === 9) add('transport', nthWeekday(y, 9, 0, 1) - 3, 0.12, 'Labor Day travel');
  if (m === 11) {
    const tg = nthWeekday(y, 11, 3, 4);
    add('groceries', tg - 2, 0.25, 'Thanksgiving groceries');
    add('transport', tg - 1, 0.15, 'Thanksgiving travel');
    add('shopping', tg + 1, 0.3, 'Black Friday');
    if (tg + 4 <= 30) add('shopping', tg + 4, 0.15, 'Cyber Monday');
  }
  if (m === 12) {
    add('shopping', nthWeekday(y, 11, 3, 4) + 4 > 30 ? 1 : 7, 0.1, 'Cyber Week / early gifts');
    add('shopping', 15, 0.25, 'Holiday gifts');
    add('shopping', 21, 0.3, 'Last-minute gifts');
    add('groceries', 23, 0.25, 'Holiday meals');
    add('transport', 22, 0.15, 'Holiday travel');
    add('dining', 31, 0.12, "New Year's Eve");
  }
  return ev;
}

export const EVENT_NAMES = new Set([
  "Valentine's Day", "Valentine's gifts", 'Super Bowl weekend', "Mother's Day", "Mother's Day gifts",
  'Memorial Day travel', "Father's Day", 'July 4th cookout', 'July 4th travel', 'Back-to-school',
  'Labor Day travel', 'Thanksgiving groceries', 'Thanksgiving travel', 'Black Friday', 'Cyber Monday',
  'Cyber Week / early gifts', 'Holiday gifts', 'Last-minute gifts', 'Holiday meals', 'Holiday travel', "New Year's Eve",
]);
