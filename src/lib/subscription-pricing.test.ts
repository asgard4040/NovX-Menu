import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanPrices, planMonthlyPrice } from './subscription-pricing';

test('configured plan prices override stored restaurant prices for renewals', () => {
  const prices = parsePlanPrices('{"normal":5000,"pro":9000}');
  assert.equal(planMonthlyPrice('pro', 3000, prices), 9000);
  assert.equal(planMonthlyPrice('normal', 0, prices), 5000);
  assert.equal(planMonthlyPrice('trial', 9000, prices), null);
});

test('unconfigured and invalid prices use valid restaurant prices only', () => {
  const prices = parsePlanPrices('{"normal":-5,"pro":"9000"}');
  assert.equal(planMonthlyPrice('normal', 3000, prices), 3000);
  assert.equal(planMonthlyPrice('pro', 0, prices), null);
  assert.equal(planMonthlyPrice('pro', 3000.5, prices), null);
});
