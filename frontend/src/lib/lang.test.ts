import { describe, expect, it } from 'vitest';
import { captionLabel, displayLabel, languageName } from './lang';

describe('languageName', () => {
  it('resolves bare codes', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('es')).toBe('Spanish');
  });
  it('rejects und, empty and garbage', () => {
    expect(languageName('und')).toBeUndefined();
    expect(languageName('')).toBeUndefined();
    expect(languageName('xx-q')).toBeUndefined();
  });
});

describe('displayLabel', () => {
  it('upgrades bare codes', () => {
    expect(displayLabel('de', 'de')).toBe('German (de)');
    expect(displayLabel('auto:en', 'en')).toBe('English (en)');
  });
  it('keeps rich labels', () => {
    expect(displayLabel('en', 'en - English')).toBe('en - English');
    expect(displayLabel('en', 'English (en)')).toBe('English (en)');
  });
});

describe('captionLabel', () => {
  it('tags auto selections', () => {
    expect(captionLabel('auto:en')).toBe('en (auto)');
    expect(captionLabel('en')).toBe('en');
  });
});
