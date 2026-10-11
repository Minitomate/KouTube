// Settings: Tauri store plugin on desktop, localStorage mirror for web.
// zod-validated; corrupt stores reset to defaults loudly.
import { z } from 'zod';
import {
  argbFromHex,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors as MDC,
  Variant,
} from '@material/material-color-utilities';

export const DownloadDefaultsSchema = z.object({
  format: z.enum(['video', 'audio', 'captions']).default('video'),
  quality: z.string().default('best'),
  container: z.enum(['mp4', 'webm', 'mkv']).default('mp4'),
  codec: z.enum(['auto', 'avc', 'hevc', 'vp9', 'av1']).default('auto'),
  audioContainer: z.enum(['mp3', 'm4a', 'opus', 'wav', 'flac']).default('mp3'),
  audioCodec: z.string().default('mp3'),
  audioQuality: z.enum(['best', '320K', '256K', '192K', '128K']).default('best'),
  captionsFormat: z.enum(['srt', 'vtt']).default('srt'),
});
export type DownloadDefaults = z.infer<typeof DownloadDefaultsSchema>;

export const SettingsSchema = z.object({
  outDir: z.string().nullable().default(null),
  splitKinds: z.boolean().default(false),
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  seed: z.string().default('#6750A4'),
  variant: z.enum(['tonal-spot', 'vibrant', 'expressive']).default('tonal-spot'),
  maxConcurrent: z.number().int().min(1).max(8).default(4),
  showAdvanced: z.boolean().default(false),
  downloadDefaults: DownloadDefaultsSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type MoodVariant = Settings['variant'];

/** Clamp stored garbage to the 1–8 pool range (default 4). */
export function clampConcurrent(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 4;
  return Math.min(8, Math.max(1, v));
}

export const DEFAULTS: Settings = SettingsSchema.parse({});

export interface SeedSwatch {
  name: string;
  seed: string;
}

export const SEEDS: SeedSwatch[] = [
  { name: 'Grape', seed: '#6750A4' },
  { name: 'Berry', seed: '#984061' },
  { name: 'Forest', seed: '#4d6646' },
  { name: 'Ocean', seed: '#0061a4' },
  { name: 'Ember', seed: '#8a4e00' },
  { name: 'Teal', seed: '#00696b' },
];

export const VARIANTS: Array<{ id: MoodVariant; label: string }> = [
  { id: 'tonal-spot', label: 'Tonal Spot' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'expressive', label: 'Expressive' },
];

function toVariant(v: MoodVariant): Variant {
  switch (v) {
    case 'vibrant': return Variant.VIBRANT;
    case 'expressive': return Variant.EXPRESSIVE;
    default: return Variant.TONAL_SPOT;
  }
}

/** Full M3 mood from a seed: every role the app consumes, both modes. */
export function moodRoles(seed: string, variant: MoodVariant, dark: boolean): Record<string, string> {
  const scheme = new DynamicScheme({
    sourceColorHct: Hct.fromInt(argbFromHex(seed.startsWith('#') ? seed : `#${seed}`)),
    variant: toVariant(variant),
    contrastLevel: 0,
    isDark: dark,
  });
  const hex = (c: { getArgb: (s: typeof scheme) => number }) => hexFromArgb(c.getArgb(scheme));
  return {
    '--primary': hex(MDC.primary),
    '--on-primary': hex(MDC.onPrimary),
    '--primary-container': hex(MDC.primaryContainer),
    '--on-primary-container': hex(MDC.onPrimaryContainer),
    '--secondary-container': hex(MDC.secondaryContainer),
    '--on-secondary-container': hex(MDC.onSecondaryContainer),
    '--tertiary': hex(MDC.tertiary),
    '--on-tertiary': hex(MDC.onTertiary),
    '--tertiary-container': hex(MDC.tertiaryContainer),
    '--on-tertiary-container': hex(MDC.onTertiaryContainer),
    '--surface': hex(MDC.surface),
    '--on-surface': hex(MDC.onSurface),
    '--surface-container-lowest': hex(MDC.surfaceContainerLowest),
    '--surface-container-low': hex(MDC.surfaceContainerLow),
    '--surface-container': hex(MDC.surfaceContainer),
    '--surface-container-high': hex(MDC.surfaceContainerHigh),
    '--surface-container-highest': hex(MDC.surfaceContainerHighest),
    '--on-surface-variant': hex(MDC.onSurfaceVariant),
    '--outline': hex(MDC.outline),
    '--outline-variant': hex(MDC.outlineVariant),
    '--error': hex(MDC.error),
    '--on-error': hex(MDC.onError),
    '--error-container': hex(MDC.errorContainer),
    '--on-error-container': hex(MDC.onErrorContainer),
    '--bg': hex(MDC.surface),
  };
}

const LS_KEY = 'koutube-settings';

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function loadSettings(): Promise<{ settings: Settings; reset: boolean }> {
  let raw: unknown = null;
  if (isTauriEnv()) {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('settings.json');
      raw = await store.get('settings');
    } catch {
      raw = null;
    }
  }
  if (raw == null) {
    let corrupt = false;
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored !== null) {
        raw = JSON.parse(stored);
      }
    } catch {
      corrupt = true;
    }
    const parsed = SettingsSchema.safeParse(raw ?? {});
    if (!parsed.success || corrupt) {
      await saveSettings(DEFAULTS);
      return { settings: DEFAULTS, reset: true };
    }
    return { settings: parsed.data, reset: false };
  }
  const parsed = SettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    await saveSettings(DEFAULTS);
    return { settings: DEFAULTS, reset: true };
  }
  return { settings: parsed.data, reset: false };
}

export async function saveSettings(s: Settings): Promise<void> {
  const data = SettingsSchema.parse(s);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
  if (isTauriEnv()) {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('settings.json');
      await store.set('settings', data);
      await store.save();
    } catch { /* mirror is best-effort */ }
  }
}

/** Apply seed + variant + theme to CSS vars (full mood, both modes). */
export function applyTheme(seed: string, theme: 'light' | 'dark', variant: MoodVariant = 'tonal-spot'): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const roles = moodRoles(seed, variant, theme === 'dark');
  for (const [k, v] of Object.entries(roles)) {
    root.style.setProperty(k, v);
  }
}
