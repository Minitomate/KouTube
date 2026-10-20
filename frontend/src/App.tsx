import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home, { ThemeToggle } from './routes/Home';
import Settings from './routes/Settings';
import LogoIcon from './components/LogoIcon';
import { Icon, PATHS } from './components/icons';
import { useStore, resolveTheme, applyDownloadDefaults, useLocale } from './lib/store';
import { loadSettings, applyTheme } from './lib/settings';
import { t } from './lib/i18n';
import { isTauri, isAndroid } from './lib/desktop';
import { runUpdateCheck, runUpdateDownload, dismissPendingUpdate, relaunchApp, shouldAutoCheck, formatReleaseDate } from './lib/updater';
import ContextMenu from './components/ContextMenu';

const qc = new QueryClient();

function Shell() {
  const { view, theme, seed, variant, locale, set, updateStatus, updateVersion, updatePubDate, updateProgress, updateDismissed } = useStore();
  const { lang, t: tx } = useLocale();
  useEffect(() => {
    loadSettings().then(({ settings, reset }) => {
      set({ theme: settings.theme, seed: settings.seed, variant: settings.variant, locale: settings.locale });
      set({ showAdvanced: settings.showAdvanced });
      set({ showThumbnails: settings.showThumbnails });
      set(applyDownloadDefaults(settings.downloadDefaults));
      if (reset) console.warn('settings reset to defaults');
    });
  }, [set]);
  // Daily update check (desktop only): silent unless an update is found.
  // Failures never surface here — an offline launch retries next time.
  useEffect(() => {
    // Updates are an APK reinstall on Android: no in-app updater there.
    if (!isTauri() || isAndroid()) return;
    (async () => {
      try {
        const { settings } = await loadSettings();
        if (!shouldAutoCheck(settings.autoUpdateCheck, settings.lastUpdateCheck)) return;
        await runUpdateCheck(lang);
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
  // Locale follows the OS/browser while set to System: <html lang>, the tab
  // title and every string re-resolve live on languagechange.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t(lang, 'app.title');
  }, [lang]);
  useEffect(() => {
    if (locale !== 'auto') return;
    const onLang = () => set({ localeTick: useStore.getState().localeTick + 1 });
    window.addEventListener('languagechange', onLang);
    return () => window.removeEventListener('languagechange', onLang);
  }, [locale, set]);
  async function dismissBanner() {
    set({ updateDismissed: true });
    await dismissPendingUpdate();
  }
  const showBanner = isTauri() && !isAndroid() && !updateDismissed &&
    (updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready');
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="KouTube"><LogoIcon />Kou<span>Tube</span></div>
        <nav className="row" aria-label={tx('nav.sections')}>
          <button className="pill-btn tonal icon-btn" aria-pressed={view === 'home'} aria-label={tx('nav.home')} title={tx('nav.home')} onClick={() => set({ view: 'home' })}>
            <Icon d={PATHS.home} />
          </button>
          <button className="pill-btn tonal icon-btn" aria-pressed={view === 'settings'} aria-label={tx('nav.settings')} title={tx('nav.settings')} onClick={() => set({ view: 'settings' })}>
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
                ? tx('update.ready', { v: updateVersion ?? '' })
                : tx('update.available', { v: updateVersion ?? '' })}
            </strong>
            {updateStatus !== 'downloading' && formatReleaseDate(updatePubDate, lang) && (
              <div className="meta">{tx('update.released', { date: formatReleaseDate(updatePubDate, lang) ?? '' })}</div>
            )}
            {updateStatus === 'downloading' && (
              updateProgress == null
                ? <div className="meta">{tx('update.downloading')}</div>
                : <div className="progress-pill" role="progressbar" aria-valuenow={updateProgress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${updateProgress}%` }} /></div>
            )}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {updateStatus === 'available' && <button className="pill-btn filled" onClick={() => void runUpdateDownload(lang)}>{tx('update.update')}</button>}
            {updateStatus === 'downloading' && (
              <button className="pill-btn filled" disabled>{updateProgress == null ? tx('update.downloading') : `${updateProgress}%`}</button>
            )}
            {updateStatus === 'ready' && <button className="pill-btn filled" onClick={() => void relaunchApp()}>{tx('update.restart')}</button>}
            <button className="pill-btn text" onClick={() => void dismissBanner()}>{tx('update.later')}</button>
          </div>
        </div>
      )}
      {view === 'home' ? <Home /> : <Settings />}
      <ContextMenu />
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
