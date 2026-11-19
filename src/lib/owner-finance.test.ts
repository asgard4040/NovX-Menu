import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOwnerOrders } from './owner-finance';
import type { Order } from '../types';

const order = (status: Order['status'], totalAmount: number, createdAt: string): Order => ({
  id: `${status}-${createdAt}`, restaurantId: 'r', customerName: 'A', tableNumber: '1',
  status, totalAmount, createdAt: Date.parse(createdAt),
  items: [{ id: 'coffee', name: 'Coffee', quantity: 2, price: 1000 }],
});

test('owner finance counts served order value in Baghdad dates and keeps open orders separate', () => {
  const summary = summarizeOwnerOrders([
    order('served', 2000, '2026-10-20T22:30:00Z'),
    order('pending', 3000, '2026-10-21T08:00:00Z'),
    order('rejected', 5000, '2026-10-21T09:00:00Z'),
    order('served', 4000, '2026-10-19T09:00:00Z'),
  ], Date.parse('2026-10-21T10:00:00Z'));
  assert.equal(summary.todayValue, 2000);
  assert.equal(summary.monthValue, 6000);
  assert.equal(summary.openValue, 3000);
  assert.equal(summary.averageTicket, 3000);
  assert.equal(summary.monthRejectedCount, 1);
  assert.equal(summary.topItems[0].quantity, 4);
  assert.equal(summary.week.at(-1)?.value, 2000);
});
