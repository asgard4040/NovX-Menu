import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeCategory, localizeDeviceType, localizeProvince } from './i18n';

test('built-in menu categories use English labels without changing stored values', () => {
  assert.equal(localizeCategory('الوجبات الأساسية', 'en'), 'Main dishes');
  assert.equal(localizeCategory('المقبلات', 'en'), 'Appetizers');
  assert.equal(localizeCategory('الحلويات', 'en'), 'Desserts');
  assert.equal(localizeCategory('المشروبات', 'en'), 'Drinks');
  assert.equal(localizeCategory('المشروبات', 'ar'), 'المشروبات');
});

test('restaurant-authored category names remain unchanged', () => {
  assert.equal(localizeCategory('مشاوي خاصة', 'en'), 'مشاوي خاصة');
  assert.equal(localizeCategory('Chef specials', 'en'), 'Chef specials');
});

test('built-in province labels display in English without changing stored Arabic values', () => {
  assert.equal(localizeProvince('بغداد', 'en'), 'Baghdad');
  assert.equal(localizeProvince('البصرة', 'en'), 'Basra');
  assert.equal(localizeProvince('بغداد', 'ar'), 'بغداد');
  assert.equal(localizeProvince('Other', 'en'), 'Other');
});

test('known device metadata is localized only for display', () => {
  assert.equal(localizeDeviceType('جهاز أندرويد (Android)', 'en'), 'Android device');
  assert.equal(localizeDeviceType('جهاز أندرويد (Android)', 'ar'), 'جهاز أندرويد (Android)');
  assert.equal(localizeDeviceType('Custom device', 'en'), 'Custom device');
});
