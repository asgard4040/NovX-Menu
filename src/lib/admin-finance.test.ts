import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWaylPayments } from './admin-finance';

test('WAYL collections are grouped by Baghdad calendar month and exclude pending payments', () => {
  const result = summarizeWaylPayments([
    { amount_iqd: 3000, paid_at: '2026-09-30T22:00:00Z' }, // October 1 in Baghdad
    { amount_iqd: 5000, paid_at: '2026-09-29T12:00:00Z' },
  ], 2, new Date('2026-10-21T00:00:00Z'));
  assert.equal(result.paidThisMonth, 3000);
  assert.equal(result.paidTotal, 8000);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.paidCount, 2);
  assert.equal(result.monthlySeries.at(-1)?.month, '2026-10');
  assert.equal(result.monthlySeries.at(-1)?.amount, 3000);
});
