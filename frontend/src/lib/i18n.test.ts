import { describe, expect, it } from 'vitest';
import { readLocaleSettingSync, resolveLocale, STRINGS, t, type I18nKey } from './i18n';

describe('resolveLocale', () => {
  it('follows the system language in auto mode', () => {
    expect(resolveLocale('auto', 'es')).toBe('es');
    expect(resolveLocale('auto', 'es-MX')).toBe('es');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale('auto', 'fr-FR')).toBe('en');
    expect(resolveLocale('auto', '')).toBe('en');
  });
  it('explicit choice wins over the system language', () => {
    expect(resolveLocale('en', 'es-MX')).toBe('en');
    expect(resolveLocale('es', 'en-US')).toBe('es');
  });
});

describe('dictionary parity', () => {
  it('es covers every en key with no empties', () => {
    const keys = Object.keys(STRINGS.en) as I18nKey[];
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect(STRINGS.es[k], k).toBeTruthy();
    }
  });
  it('interpolates vars', () => {
    expect(t('en', 'home.zipCap', { cap: 10, n: 42 })).toBe('ZIP capped at first 10 of 42 videos.');
    expect(t('es', 'home.zipCap', { cap: 10, n: 42 })).toBe('ZIP limitado a los primeros 10 de 42 videos.');
    expect(t('en', 'queue.empty')).toBe('Nothing here yet.');
    expect(t('es', 'queue.empty')).toBe('Nada aquí todavía.');
  });
});

describe('readLocaleSettingSync', () => {
  it('reads valid choices, defaults otherwise', () => {
    localStorage.setItem('koutube-settings', JSON.stringify({ locale: 'es' }));
    expect(readLocaleSettingSync()).toBe('es');
    localStorage.setItem('koutube-settings', JSON.stringify({ locale: 'xx' }));
    expect(readLocaleSettingSync()).toBe('auto');
    localStorage.setItem('koutube-settings', JSON.stringify({}));
    expect(readLocaleSettingSync()).toBe('auto');
    localStorage.setItem('koutube-settings', '{nope');
    expect(readLocaleSettingSync()).toBe('auto');
    localStorage.removeItem('koutube-settings');
    expect(readLocaleSettingSync()).toBe('auto');
  });
});
