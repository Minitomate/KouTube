import { useStore, type Theme } from '../lib/store';
import { Icon, PATHS } from './icons';

const ORDER: Theme[] = ['light', 'dark', 'auto'];
const ICON = { light: PATHS.sun, dark: PATHS.moon, auto: PATHS.monitor } as const;

export default function ThemeToggle() {
  const { theme, set } = useStore();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const label =
    theme === 'auto' ? 'Theme automatic — switch to light'
    : theme === 'light' ? 'Switch to dark mode'
    : 'Switch to automatic theme';
  return (
    <button
      className="pill-btn tonal icon-btn"
      aria-label={label}
      title={label}
      onClick={() => set({ theme: next })}
    >
      <Icon d={ICON[theme]} />
    </button>
  );
}
