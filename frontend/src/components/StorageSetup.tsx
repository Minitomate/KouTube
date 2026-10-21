import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../lib/store';
import { loadSettings, patchSettings, type Settings } from '../lib/settings';
import {
  androidStorageInfo,
  checkOutDir,
  requestAndroidStorage,
  type AndroidStorageInfo,
} from '../lib/desktop';
import FolderBrowser from './FolderBrowser';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (next: Settings) => void;
}

type Choice = 'public' | 'app' | 'custom';

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** First-run / Settings storage picker. Public Download/KouTube needs All-files
 *  access; the app folder never does. Custom folders are write-probed. */
export default function StorageSetup({ open, onClose, onSaved }: Props) {
  const { t } = useLocale();
  const [info, setInfo] = useState<AndroidStorageInfo | null>(null);
  const [current, setCurrent] = useState<Settings | null>(null);
  const [choice, setChoice] = useState<Choice>('public');
  const [custom, setCustom] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const initialised = useRef(false);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    initialised.current = false;
    setError('');
    setBrowsing(false);
    const poll = () => {
      androidStorageInfo()
        .then((i) => { if (!dead) setInfo(i); })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 800);
    loadSettings()
      .then(({ settings }) => { if (!dead) setCurrent(settings); })
      .catch(() => {});
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !info || !current || initialised.current) return;
    initialised.current = true;
    const dir = current.outDir ?? '';
    if (dir.startsWith(info.appDir)) {
      setChoice('app');
    } else if (dir.startsWith(info.publicDir)) {
      setChoice('public');
    } else if (dir) {
      setChoice('custom');
      setCustom(dir);
    }
  }, [open, info, current]);

  if (!open) return null;

  const publicPath = info ? `${info.publicDir.replace(/\/+$/, '')}/KouTube` : '';
  const blocked = choice === 'public' && !info?.granted;

  async function grant() {
    setAsking(true);
    setError('');
    try {
      await requestAndroidStorage();
    } catch (e) {
      setError(reason(e));
    } finally {
      setAsking(false);
    }
  }

  async function save() {
    const path = choice === 'public' ? publicPath : choice === 'app' ? info?.appDir ?? '' : custom;
    if (!path) return;
    setBusy(true);
    setError('');
    try {
      const canonical = await checkOutDir(path);
      onSaved(await patchSettings({ outDir: canonical, androidStorageChosen: true }));
    } catch (e) {
      setError(t('storage.invalid', { msg: reason(e) }));
    } finally {
      setBusy(false);
    }
  }

  const pick = (next: Choice) => () => setChoice(next);

  return (
    <>
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="card modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('storage.title')}
          onClick={(e) => e.stopPropagation()}
        >
          <h2>{t('storage.title')}</h2>
          <p className="meta">{t('storage.body')}</p>
          {!info && <p className="meta">{t('set.loading')}</p>}
          {info && (
            <div className="storage-options" role="radiogroup" aria-label={t('storage.title')}>
              <div
                className="storage-option"
                role="radio"
                aria-checked={choice === 'public'}
                tabIndex={0}
                onClick={pick('public')}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setChoice('public'); }}
              >
                <strong>{t('storage.public')}</strong>
                <span className="meta">{t('storage.publicDesc')}</span>
                {choice === 'public' && !info.granted && (
                  <>
                    <button
                      className="pill-btn tonal"
                      onClick={(e) => { e.stopPropagation(); void grant(); }}
                      disabled={asking}
                    >
                      {asking ? t('set.loading') : t('storage.grant')}
                    </button>
                    <span className="meta">{t('storage.grantHint')}</span>
                  </>
                )}
              </div>
              <div
                className="storage-option"
                role="radio"
                aria-checked={choice === 'app'}
                tabIndex={0}
                onClick={pick('app')}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setChoice('app'); }}
              >
                <strong>{t('storage.app')}</strong>
                <span className="meta">{t('storage.appDesc')}</span>
              </div>
              <div
                className="storage-option"
                role="radio"
                aria-checked={choice === 'custom'}
                tabIndex={0}
                onClick={pick('custom')}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setChoice('custom'); }}
              >
                <strong>{t('storage.custom')}</strong>
                <span className="meta">{t('storage.customDesc')}</span>
                {choice === 'custom' && (
                  <>
                    <button
                      className="pill-btn outlined"
                      onClick={(e) => { e.stopPropagation(); setBrowsing(true); }}
                    >
                      {t('storage.browse')}
                    </button>
                    {custom && <span className="meta">{t('storage.selected', { dir: custom })}</span>}
                  </>
                )}
              </div>
            </div>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="pill-btn filled"
              onClick={() => void save()}
              disabled={!info || busy || blocked || (choice === 'custom' && !custom)}
            >
              {busy ? t('set.loading') : t('storage.use')}
            </button>
            <button className="pill-btn text" onClick={onClose}>{t('storage.cancel')}</button>
          </div>
        </div>
      </div>
      {browsing && info && (
        <FolderBrowser
          start={custom || info.publicDir}
          onPick={(path) => { setCustom(path); setChoice('custom'); setBrowsing(false); }}
          onCancel={() => setBrowsing(false)}
        />
      )}
    </>
  );
}
