// ─────────────────────────────────────────────────────────────────────────────
// SpaceTime 360 module: loaders, recompute reducers, validation.
// Reducers never return data: every result lands in a public table that the
// frontend subscribes to (see schema.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { account, customer, ledgerEntry, statement } from './schema';
import { computeCarry, computeSnapshot } from './math/book';
import { computePnl, computeSpending } from './math/pnl';
import { computeDailyLiquid } from './math/daily';
import { dayNumber, isoFromDayNumber } from './math/dates';
import { BUFFER_MONTHS } from './math/book';
import { SHRINK_K, buildSchedule } from './math/schedule';
import { type Assumptions, DEFAULT_ASSUMPTIONS, type ForecastResult, type Scenario, makeTapes, runForecast } from './math/forecast';
import { RISK_CAP, analyze } from './math/coach';
import { seedFromString } from './math/rng';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
const round = (x: number) => Math.round(x);

function assertAdmin(ctx: Ctx) {
  if (!ctx.db.admin.identity.find(ctx.sender)) {
    throw new SenderError('Only the database owner can load or reset data');
  }
}

// The publisher becomes the admin.
export const init = spacetimedb.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender });
});

// ---------- loaders (idempotent upserts, owner only) ----------
export const load_customers = spacetimedb.reducer({ rows: t.array(customer.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.customer.customer_id.find(r.customer_id)) ctx.db.customer.customer_id.update(r);
    else ctx.db.customer.insert(r);
  }
});

export const load_accounts = spacetimedb.reducer({ rows: t.array(account.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.account.account_id.find(r.account_id)) ctx.db.account.account_id.update(r);
    else ctx.db.account.insert(r);
  }
});

export const load_ledger = spacetimedb.reducer({ rows: t.array(ledgerEntry.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.ledgerEntry.transaction_id.find(r.transaction_id)) ctx.db.ledgerEntry.transaction_id.update(r);
    else ctx.db.ledgerEntry.insert(r);
  }
});

export const load_statements = spacetimedb.reducer({ rows: t.array(statement.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.statement.statement_id.find(r.statement_id)) ctx.db.statement.statement_id.update(r);
    else ctx.db.statement.insert(r);
  }
});

function clearResults(ctx: Ctx, cid: string) {
  if (ctx.db.bookSnapshot.customer_id.find(cid)) ctx.db.bookSnapshot.customer_id.delete(cid);
  if (ctx.db.carrySummary.customer_id.find(cid)) ctx.db.carrySummary.customer_id.delete(cid);
  for (const r of [...ctx.db.bookLine.customer_id.filter(cid)]) ctx.db.bookLine.account_id.delete(r.account_id);
  for (const r of [...ctx.db.carryMove.customer_id.filter(cid)]) ctx.db.carryMove.move_id.delete(r.move_id);
  for (const r of [...ctx.db.pnlMonth.customer_id.filter(cid)]) ctx.db.pnlMonth.pnl_id.delete(r.pnl_id);
  for (const r of [...ctx.db.spendingMonth.customer_id.filter(cid)]) ctx.db.spendingMonth.spending_id.delete(r.spending_id);
  for (const r of [...ctx.db.dailyLiquid.customer_id.filter(cid)]) ctx.db.dailyLiquid.daily_id.delete(r.daily_id);
  for (const r of [...ctx.db.validationIssue.customer_id.filter(cid)]) ctx.db.validationIssue.issue_id.delete(r.issue_id);
}

export const reset_data = spacetimedb.reducer(ctx => {
  assertAdmin(ctx);
  for (const c of [...ctx.db.customer.iter()]) clearResults(ctx, c.customer_id);
  for (const r of [...ctx.db.ledgerEntry.iter()]) ctx.db.ledgerEntry.transaction_id.delete(r.transaction_id);
  for (const r of [...ctx.db.statement.iter()]) ctx.db.statement.statement_id.delete(r.statement_id);
  for (const r of [...ctx.db.account.iter()]) ctx.db.account.account_id.delete(r.account_id);
  for (const r of [...ctx.db.customer.iter()]) ctx.db.customer.customer_id.delete(r.customer_id);
});

