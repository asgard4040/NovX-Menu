import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptPasscode, encryptPasscode, generatePasscode, isPasscode, isWeakPasscode, passcodeDigest, passcodeKey } from './passcodes';

const key = passcodeKey('11'.repeat(32));

test('passcodes must be exactly four ASCII digits, including leading zeroes', () => {
  for (const code of ['0000', '0123', '9999']) assert.equal(isPasscode(code), true);
  for (const code of ['123', '12345', '12a4', '١٢٣٤', 1234]) assert.equal(isPasscode(code), false);
  for (let index = 0; index < 100; index++) {
    const code = generatePasscode();
    assert.match(code, /^[0-9]{4}$/);
    assert.equal(isWeakPasscode(code), false);
  }
  assert.equal(isWeakPasscode('1234'), true);
  assert.equal(isWeakPasscode('0000'), true);
});

test('lookup digests are stable and secret-dependent', () => {
  assert.equal(passcodeDigest('0123', key), passcodeDigest('0123', key));
  assert.notEqual(passcodeDigest('0123', key), passcodeDigest('0124', key));
  assert.notEqual(passcodeDigest('0123', key), passcodeDigest('0123', passcodeKey('22'.repeat(32))));
  assert.throws(() => passcodeKey('short'), /passcode_secret_not_configured/);
});

test('viewable codes are authenticated-encrypted, not stored as plaintext', () => {
  const first = encryptPasscode('0123', key);
  const second = encryptPasscode('0123', key);
  assert.notEqual(first, second);
  assert.equal(decryptPasscode(first, key), '0123');
  assert.ok(!first.includes('0123'));
  assert.throws(() => decryptPasscode(first.slice(0, -2) + 'aa', key));
});
