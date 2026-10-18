import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuQrUrl, tableFromQrSearch } from './qr-tables';

test('numbered QR links prefill only valid table numbers', () => {
  const url = menuQrUrl('https://menu.example.com', 'restaurant-id', 12);
  assert.equal(new URL(url).searchParams.get('restaurantId'), 'restaurant-id');
  assert.equal(tableFromQrSearch(new URL(url).search), '12');
  assert.equal(tableFromQrSearch('?table=0'), null);
  assert.equal(tableFromQrSearch('?table=001'), null);
  assert.equal(tableFromQrSearch('?table=1%20or%201'), null);
  assert.equal(tableFromQrSearch('?table=1000'), null);
  assert.equal(tableFromQrSearch('?restaurantId=restaurant-id'), null);
});
