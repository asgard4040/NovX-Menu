import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { renewalAmount, validWaylCheckoutUrl, verifyWaylSignature, waylLinkIsPaid } from './wayl';

test('renewal prices are positive whole IQD for paid durations', () => {
  assert.equal(renewalAmount(10000, 'month'), 10000);
  assert.equal(renewalAmount(10000, 'six-months'), 60000);
  assert.equal(renewalAmount(10000, 'year'), 120000);
  assert.equal(renewalAmount(0, 'month'), null);
  assert.equal(renewalAmount(1000, 'week'), null);
  assert.equal(renewalAmount(1.25, 'month'), null);
});

test('webhook signature is checked against exact raw bytes', () => {
  const body = Buffer.from('{"referenceId":"renewal-1","status":"Complete"}');
  const secret = 'a-private-webhook-secret';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWaylSignature(body, signature, secret), true);
  assert.equal(verifyWaylSignature(Buffer.from(body.toString().replace(',', ', ')), signature, secret), false);
  assert.equal(verifyWaylSignature(body, 'bad', secret), false);
});

test('only matching settled WAYL links grant a renewal', () => {
  const link = { id: 'wayl-1', referenceId: 'renewal-1', currency: 'IQD', total: '10000', status: 'Complete' };
  assert.equal(waylLinkIsPaid(link, 'renewal-1', 10000, 'wayl-1'), true);
  assert.equal(waylLinkIsPaid({ ...link, status: 'Delivered' }, 'renewal-1', 10000, 'wayl-1'), true);
  for (const status of ['Created', 'Pending', 'Processing', 'Rejected', 'Returned', 'Cancelled']) {
    assert.equal(waylLinkIsPaid({ ...link, status }, 'renewal-1', 10000, 'wayl-1'), false);
  }
  assert.equal(waylLinkIsPaid({ ...link, total: '1' }, 'renewal-1', 10000, 'wayl-1'), false);
  assert.equal(waylLinkIsPaid({ ...link, referenceId: 'other' }, 'renewal-1', 10000, 'wayl-1'), false);
  assert.equal(waylLinkIsPaid({ ...link, id: 'other' }, 'renewal-1', 10000, 'wayl-1'), false);
});

test('checkout URLs stay on WAYL HTTPS hosts', () => {
  assert.equal(validWaylCheckoutUrl('https://checkout.thewayl.com/payment/action?id=123'), true);
  assert.equal(validWaylCheckoutUrl('https://link.thewayl.com/pay?id=123'), true);
  assert.equal(validWaylCheckoutUrl('https://checkout.thewayl.com.evil.example/pay'), false);
  assert.equal(validWaylCheckoutUrl('http://checkout.thewayl.com/pay'), false);
});
