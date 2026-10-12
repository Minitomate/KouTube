import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home, { ThemeToggle } from './routes/Home';
import Settings from './routes/Settings';
import LogoIcon from './components/LogoIcon';
import { Icon, PATHS } from './components/icons';
import { useStore, resolveTheme, applyDownloadDefaults } from './lib/store';
import { loadSettings, applyTheme } from './lib/settings';

const qc = new QueryClient();

function Shell() {
  const { view, theme, seed, variant, set } = useStore();
  useEffect(() => {
    loadSettings().then(({ settings, reset }) => {
      set({ theme: settings.theme, seed: settings.seed, variant: settings.variant });
      set({ showAdvanced: settings.showAdvanced });
      set(applyDownloadDefaults(settings.downloadDefaults));
      if (reset) console.warn('settings reset to defaults');
    });
  }, [set]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(seed, resolveTheme(theme, mq.matches), variant);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme, seed, variant]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="KouTube"><LogoIcon />ou<span>Tube</span></div>
        <nav className="row" aria-label="Sections">
          <button className="pill-btn tonal icon-btn" aria-pressed={view === 'home'} aria-label="Home" title="Home" onClick={() => set({ view: 'home' })}>
            <Icon d={PATHS.home} />
          </button>
          <button className="pill-btn tonal icon-btn" aria-pressed={view === 'settings'} aria-label="Settings" title="Settings" onClick={() => set({ view: 'settings' })}>
            <Icon d={PATHS.settings} />
          </button>
          <ThemeToggle />
        </nav>
      </header>
      {view === 'home' ? <Home /> : <Settings />}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <Shell />
    </QueryClientProvider>
  );
}
