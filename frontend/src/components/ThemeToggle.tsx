import { useEffect, useState } from 'react';
import { useStore, resolveTheme, type Theme } from '../lib/store';

const ORDER: Theme[] = ['light', 'dark', 'auto'];

export default function ThemeToggle() {
  const { theme, set } = useStore();
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  const effective = resolveTheme(theme, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const label =
    theme === 'auto' ? `Theme auto (system ${effective}) — switch to light`
    : theme === 'light' ? 'Switch to dark mode'
    : 'Switch to automatic theme';
  return (
    <button
      className="pill-btn tonal"
      style={{ minHeight: 40 }}
      aria-label={label}
      onClick={() => set({ theme: next })}
    >
      {theme === 'auto' ? `Auto (${effective})` : theme === 'light' ? 'Dark' : 'Light'}
    </button>
  );
}
