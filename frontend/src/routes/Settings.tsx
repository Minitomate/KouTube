import { useEffect, useState } from 'react';
import { useStore, useLocale } from '../lib/store';
import { loadSettings, patchSettings, SEEDS, VARIANTS, type Settings } from '../lib/settings';
import { localeTag } from '../lib/i18n';
import { copyDebugLog, saveDebugLog } from '../lib/debug';
import { QUALITIES } from '../lib/store';
import { isTauri, pickFolder, getRecentLogs, openTerms, openExternal, CREATOR_LINKS } from '../lib/desktop';
import { Icon, PATHS } from '../components/icons';
import Footer from '../components/Footer';
import { runUpdateCheck, runUpdateDownload, relaunchApp, openReleasesPage, getAppVersion, formatReleaseDate } from '../lib/updater';
import PreferenceFields from '../components/PreferenceFields';
import Switch from '../components/Switch';

export default function Settings() {
  const { set, updateStatus, updateVersion, updateNotes, updatePubDate, updateProgress, updateError } = useStore();
  const { lang, t } = useLocale();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [note, setNote] = useState('');
  const [log, setLog] = useState<string[] | null>(null);
  const [appVersion, setAppVersion] = useState('…');

  useEffect(() => {
    if (isTauri()) getAppVersion().then(setAppVersion).catch(() => setAppVersion(t('foot.unknown')));
  }, [t]);

  async function manualCheck() {
    await runUpdateCheck(lang);
    try {
      const { settings: s } = await loadSettings();
      setSettings(s);
    } catch { /* stamp display is best-effort */ }
  }

  useEffect(() => {
    loadSettings().then(({ settings: s, reset }) => {
      setSettings(s);
      set({ theme: s.theme, seed: s.seed, locale: s.locale });
      if (reset) setNote(t('set.corrupt'));
    });
  }, [set, t]);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = await patchSettings(patch);
    setSettings(next);
    if (patch.theme) set({ theme: patch.theme });
    if (patch.seed) set({ seed: patch.seed });
    if (patch.variant) set({ variant: patch.variant });
    if (patch.locale) set({ locale: patch.locale });
  }

  async function chooseFolder() {
    if (!isTauri()) {
      setNote(t('set.folderDesktop'));
      return;
    }
    const picked = await pickFolder().catch(() => null);
    if (picked && !Array.isArray(picked)) {
      await update({ outDir: picked });
      setNote(t('set.folderIs', { dir: picked }));
    }
  }

  async function copyLog() {
    try {
      await copyDebugLog();
      setNote(t('set.logCopied'));
    } catch {
      setNote(t('set.logCopyFail'));
    }
  }

  async function saveLog() {
    try {
      const r = await saveDebugLog();
      if (r === null) return; // save dialog cancelled: stay silent
      setNote(r ? t('set.logSaved', { path: r }) : t('set.logSavedWeb'));
    } catch (e) {
      setNote(t('set.logSaveFail', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function showLog() {
    if (!isTauri()) {
      setLog([t('set.logDesktopOnly')]);
      return;
    }
    try {
      setLog(await getRecentLogs());
    } catch {
      setLog([t('set.logReadFail')]);
    }
  }

  if (!settings) return <div className="card"><p className="empty">{t('set.loading')}</p></div>;

  return (
    <>
      <div className="card">
        <h2>{t('set.updates')}</h2>
        {isTauri() ? (
          <>
            <div className="meta">
              {t('set.currentVersion', { v: appVersion })}
              {settings.lastUpdateCheck
                ? t('set.lastChecked', { d: new Date(settings.lastUpdateCheck).toLocaleString(localeTag(lang)) })
                : t('set.neverChecked')}
            </div>
            <div style={{ marginTop: 8 }}>
              <Switch
                checked={settings.autoUpdateCheck}
                onChange={() => update({ autoUpdateCheck: !settings.autoUpdateCheck })}
                label={t('set.autoCheck')}
              />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="pill-btn tonal"
                onClick={() => void manualCheck()}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              >
                {updateStatus === 'checking' ? t('set.checking') : t('set.check')}
              </button>
              {updateStatus === 'available' && (
                <button className="pill-btn filled" onClick={() => void runUpdateDownload(lang)}>
                  {t('set.downloadInstall', { v: updateVersion ?? '' })}
                </button>
              )}
              {updateStatus === 'ready' && (
                <button className="pill-btn filled" onClick={() => void relaunchApp()}>{t('update.restart')}</button>
              )}
            </div>
            {updateStatus === 'uptodate' && <div className="meta" style={{ marginTop: 8 }}>{t('set.uptodate')}</div>}
            {updateStatus === 'ready' && (
              <div className="meta" style={{ marginTop: 8 }}>{t('set.installed', { v: updateVersion ?? '' })}</div>
            )}
            {updateStatus === 'available' && formatReleaseDate(updatePubDate, lang) && (
              <div className="meta" style={{ marginTop: 8 }}>{t('update.released', { date: formatReleaseDate(updatePubDate, lang) ?? '' })}</div>
            )}
            {updateStatus === 'available' && updateNotes && (
              <pre className="log-view" style={{ whiteSpace: 'pre-wrap' }}>{updateNotes}</pre>
            )}
            {updateStatus === 'downloading' && (
              <div style={{ marginTop: 8 }}>
                {updateProgress == null ? (
                  <div className="progress-pill indeterminate" role="progressbar"><div /></div>
                ) : (
                  <div className="progress-pill" role="progressbar" aria-valuenow={updateProgress} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${updateProgress}%` }} />
                  </div>
                )}
                <div className="meta" style={{ marginTop: 4 }}>
                  {updateProgress == null ? t('set.downloadingUpdate') : `${t('set.downloadingUpdate')} ${updateProgress}%`}
                </div>
              </div>
            )}
            {updateStatus === 'error' && (
              <div style={{ marginTop: 8 }}>
                <div className="field-error" role="alert">{updateError ?? t('set.updateFailed')}</div>
                <div className="meta">{t('set.pkgNote')}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="pill-btn outlined" onClick={() => void openReleasesPage()}>{t('set.openReleases')}</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="meta">{t('set.webNote')}</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="pill-btn tonal" onClick={() => void openReleasesPage()}>{t('set.openReleases')}</button>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <h2>{t('set.downloads')}</h2>
        <div className="meta">{settings.outDir ? t('set.folder', { dir: settings.outDir }) : t('set.noFolder')}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal" onClick={chooseFolder}>{t('set.choose')}</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Switch
            checked={settings.splitKinds}
            onChange={() => update({ splitKinds: !settings.splitKinds })}
            label={t('set.split')}
          />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="meta" id="concurrency-label">{t('set.maxConc')}</span>
          <div className="stepper-num" role="group" aria-labelledby="concurrency-label">
            <button aria-label={t('set.fewer')} title={t('set.fewer')} onClick={() => update({ maxConcurrent: Math.max(1, settings.maxConcurrent - 1) })}>−</button>
            <output aria-live="polite" aria-label={t('set.concCount', { n: settings.maxConcurrent })}>{settings.maxConcurrent}</output>
            <button aria-label={t('set.more')} title={t('set.more')} onClick={() => update({ maxConcurrent: Math.min(8, settings.maxConcurrent + 1) })}>+</button>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>{t('set.defaultDl')}</h2>
        <p className="meta">{t('set.defaultHint')}</p>
        <PreferenceFields
          value={settings.downloadDefaults}
          onChange={(p) => update({ downloadDefaults: { ...settings.downloadDefaults, ...p } })}
          qualities={[...QUALITIES].reverse()}
          desktop={isTauri()}
          advanced
        />
      </div>
      <div className="card">
        <h2>{t('set.appearance')}</h2>
        <div className="segmented" role="group" aria-label={t('set.theme')}>
          {(['light', 'dark', 'auto'] as const).map((td) => (
            <button key={td} aria-pressed={settings.theme === td} onClick={() => update({ theme: td })}>
              {td === 'light' ? t('set.light') : td === 'dark' ? t('set.dark') : t('set.auto')}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label={t('set.themeColor')} style={{ marginTop: 12 }}>
          {SEEDS.map((s) => (
            <button
              key={s.name}
              className="chip tonal swatch"
              aria-pressed={settings.seed.toLowerCase() === s.seed.toLowerCase()}
              aria-label={t('set.colorName', { name: s.name })}
              onClick={() => update({ seed: s.seed })}
            >
              <span className="dot" style={{ background: s.seed }} aria-hidden="true" />
              {s.name}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={t('set.themeStyle')} style={{ marginTop: 12 }}>
          {VARIANTS.map((v) => (
            <button key={v.id} aria-pressed={settings.variant === v.id} onClick={() => update({ variant: v.id })}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>{t('set.language')}</h2>
        <div className="segmented" role="group" aria-label={t('set.language')}>
          {(['auto', 'en', 'es'] as const).map((l) => (
            <button key={l} aria-pressed={settings.locale === l} onClick={() => update({ locale: l })}>
              {l === 'auto' ? t('set.system') : l === 'en' ? 'English' : 'Español'}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>{t('set.diagnostics')}</h2>
        <div className="row">
          <button className="pill-btn tonal" onClick={copyLog}>{t('set.copyLog')}</button>
          <button className="pill-btn tonal" onClick={() => void saveLog()}>{t('set.saveLog')}</button>
          <button className="pill-btn outlined" onClick={showLog}>{t('set.viewLog')}</button>
        </div>
        {log && <pre className="log-view">{log.slice(-60).join('\n') || t('set.emptyLog')}</pre>}
      </div>
      <div className="card">
        <h2>{t('set.credits')}</h2>
        <p className="meta">{t('set.creditsBody')}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {CREATOR_LINKS.map((l) => (
            <button
              key={l.id}
              className="pill-btn tonal"
              onClick={() => void openExternal(l.url).catch((e) => {
                console.error('[KouTube] open social failed', l.id, e);
                setNote(t('set.linkFail', { msg: e instanceof Error ? e.message : String(e) }));
              })}
              aria-label={t('set.opensInBrowser', { label: l.label })}
              title={l.label}
            >
              <Icon d={PATHS[l.id]} size={18} fill />
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>{t('set.legal')}</h2>
        <p className="meta">
          {t('set.legalBody')}
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn outlined" onClick={() => void openTerms().catch((e) => {
            console.error('[KouTube] open terms failed', e);
            setNote(t('set.linkFail', { msg: e instanceof Error ? e.message : String(e) }));
          })}>
            {t('set.terms')}
          </button>
        </div>
      </div>
      {note && <div className="meta" role="note">{note}</div>}
      <Footer />
    </>
  );
}
