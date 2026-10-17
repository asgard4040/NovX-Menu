import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, resolveTheme } from './themes';

test('Ordova is the default while the Italian theme remains selectable', () => {
  assert.equal(DEFAULT_THEME.id, 'ordova');
  assert.equal(resolveTheme().colors.primary, '#081220');
  assert.equal(resolveTheme('italian-luxury').colors.primary, '#2D3A27');
});

test('restaurant branding overrides remain effective', () => {
  const custom = resolveTheme('ordova', { primary: '#123456', accent: '#654321' });
  assert.equal(custom.colors.primary, '#123456');
  assert.equal(custom.colors.accent, '#654321');
  assert.equal(custom.colors.background, DEFAULT_THEME.colors.background);
});
