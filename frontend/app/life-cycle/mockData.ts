export interface SpendingPoint {
  /** Day offset from today: -180 (past) .. 0 (current) .. +180 (future). */
  day: number
  label: string
  /** Cumulative total spending up to this day. */
  total: number
  /** Cumulative total for the historical segment (null in the future). */
  actual: number | null
  /** Cumulative total for the projected segment (null in the past). */
  projected: number | null
  /** Mock financial-health score (0-100) at this point in time. */
  health: number
}

/** Small deterministic PRNG so the curve is stable between renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generates a realistic cumulative-spending curve across a 360-day window.
 * The past segment is a little volatile (bills + the occasional splurge);
 * the future segment is a smoother projection. Mock data only — no real math.
 */
export function generateSpendingData(): SpendingPoint[] {
  const rand = mulberry32(20260207)
  const points: SpendingPoint[] = []
  let total = 0

  for (let day = -180; day <= 180; day++) {
    const dow = ((day % 7) + 7) % 7
    const isWeekend = dow === 0 || dow === 6
    let daily: number

    if (day <= 0) {
      daily = 60 + rand() * 70
      if (isWeekend) daily *= 1.5
      if ((day + 180) % 30 === 0) daily += 1300 + rand() * 250 // monthly bills
      if (rand() > 0.965) daily += 350 + rand() * 500 // occasional splurge
    } else {
      // Smoother forward projection.
      daily = 115 + 30 * Math.sin(day / 22) + rand() * 25
      if (day % 30 === 0) daily += 1250
    }

    total += daily

    // Mock "financial health" (0-100): a blend of spending pace, income and
    // cash-flow buffers that gently drifts over time. No real math here.
    let h = 72 + 11 * Math.sin((day + 40) / 55) + day / 34 + (rand() - 0.5) * 6
    h = Math.max(38, Math.min(94, h))

    const label = day === 0 ? 'Current' : day < 0 ? `${day} Days` : `+${day} Days`

    points.push({
      day,
      label,
      total: Math.round(total),
      actual: day <= 0 ? Math.round(total) : null,
      projected: day >= 0 ? Math.round(total) : null,
      health: Math.round(h),
    })
  }

  return points
}
