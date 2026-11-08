import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryTotals, compareMonths, flowTotals } from './history-data.ts';
const row = (date, category, cents, flow) => ({ posted_date:date, category, amount_cents:cents, flow_class:flow, account_id:'test', account_type:'checking', transaction_type:'test', description:'Test' });
const rows = [row('2026-09-01','dining',30000,'expense'),row('2026-10-01','dining',10000,'expense'),row('2026-10-02','transport',10000,'expense'),row('2026-10-02','dining',90000,'internal_transfer'),row('2026-10-03','paycheck',200000,'income')];
test('category spending excludes transfers and earned income',()=>{ assert.deepEqual(categoryTotals(rows),[{category:'dining',cents:40000},{category:'transport',cents:10000}]); });
test('month comparisons preserve direction and new categories',()=>{ const comparison=compareMonths(rows,'2026-09','2026-10'); assert.equal(comparison.find(row=>row.category==='dining').difference,-20000); assert.equal(comparison.find(row=>row.category==='transport').difference,10000); });
test('daily totals never count internal movements as new income or expense',()=>{ assert.deepEqual(flowTotals(rows),{income:200000,spending:50000}); });
test('empty history and comparing the same month are safe',()=>{ assert.deepEqual(compareMonths([],'2026-09','2026-10'),[]); assert.ok(compareMonths(rows,'2026-10','2026-10').every(row=>row.difference===0)); });
