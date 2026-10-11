// Settings: Tauri store plugin on desktop, localStorage mirror for web.
// zod-validated; corrupt stores reset to defaults loudly.
import { z } from 'zod';

export const SettingsSchema = z.object({
  outDir: z.string().nullable().default(null),
  splitKinds: z.boolean().default(false),
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  seed: z.string().default('#6750A4'),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULTS: Settings = SettingsSchema.parse({});

export interface SeedRoles {
  name: string;
  primary: string; onPrimary: string; container: string; onContainer: string;
  dark: { primary: string; onPrimary: string; container: string; onContainer: string };
}

export const SEEDS: SeedRoles[] = [
  { name: 'Grape', primary: '#6750A4', onPrimary: '#ffffff', container: '#EADDFF', onContainer: '#21005D',
    dark: { primary: '#D0BCFF', onPrimary: '#381E72', container: '#4F378B', onContainer: '#EADDFF' } },
  { name: 'Berry', primary: '#984061', onPrimary: '#ffffff', container: '#ffd9e3', onContainer: '#3e001d',
    dark: { primary: '#ffb1c8', onPrimary: '#5b0e28', container: '#7a2a4f', onContainer: '#ffd9e3' } },
  { name: 'Forest', primary: '#4d6646', onPrimary: '#ffffff', container: '#d3f1c8', onContainer: '#0a2005',
    dark: { primary: '#b9cfae', onPrimary: '#1d3520', container: '#3d4f3a', onContainer: '#d3f1c8' } },
  { name: 'Ocean', primary: '#0061a4', onPrimary: '#ffffff', container: '#d1e4ff', onContainer: '#001d35',
    dark: { primary: '#adc6ff', onPrimary: '#002e69', container: '#004b87', onContainer: '#d1e4ff' } },
  { name: 'Ember', primary: '#8a4e00', onPrimary: '#ffffff', container: '#ffdcbd', onContainer: '#2c1600',
    dark: { primary: '#ffb86b', onPrimary: '#2c1600', container: '#5c2d00', onContainer: '#ffdcbd' } },
  { name: 'Teal', primary: '#00696b', onPrimary: '#ffffff', container: '#6ff7f9', onContainer: '#002021',
    dark: { primary: '#7ddad9', onPrimary: '#002021', container: '#004f51', onContainer: '#6ff7f9' } },
];

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

/** Apply seed + theme to CSS vars. Presets carry full light+dark roles. */
export function applyTheme(seed: string, theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const sw = SEEDS.find((s) => s.primary.toLowerCase() === seed.toLowerCase());
  const roles = theme === 'dark'
    ? sw?.dark
    : sw ? { primary: sw.primary, onPrimary: sw.onPrimary, container: sw.container, onContainer: sw.onContainer } : undefined;
  if (roles) {
    root.style.setProperty('--primary', roles.primary);
    root.style.setProperty('--on-primary', roles.onPrimary);
    root.style.setProperty('--primary-container', roles.container);
    root.style.setProperty('--on-primary-container', roles.onContainer);
  } else if (theme === 'light') {
    root.style.setProperty('--primary', seed);
    root.style.removeProperty('--on-primary');
    root.style.removeProperty('--primary-container');
    root.style.removeProperty('--on-primary-container');
  } else {
    // Custom seed in dark mode: keep theme roles (guaranteed contrast).
    root.style.removeProperty('--primary');
    root.style.removeProperty('--on-primary');
    root.style.removeProperty('--primary-container');
    root.style.removeProperty('--on-primary-container');
  }
}
