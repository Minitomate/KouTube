import { useStore, type Theme } from '../lib/store';

const ORDER: Theme[] = ['light', 'dark', 'auto'];

export default function ThemeToggle() {
  const { theme, set } = useStore();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const label =
    theme === 'auto' ? 'Theme automatic — switch to light'
    : theme === 'light' ? 'Switch to dark mode'
    : 'Switch to automatic theme';
  return (
    <button
      className="pill-btn tonal"
      style={{ minHeight: 40 }}
      aria-label={label}
      onClick={() => set({ theme: next })}
    >
      {theme === 'auto' ? 'Auto' : theme === 'light' ? 'Dark' : 'Light'}
    </button>
  );
}
