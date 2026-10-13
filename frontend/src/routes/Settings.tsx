import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { loadSettings, patchSettings, SEEDS, VARIANTS, type Settings } from '../lib/settings';
import { copyDebugLog } from '../lib/debug';
import { QUALITIES } from '../lib/store';
import { isTauri, pickFolder, getRecentLogs, openTerms, openExternal, CREATOR_LINKS } from '../lib/desktop';
import { Icon, PATHS } from '../components/icons';
import Footer from '../components/Footer';
import { runUpdateCheck, runUpdateDownload, relaunchApp, openReleasesPage, getAppVersion, formatReleaseDate } from '../lib/updater';
import PreferenceFields from '../components/PreferenceFields';
import Switch from '../components/Switch';

export default function Settings() {
  const { set, updateStatus, updateVersion, updateNotes, updatePubDate, updateProgress, updateError } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [note, setNote] = useState('');
  const [log, setLog] = useState<string[] | null>(null);
  const [appVersion, setAppVersion] = useState('…');

  useEffect(() => {
    if (isTauri()) getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
  }, []);

  async function manualCheck() {
    await runUpdateCheck();
    try {
      const { settings: s } = await loadSettings();
      setSettings(s);
    } catch { /* stamp display is best-effort */ }
  }

  useEffect(() => {
    loadSettings().then(({ settings: s, reset }) => {
      setSettings(s);
      set({ theme: s.theme, seed: s.seed });
      if (reset) setNote('Settings were corrupt — reset to defaults.');
    });
  }, [set]);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = await patchSettings(patch);
    setSettings(next);
    if (patch.theme) set({ theme: patch.theme });
    if (patch.seed) set({ seed: patch.seed });
    if (patch.variant) set({ variant: patch.variant });
  }

  async function chooseFolder() {
    if (!isTauri()) {
      setNote('Folder picking needs the desktop app.');
      return;
    }
    const picked = await pickFolder().catch(() => null);
    if (picked && !Array.isArray(picked)) {
      await update({ outDir: picked });
      setNote(`Download folder: ${picked}`);
    }
  }

  async function copyLog() {
    try {
      await copyDebugLog();
      setNote('Debug log copied.');
    } catch {
      setNote('Could not copy the debug log.');
    }
  }

  async function showLog() {
    if (!isTauri()) {
      setLog(['Backend log is only available in the desktop app.']);
      return;
    }
    try {
      setLog(await getRecentLogs());
    } catch {
      setLog(['Could not read the backend log.']);
    }
  }

  if (!settings) return <div className="card"><p className="empty">Loading settings…</p></div>;

  return (
    <>
      <div className="card">
        <h2>Updates</h2>
        {isTauri() ? (
          <>
            <div className="meta">
              Current version: {appVersion}
              {settings.lastUpdateCheck
                ? ` · Last checked: ${new Date(settings.lastUpdateCheck).toLocaleString()}`
                : ' · Never checked'}
            </div>
            <div style={{ marginTop: 8 }}>
              <Switch
                checked={settings.autoUpdateCheck}
                onChange={() => update({ autoUpdateCheck: !settings.autoUpdateCheck })}
                label="Check for updates automatically (once a day on launch)"
              />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="pill-btn tonal"
                onClick={() => void manualCheck()}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              >
                {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {updateStatus === 'available' && (
                <button className="pill-btn filled" onClick={() => void runUpdateDownload()}>
                  Download & install {updateVersion}
                </button>
              )}
              {updateStatus === 'ready' && (
                <button className="pill-btn filled" onClick={() => void relaunchApp()}>Restart now</button>
              )}
            </div>
            {updateStatus === 'uptodate' && <div className="meta" style={{ marginTop: 8 }}>You're up to date.</div>}
            {updateStatus === 'ready' && (
              <div className="meta" style={{ marginTop: 8 }}>KouTube {updateVersion} is installed — restart to run it.</div>
            )}
            {updateStatus === 'available' && formatReleaseDate(updatePubDate) && (
              <div className="meta" style={{ marginTop: 8 }}>Released {formatReleaseDate(updatePubDate)}.</div>
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
                  {updateProgress == null ? 'Downloading update…' : `Downloading update… ${updateProgress}%`}
                </div>
              </div>
            )}
            {updateStatus === 'error' && (
              <div style={{ marginTop: 8 }}>
                <div className="field-error" role="alert">{updateError ?? 'Update failed.'}</div>
                <div className="meta">Self-update isn't supported by every package type (e.g. deb/rpm) — grab it from the releases page instead.</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="pill-btn outlined" onClick={() => void openReleasesPage()}>Open releases page</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="meta">Automatic updates live in the desktop app. Grab new versions from the releases page.</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="pill-btn tonal" onClick={() => void openReleasesPage()}>Open releases page</button>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <h2>Downloads</h2>
        <div className="meta">{settings.outDir ? `Folder: ${settings.outDir}` : 'No folder chosen yet.'}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal" onClick={chooseFolder}>Choose folder</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Switch
            checked={settings.splitKinds}
            onChange={() => update({ splitKinds: !settings.splitKinds })}
            label="Separate audio and video into Audio/ and Video/ subfolders"
          />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="meta" id="concurrency-label">Max concurrent downloads</span>
          <div className="stepper-num" role="group" aria-labelledby="concurrency-label">
            <button aria-label="Fewer concurrent downloads" title="Fewer concurrent downloads" onClick={() => update({ maxConcurrent: Math.max(1, settings.maxConcurrent - 1) })}>−</button>
            <output aria-live="polite" aria-label={`${settings.maxConcurrent} concurrent downloads`}>{settings.maxConcurrent}</output>
            <button aria-label="More concurrent downloads" title="More concurrent downloads" onClick={() => update({ maxConcurrent: Math.min(8, settings.maxConcurrent + 1) })}>+</button>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Default download</h2>
        <p className="meta">Applied to the options card on every Inspect.</p>
        <PreferenceFields
          value={settings.downloadDefaults}
          onChange={(p) => update({ downloadDefaults: { ...settings.downloadDefaults, ...p } })}
          qualities={[...QUALITIES].reverse()}
          desktop={isTauri()}
          advanced
        />
      </div>
      <div className="card">
        <h2>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {(['light', 'dark', 'auto'] as const).map((t) => (
            <button key={t} aria-pressed={settings.theme === t} onClick={() => update({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Theme color" style={{ marginTop: 12 }}>
          {SEEDS.map((s) => (
            <button
              key={s.name}
              className="chip tonal swatch"
              aria-pressed={settings.seed.toLowerCase() === s.seed.toLowerCase()}
              aria-label={`Theme color ${s.name}`}
              onClick={() => update({ seed: s.seed })}
            >
              <span className="dot" style={{ background: s.seed }} aria-hidden="true" />
              {s.name}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Theme style" style={{ marginTop: 12 }}>
          {VARIANTS.map((v) => (
            <button key={v.id} aria-pressed={settings.variant === v.id} onClick={() => update({ variant: v.id })}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Diagnostics</h2>
        <div className="row">
          <button className="pill-btn tonal" onClick={copyLog}>Copy debug log</button>
          <button className="pill-btn outlined" onClick={showLog}>View backend log</button>
        </div>
        {log && <pre className="log-view">{log.slice(-60).join('\n') || '(empty)'}</pre>}
      </div>
      <div className="card">
        <h2>Credits</h2>
        <p className="meta">KouTube is made by Minitomate. Follow along or get support on any of these:</p>
        <div className="row" style={{ marginTop: 8 }}>
          {CREATOR_LINKS.map((l) => (
            <button
              key={l.id}
              className="pill-btn tonal"
              onClick={() => void openExternal(l.url).catch((e) => {
                console.error('[KouTube] open social failed', l.id, e);
                setNote(`Could not open the link: ${e instanceof Error ? e.message : String(e)}`);
              })}
              aria-label={`${l.label} (opens in browser)`}
              title={l.label}
            >
              <Icon d={PATHS[l.id]} size={18} fill />
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Legal</h2>
        <p className="meta">
          KouTube is for personal, lawful use. Download only videos you own or
          that permit offline use, respect creators' rights, and comply with
          YouTube's Terms of Service. Not affiliated with or endorsed by
          YouTube or Google.
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn outlined" onClick={() => void openTerms().catch((e) => {
            console.error('[KouTube] open terms failed', e);
            setNote(`Could not open the link: ${e instanceof Error ? e.message : String(e)}`);
          })}>
            YouTube Terms
          </button>
        </div>
      </div>
      {note && <div className="meta" role="note">{note}</div>}
      <Footer />
    </>
  );
}
