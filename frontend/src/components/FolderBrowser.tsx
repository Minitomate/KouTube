import { useEffect, useState } from 'react';
import { useLocale } from '../lib/store';
import { androidListDirs } from '../lib/desktop';

interface Props {
  start: string;
  onPick: (path: string) => void;
  onCancel: () => void;
}

/** Parent of a shared-storage path; null at the /storage volume list. */
export function parentOf(path: string): string | null {
  const clean = path.replace(/\/+$/, '');
  if (clean === '/storage') return null;
  const i = clean.lastIndexOf('/');
  if (i <= 0) return null;
  const parent = clean.slice(0, i);
  return parent.length < '/storage'.length ? null : parent;
}

/** Minimal folder browser: java.io.File scoping needs no SAF tree grant. */
export default function FolderBrowser({ start, onPick, onCancel }: Props) {
  const { t } = useLocale();
  const [path, setPath] = useState(start);
  const [dirs, setDirs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError('');
    androidListDirs(path)
      .then((r) => {
        if (dead) return;
        setDirs(r.dirs);
        if (r.path !== path) setPath(r.path);
      })
      .catch((e) => {
        if (dead) return;
        setDirs([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => { dead = true; };
  }, [path]);

  const up = parentOf(path);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="card modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('browser.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t('browser.title')}</h2>
        <div className="meta" style={{ wordBreak: 'break-all' }}>{path}</div>
        <div className="row" style={{ marginTop: 8 }}>
          {up && (
            <button className="pill-btn outlined" onClick={() => setPath(up)}>
              {t('browser.up')}
            </button>
          )}
        </div>
        <div style={{ marginTop: 8, maxHeight: '45vh', overflowY: 'auto' }}>
          {loading && <p className="meta">{t('browser.loading')}</p>}
          {!loading && error && <p className="field-error" role="alert">{error}</p>}
          {!loading && !error && dirs.length === 0 && <p className="meta">{t('browser.empty')}</p>}
          {dirs.map((d) => (
            <button
              key={d}
              className="pill-btn tonal"
              style={{ width: '100%', marginBottom: 6, justifyContent: 'flex-start' }}
              onClick={() => setPath(d)}
            >
              {d.split('/').pop()}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="pill-btn filled" onClick={() => onPick(path)} disabled={loading || !!error}>
            {t('browser.use')}
          </button>
          <button className="pill-btn text" onClick={onCancel}>{t('browser.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
