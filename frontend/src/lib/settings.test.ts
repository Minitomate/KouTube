import { beforeEach, describe, expect, it, vi } from 'vitest';

const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => { backing.set(k, v); },
  removeItem: (k: string) => { backing.delete(k); },
  clear: () => backing.clear(),
});

const styleProps = new Map<string, string>();
const dataset: Record<string, string> = {};
vi.stubGlobal('document', {
  documentElement: {
    dataset,
    style: {
      setProperty: (k: string, v: string) => { styleProps.set(k, v); },
      removeProperty: (k: string) => { styleProps.delete(k); },
    },
  },
});

import { applyTheme, loadSettings, saveSettings, DEFAULTS } from './settings';

beforeEach(() => {
  backing.clear();
  styleProps.clear();
});

describe('settings store', () => {
  it('round-trips through localStorage on web', async () => {
    await saveSettings({ ...DEFAULTS, outDir: '/tmp/x', splitKinds: true });
    const { settings, reset } = await loadSettings();
    expect(reset).toBe(false);
    expect(settings.outDir).toBe('/tmp/x');
    expect(settings.splitKinds).toBe(true);
  });

  it('resets corrupt stores loudly', async () => {
    backing.set('koutube-settings', '{not json');
    const { settings, reset } = await loadSettings();
    expect(reset).toBe(true);
    expect(settings).toEqual(DEFAULTS);
  });

  it('applies theme-correct swatch roles to CSS vars', async () => {
    applyTheme('#984061', 'dark');
    expect(styleProps.get('--primary')).toBe('#ffb1c8');
    expect(styleProps.get('--primary-container')).toBe('#7a2a4f');
    expect(dataset.theme).toBe('dark');
    applyTheme('#984061', 'light');
    expect(styleProps.get('--primary')).toBe('#984061');
  });

  it('keeps every swatch readable in both themes', async () => {
    const { SEEDS } = await import('./settings');
    const lum = (hex: string): number => {
      const c = hex.replace('#', '');
      const f = (i: number) => {
        const v = parseInt(c.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const s of SEEDS) {
      expect(ratio(s.primary, '#fef7ff')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s.onContainer, s.container)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s.dark.primary, '#141218')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s.dark.onContainer, s.dark.container)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s.dark.onPrimary, s.dark.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
