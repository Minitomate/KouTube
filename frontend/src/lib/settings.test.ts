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

// Mock the M3 library — its extensionless ESM imports break under vitest's
// native ESM loader. We test our mapping logic, not Google's color math.
vi.mock('@material/material-color-utilities', () => ({
  argbFromHex: (hex: string) => parseInt(hex.replace('#', ''), 16),
  Hct: { fromInt: (argb: number) => ({ argb }) },
  hexFromArgb: (argb: number) => `#${argb.toString(16).padStart(8, '0').slice(-6)}`,
  Variant: { TONAL_SPOT: 'tonal-spot', VIBRANT: 'vibrant', EXPRESSIVE: 'expressive' },
  DynamicScheme: class {
    constructor(public opts: { sourceColorArgb: number; variant: string; isDark: boolean }) {}
  },
  MaterialDynamicColors: {
    primary: { getArgb: () => 0x6750a4 },
    onPrimary: { getArgb: () => 0xffffff },
    primaryContainer: { getArgb: () => 0xeaddff },
    onPrimaryContainer: { getArgb: () => 0x21005d },
    secondaryContainer: { getArgb: () => 0xe8def8 },
    onSecondaryContainer: { getArgb: () => 0x1d192b },
    tertiary: { getArgb: () => 0x7d5260 },
    onTertiary: { getArgb: () => 0xffffff },
    tertiaryContainer: { getArgb: () => 0xffd8e4 },
    onTertiaryContainer: { getArgb: () => 0x31111d },
    surface: { getArgb: () => 0xfef7ff },
    onSurface: { getArgb: () => 0x1d1b20 },
    surfaceContainerLowest: { getArgb: () => 0xffffff },
    surfaceContainerLow: { getArgb: () => 0xf7f2fa },
    surfaceContainer: { getArgb: () => 0xf3edf7 },
    surfaceContainerHigh: { getArgb: () => 0xece6f0 },
    surfaceContainerHighest: { getArgb: () => 0xe6e0e9 },
    onSurfaceVariant: { getArgb: () => 0x49454f },
    outline: { getArgb: () => 0x79747e },
    outlineVariant: { getArgb: () => 0xcac4d0 },
    error: { getArgb: () => 0xb3261e },
    onError: { getArgb: () => 0xffffff },
    errorContainer: { getArgb: () => 0xf9dedc },
    onErrorContainer: { getArgb: () => 0x410e0b },
  },
}));

import { applyTheme, loadSettings, saveSettings, DEFAULTS, moodRoles, SEEDS, VARIANTS } from './settings';

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

  it('round-trips download defaults and the advanced toggle', async () => {
    await saveSettings({
      ...DEFAULTS,
      showAdvanced: true,
      downloadDefaults: {
        ...DEFAULTS.downloadDefaults, format: 'audio', audioContainer: 'flac', captionsFormat: 'vtt',
      },
    });
    const { settings, reset } = await loadSettings();
    expect(reset).toBe(false);
    expect(settings.showAdvanced).toBe(true);
    expect(settings.downloadDefaults.format).toBe('audio');
    expect(settings.downloadDefaults.audioContainer).toBe('flac');
    expect(settings.downloadDefaults.captionsFormat).toBe('vtt');
  });

  it('defaults the new fields on old stores', () => {
    expect(DEFAULTS.showAdvanced).toBe(false);
    expect(DEFAULTS.downloadDefaults.format).toBe('video');
    expect(DEFAULTS.maxConcurrent).toBe(4);
  });

  it('resets corrupt stores loudly', async () => {
    backing.set('koutube-settings', '{not json');
    const { settings, reset } = await loadSettings();
    expect(reset).toBe(true);
    expect(settings).toEqual(DEFAULTS);
  });

  it('applies generated mood roles to CSS vars', () => {
    applyTheme('#984061', 'dark');
    const roles = moodRoles('#984061', 'tonal-spot', true);
    expect(styleProps.get('--primary')).toBe(roles['--primary']);
    expect(styleProps.get('--primary-container')).toBe(roles['--primary-container']);
    expect(dataset.theme).toBe('dark');
    applyTheme('#984061', 'light');
    expect(styleProps.get('--primary')).toBe(moodRoles('#984061', 'tonal-spot', false)['--primary']);
  });

  it('exposes seeds and variants', () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(4);
    expect(VARIANTS.map((v) => v.id)).toEqual(['tonal-spot', 'vibrant', 'expressive']);
  });
});
