import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNewRelevantOrder } from './order-sound-events';

const orders = [{ id: 'new', status: 'pending' as const }];

test('new-order sound skips initial backlog and repeated updates', () => {
  assert.equal(hasNewRelevantOrder(null, orders, 'waiter'), false);
  assert.equal(hasNewRelevantOrder(new Set(['new']), orders, 'waiter'), false);
  assert.equal(hasNewRelevantOrder(new Set(), orders, 'waiter'), true);
});

test('kitchen sound is limited to newly preparing orders', () => {
  assert.equal(hasNewRelevantOrder(new Set(), orders, 'kitchen'), false);
  assert.equal(hasNewRelevantOrder(new Set(), [{ id: 'new', status: 'preparing' }], 'kitchen'), true);
});