// ---------- validation: refuse to trust numbers from data that doesn't reconcile ----------
function validate(ctx: Ctx, cid: string, stmts: { account_id: string; month: string; opening_cents: number; increases_cents: number; decreases_cents: number; closing_cents: number }[], balances: Map<string, number>) {
  const issue = (kind: string, detail: string) =>
    ctx.db.validationIssue.insert({ issue_id: 0n, customer_id: cid, kind, detail });
  const byAccount = new Map<string, typeof stmts>();
  for (const s of stmts) {
    if (round(s.opening_cents + s.increases_cents - s.decreases_cents - s.closing_cents) !== 0)
      issue('statement_unbalanced', `${s.account_id} ${s.month}`);
    byAccount.set(s.account_id, [...(byAccount.get(s.account_id) ?? []), s]);
  }
  for (const [acct, list] of byAccount) {
    list.sort((a, b) => (a.month < b.month ? -1 : 1));
    for (let i = 1; i < list.length; i++)
      if (round(list[i].opening_cents - list[i - 1].closing_cents) !== 0)
        issue('statement_chain_break', `${acct} ${list[i].month}`);
    const last = list[list.length - 1];
    if (round(last.closing_cents - (balances.get(acct) ?? 0)) !== 0)
      issue('closing_mismatch', `${acct}: statement ${last.closing_cents} vs account ${balances.get(acct)}`);
  }
}

// ---------- recompute ----------
function recomputeCustomer(ctx: Ctx, cid: string) {
  const prof = ctx.db.customer.customer_id.find(cid);
  if (!prof) throw new SenderError(`Unknown customer ${cid}`);
  const accts = [...ctx.db.account.customer_id.filter(cid)].sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
  const stmts = [...ctx.db.statement.customer_id.filter(cid)];
  clearResults(ctx, cid);

  validate(ctx, cid, stmts, new Map(accts.map(a => [a.account_id, a.balance_cents])));

  // §1 book snapshot
  const months = [...new Set(stmts.map(s => s.month))].sort();
  const lastMonth = months[months.length - 1] ?? '';
  const [ly, lm] = lastMonth.split('-').map(Number);
  const nextMonthStart = lastMonth ? `${lm === 12 ? ly + 1 : ly}-${String(lm === 12 ? 1 : lm + 1).padStart(2, '0')}-01` : '';
  const asOf = lastMonth ? isoFromDayNumber(dayNumber(nextMonthStart) - 1) : '';
  const snap = computeSnapshot(prof, accts);
  ctx.db.bookSnapshot.insert({ customer_id: cid, as_of: asOf, ...snap });

  // §2 carry
  const carry = computeCarry(accts, snap.liquid_cents, snap.monthly_outflow_cents);
  for (const l of carry.lines) ctx.db.bookLine.insert({ customer_id: cid, ...l, annual_carry_cents: round(l.annual_carry_cents) });
  const s = carry.summary;
  ctx.db.carrySummary.insert({
    customer_id: cid,
    earn_cents: round(s.earn_cents),
    cost_cents: round(s.cost_cents),
    net_cents: round(s.net_cents),
    structural_cents: round(s.structural_cents),
    high_cost_cents: round(s.high_cost_cents),
    idle_cash_cents: s.idle_cash_cents,
    fixable_leak_cents: round(s.fixable_leak_cents),
    buffer_months: s.buffer_months,
  });
  for (const m of carry.moves)
    ctx.db.carryMove.insert({ move_id: `${cid}|${m.account_id}`, customer_id: cid, ...m, annual_saving_cents: round(m.annual_saving_cents) });

  // §3 P&L attribution + spending by category
  for (const p of computePnl(ledger, stmts)) {
    ctx.db.pnlMonth.insert({ pnl_id: `${cid}|${p.month}`, customer_id: cid, ...p });
    if (p.residual_cents !== 0)
      ctx.db.validationIssue.insert({ issue_id: 0n, customer_id: cid, kind: 'pnl_residual', detail: `${p.month}: ${p.residual_cents} cents unexplained` });
  }
  for (const sp of computeSpending(ledger))
    ctx.db.spendingMonth.insert({ spending_id: `${cid}|${sp.month}|${sp.category}`, customer_id: cid, ...sp });

  // daily liquid balance for the Past view
  if (months.length) {
    for (const d of computeDailyLiquid(ledger, accts, `${months[0]}-01`, asOf))
      ctx.db.dailyLiquid.insert({ daily_id: `${cid}|${d.date}`, customer_id: cid, ...d });
  }
}

