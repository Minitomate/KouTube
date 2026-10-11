import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { loadSettings, saveSettings, SEEDS, VARIANTS, type Settings } from '../lib/settings';
import { QUALITIES } from '../lib/store';
import { isTauri, pickFolder, getRecentLogs } from '../lib/desktop';
import PreferenceFields from '../components/PreferenceFields';

export default function Settings() {
  const { set, queue } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [note, setNote] = useState('');
  const [log, setLog] = useState<string[] | null>(null);

  useEffect(() => {
    loadSettings().then(({ settings: s, reset }) => {
      setSettings(s);
      set({ theme: s.theme, seed: s.seed });
      if (reset) setNote('Settings were corrupt — reset to defaults.');
    });
  }, [set]);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
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
      const lines: string[] = [];
      for (const q of queue) {
        lines.push(`## ${q.title} [${q.status}/${q.stage}]`);
        for (const l of q.log ?? []) lines.push(`  ${l}`);
        if (q.error) lines.push(`  error: ${q.error}`);
      }
      if (isTauri()) {
        try {
          const recent = await getRecentLogs();
          lines.push('## backend recent');
          for (const l of recent.slice(-60)) lines.push(`  ${l}`);
        } catch { /* frontend log alone still helps */ }
      }
      await navigator.clipboard.writeText(lines.join('\n') || '(empty log)');
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
        <h2>Downloads</h2>
        <div className="meta">{settings.outDir ? `Folder: ${settings.outDir}` : 'No folder chosen yet.'}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal" onClick={chooseFolder}>Choose folder</button>
        </div>
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={settings.splitKinds}
            onChange={(e) => update({ splitKinds: e.target.checked })}
          />
          Separate audio and video into Audio/ and Video/ subfolders
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="meta" id="concurrency-label">Max concurrent downloads</span>
          <div className="segmented" role="group" aria-labelledby="concurrency-label">
            <button aria-label="Fewer concurrent downloads" onClick={() => update({ maxConcurrent: Math.max(1, settings.maxConcurrent - 1) })}>−</button>
            <button aria-label="More concurrent downloads" onClick={() => update({ maxConcurrent: Math.min(8, settings.maxConcurrent + 1) })}>+</button>
          </div>
          <span className="meta" aria-live="polite" aria-label={`${settings.maxConcurrent} concurrent downloads`}>{settings.maxConcurrent}</span>
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
      {note && <div className="meta" role="note">{note}</div>}
    </>
  );
}
