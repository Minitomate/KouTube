import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home, { ThemeToggle } from './routes/Home';
import Settings from './routes/Settings';
import LogoIcon from './components/LogoIcon';
import { Icon, PATHS } from './components/icons';
import { useStore, resolveTheme, applyDownloadDefaults } from './lib/store';
import { loadSettings, applyTheme } from './lib/settings';
import { isTauri } from './lib/desktop';
import { runUpdateCheck, runUpdateDownload, dismissPendingUpdate, relaunchApp, shouldAutoCheck, formatReleaseDate } from './lib/updater';

const qc = new QueryClient();

function Shell() {
  const { view, theme, seed, variant, set, updateStatus, updateVersion, updatePubDate, updateProgress, updateDismissed } = useStore();
  useEffect(() => {
    loadSettings().then(({ settings, reset }) => {
      set({ theme: settings.theme, seed: settings.seed, variant: settings.variant });
      set({ showAdvanced: settings.showAdvanced });
      set(applyDownloadDefaults(settings.downloadDefaults));
      if (reset) console.warn('settings reset to defaults');
    });
  }, [set]);
  // Daily update check (desktop only): silent unless an update is found.
  // Failures never surface here — an offline launch retries next time.
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { settings } = await loadSettings();
        if (!shouldAutoCheck(settings.autoUpdateCheck, settings.lastUpdateCheck)) return;
        await runUpdateCheck();
      } catch { /* next launch retries */ }
    })();
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(seed, resolveTheme(theme, mq.matches), variant);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme, seed, variant]);
  async function dismissBanner() {
    set({ updateDismissed: true });
    await dismissPendingUpdate();
  }
  const showBanner = isTauri() && !updateDismissed &&
    (updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready');
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
      {showBanner && (
        <div className="card banner-card banner-update" role="status">
          <div>
            <strong>
              {updateStatus === 'ready'
                ? `KouTube ${updateVersion} is ready — restart to apply it.`
                : `KouTube ${updateVersion} is available.`}
            </strong>
            {updateStatus !== 'downloading' && formatReleaseDate(updatePubDate) && (
              <div className="meta">Released {formatReleaseDate(updatePubDate)}.</div>
            )}
            {updateStatus === 'downloading' && (
              updateProgress == null
                ? <div className="meta">Downloading…</div>
                : <div className="progress-pill" role="progressbar" aria-valuenow={updateProgress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${updateProgress}%` }} /></div>
            )}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {updateStatus === 'available' && <button className="pill-btn filled" onClick={() => void runUpdateDownload()}>Update</button>}
            {updateStatus === 'downloading' && (
              <button className="pill-btn filled" disabled>{updateProgress == null ? 'Downloading…' : `${updateProgress}%`}</button>
            )}
            {updateStatus === 'ready' && <button className="pill-btn filled" onClick={() => void relaunchApp()}>Restart now</button>}
            <button className="pill-btn text" onClick={() => void dismissBanner()}>Later</button>
          </div>
        </div>
      )}
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
