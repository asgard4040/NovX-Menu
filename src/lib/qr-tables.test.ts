import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuQrUrl, tableFromQrSearch } from './qr-tables';
import { canonicalPortalRedirect, customerMenuUrl, staffPortalUrl } from './public-urls';

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

test('generated menu and staff links use their dedicated domains', () => {
  assert.equal(customerMenuUrl('restaurant-id', 5), 'https://menu.ordova.cc/?restaurantId=restaurant-id&table=5');
  assert.equal(staffPortalUrl('restaurant-id', 'kitchen'), 'https://rest.ordova.cc/?loginRestaurantId=restaurant-id&portal=kitchen');
});

test('old QR and staff links redirect without losing table or role', () => {
  assert.equal(canonicalPortalRedirect('https://menu.novx-team.com/?restaurantId=abc&table=5'), 'https://menu.ordova.cc/?restaurantId=abc&table=5');
  assert.equal(canonicalPortalRedirect('https://menu.novx-team.com/?loginRestaurantId=abc&portal=waiter'), 'https://rest.ordova.cc/?loginRestaurantId=abc&portal=waiter');
  assert.equal(canonicalPortalRedirect('https://rest.ordova.cc/?restaurantId=abc'), 'https://menu.ordova.cc/?restaurantId=abc');
  assert.equal(canonicalPortalRedirect('https://menu.ordova.cc/'), 'https://ordova.cc/');
  assert.equal(canonicalPortalRedirect('https://menu.ordova.cc/?restaurantId=abc&table=5'), null);
  assert.equal(canonicalPortalRedirect('http://localhost:3000/?restaurantId=abc'), null);
});
