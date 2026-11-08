import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartSelection,historicalCushion} from './historical-cushion.ts';
const data={book_snapshot:[{monthly_outflow_cents:10000}],timeline_360:[{date:'2026-10-31',day_offset:0,actual_net_cash_cents:45000},{date:'2026-10-30',day_offset:-1,actual_net_cash_cents:20000},{date:'2026-11-01',day_offset:1,actual_net_cash_cents:99999}]};
test('uses actual dated balances and a consistent bills denominator',()=>{assert.equal(historicalCushion(data,'2026-10-31'),4.5);assert.equal(historicalCushion(data,'2026-10-30'),2);});
test('does not interpolate missing days or use future values',()=>{assert.equal(historicalCushion(data,'2026-10-29'),null);assert.equal(historicalCushion(data,'2026-11-01'),null);});
test('missing or zero bills are unavailable',()=>{assert.equal(historicalCushion(null,'2026-10-31'),null);assert.equal(historicalCushion({...data,book_snapshot:[{monthly_outflow_cents:0}]},'2026-10-31'),null);});
test('monthly selections use month end and disclose monthly resolution',()=>{assert.deepEqual(chartSelection('2026-09-15','1Y','2026-10-31'),{chartDate:'2026-09-15',date:'2026-09-30',resolution:'monthly'});});
test('weekly selection is capped at the latest recorded date',()=>{assert.equal(chartSelection('2026-10-29','3M','2026-10-31').date,'2026-10-31');});
