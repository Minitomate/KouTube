import { useEffect } from 'react';
import { useStore } from '../lib/store';

export default function ThemeToggle() {
  const { theme, set } = useStore();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <button
      className="pill-btn tonal"
      style={{ minHeight: 40 }}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={() => set({ theme: theme === 'light' ? 'dark' : 'light' })}
    >
      {theme === 'light' ? 'Dark' : 'Light'}
    </button>
  );
}