export const recompute_customer = spacetimedb.reducer({ customer_id: t.string() }, (ctx, { customer_id }) => {
  recomputeCustomer(ctx, customer_id);
});

export const recompute_all = spacetimedb.reducer(ctx => {
  assertAdmin(ctx);
  for (const c of [...ctx.db.customer.iter()]) recomputeCustomer(ctx, c.customer_id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Forecast (spec §4–§9): 180-day Monte Carlo, stress tests, sensitivities, coach.
// ─────────────────────────────────────────────────────────────────────────────
function scheduleFor(ctx: Ctx, cid: string) {
  const prof = ctx.db.customer.customer_id.find(cid);
  if (!prof) throw new SenderError(`Unknown customer ${cid}`);
  const accts = [...ctx.db.account.customer_id.filter(cid)].sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
  if (!ledger.length) throw new SenderError(`No ledger for ${cid}`);
  const asOf = ledger.reduce((m, t) => (t.posted_date > m ? t.posted_date : m), '');
  const snap = computeSnapshot(prof, accts);
  return { schedule: buildSchedule(ledger, accts, asOf, DEFAULT_ASSUMPTIONS.horizonDays), snap };
}

function clearScenario(ctx: Ctx, cid: string, scenario: string) {
  for (const r of [...ctx.db.forecastBand.customer_id.filter(cid)])
    if (r.scenario === scenario) ctx.db.forecastBand.band_id.delete(r.band_id);
  for (const r of [...ctx.db.riskSource.customer_id.filter(cid)])
    if (r.scenario === scenario) ctx.db.riskSource.risk_id.delete(r.risk_id);
  const run = ctx.db.forecastRun.run_id.find(`${cid}|${scenario}`);
  if (run) ctx.db.forecastRun.run_id.delete(run.run_id);
}

function writeForecast(ctx: Ctx, cid: string, f: ForecastResult, a: Assumptions) {
  const scenario = f.scenario.id;
  clearScenario(ctx, cid, scenario);
  ctx.db.forecastRun.insert({
    run_id: `${cid}|${scenario}`,
    customer_id: cid,
    scenario,
    label: f.scenario.label,
    include_external: f.scenario.includeExternal,
    paths: 2 * a.pairs,
    horizon_days: a.horizonDays,
    start_date: f.dates[0],
    threshold_cents: a.thresholdCents,
    p_low: f.pLow,
    p_low_se: f.pLowSe,
    var95_cents: round(f.var95),
    es95_cents: round(f.es95),
    mdd_p50_cents: round(f.mddP50),
    mdd_p95_cents: round(f.mddP95),
    end_liquid_p5_cents: round(f.endLiquid.p5),
    end_liquid_p50_cents: round(f.endLiquid.p50),
    end_liquid_p95_cents: round(f.endLiquid.p95),
    end_net_worth_p5_cents: round(f.endNetWorth.p5),
    end_net_worth_p50_cents: round(f.endNetWorth.p50),
    end_net_worth_p95_cents: round(f.endNetWorth.p95),
    planned_change_cents: round(f.deterministicChange),
  });
  f.bands.forEach((b, i) =>
    ctx.db.forecastBand.insert({
      band_id: `${cid}|${scenario}|${i}`,
      customer_id: cid,
      scenario,
      day_index: i,
      date: f.dates[i],
      p5_cents: round(b.p5),
      p25_cents: round(b.p25),
      p50_cents: round(b.p50),
      p75_cents: round(b.p75),
      p95_cents: round(b.p95),
    })
  );
  for (const src of f.sources)
    ctx.db.riskSource.insert({
      risk_id: `${cid}|${scenario}|${src.source}`,
      customer_id: cid,
      scenario,
      source: src.source,
      var_share: src.varShare,
      es_contribution_cents: round(src.esContribution),
    });
}

/** Full forward analysis for one customer: baseline, coach path, stresses, sensitivities, frontier. */
export const run_forecast = spacetimedb.reducer(
  { customer_id: t.string(), include_external: t.bool() },
  (ctx, { customer_id: cid, include_external }) => {
    const { schedule, snap } = scheduleFor(ctx, cid);
    const a = DEFAULT_ASSUMPTIONS;
    const seed = seedFromString(cid);
    const an = analyze(schedule, a, seed, include_external, snap.monthly_outflow_cents);
    for (const f of [an.baseline, an.coach, ...an.stresses]) writeForecast(ctx, cid, f, a);

    for (const r of [...ctx.db.sensitivity.customer_id.filter(cid)]) ctx.db.sensitivity.sensitivity_id.delete(r.sensitivity_id);
    for (const r of an.sensitivities)
      ctx.db.sensitivity.insert({
        sensitivity_id: `${cid}|${r.lever}`, customer_id: cid, lever: r.lever, label: r.label,
        delta_p_low: r.deltaPLow, delta_end_p50_cents: round(r.deltaEndP50),
      });
    for (const r of [...ctx.db.frontierPoint.customer_id.filter(cid)]) ctx.db.frontierPoint.frontier_id.delete(r.frontier_id);
    an.frontier.forEach((p, i) =>
      ctx.db.frontierPoint.insert({
        frontier_id: `${cid}|${i}`, customer_id: cid, move_cents: p.moveCents, p_low: p.pLow,
        annual_saving_cents: round(p.annualSavingCents), recommended: p.recommended,
      })
    );
    for (const r of [...ctx.db.coachAction.customer_id.filter(cid)]) ctx.db.coachAction.action_id.delete(r.action_id);
    for (const x of an.actions)
      ctx.db.coachAction.insert({
        action_id: `${cid}|${x.kind}`, customer_id: cid, kind: x.kind, amount_cents: x.amountCents, fraction: x.fraction,
        annual_saving_cents: round(x.annualSavingCents), p_low_before: x.pLowBefore, p_low_after: x.pLowAfter, detail: x.detail,
      });
    const existing = ctx.db.forecastAssumption.customer_id.find(cid);
    if (existing) ctx.db.forecastAssumption.customer_id.delete(cid);
    ctx.db.forecastAssumption.insert({
      customer_id: cid,
      sigma_shared: schedule.sigmaShared,
      sigma_idio: schedule.sigmaIdio,
      phi: schedule.phi,
      income_sigma: schedule.incomeSigma,
      shrink_k: SHRINK_K,
      student_t_nu: a.nu,
      jumps_per_year: a.jumpsPerYear,
      jump_median_cents: a.jumpMedianCents,
      p_job_loss_monthly: a.pEmployedToJobLoss,
      p_rehire_monthly: a.pJobLossToEmployed,
      ira_mu: a.iraMu,
      ira_sigma: a.iraSigma,
      risk_cap: RISK_CAP,
      buffer_months: BUFFER_MONTHS,
      seed,
    });
  }
);

const CategoryMult = t.object('CategoryMult', { category: t.string(), mult: t.f64() });

/** What-if simulator: one custom scenario on the same random draws as the baseline (shared live). */
export const run_what_if = spacetimedb.reducer(
  {
    customer_id: t.string(),
    include_external: t.bool(),
    income_mult: t.f64(),
    category_mults: t.array(CategoryMult),
    one_off_cents: t.f64(),
    one_off_day: t.u32(),
    move_to_debt_cents: t.f64(),
    job_loss_months: t.u32(),
    card_apr_bump_pct: t.f64(),
  },
  (ctx, args) => {
    const { schedule } = scheduleFor(ctx, args.customer_id);
    const a = DEFAULT_ASSUMPTIONS;
    const tapes = makeTapes(seedFromString(args.customer_id), a, schedule.months.length + 1);
    const sc: Scenario = {
      id: 'what_if',
      label: 'What if',
      includeExternal: args.include_external,
      incomeMult: args.income_mult,
      categoryMult: Object.fromEntries(args.category_mults.map(c => [c.category, c.mult])),
      oneOff: args.one_off_cents > 0 ? { dayIndex: Math.min(args.one_off_day, a.horizonDays - 1), cents: args.one_off_cents } : undefined,
      moveToDebtCents: args.move_to_debt_cents,
      jobLossMonths: args.job_loss_months,
      cardAprBumpPct: args.card_apr_bump_pct,
    };
    writeForecast(ctx, args.customer_id, runForecast(schedule, a, sc, tapes), a);
  }
);
