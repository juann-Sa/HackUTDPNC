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
