import { useStore, useLocale, type Theme } from '../lib/store';
import { Icon, PATHS } from './icons';

const ORDER: Theme[] = ['light', 'dark', 'auto'];
const ICON = { light: PATHS.sun, dark: PATHS.moon, auto: PATHS.monitor } as const;

export default function ThemeToggle() {
  const { theme, set } = useStore();
  const { t } = useLocale();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const label =
    theme === 'auto' ? t('theme.toLight')
    : theme === 'light' ? t('theme.toDark')
    : t('theme.toAuto');
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
