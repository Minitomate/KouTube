import { useLocale } from '../lib/store';
import { useLinkInput } from '../lib/linkInput';
import { Icon, PATHS } from './icons';

export default function UrlBar() {
  const { t } = useLocale();
  const { draft, setDraft, error, loading, inspect, paste, clear } = useLinkInput();

  return (
    <div className="card urlbar-card">
      <h2>{t('urlbar.heading')}</h2>
      <div className="urlbar">
        <label className="sr" htmlFor="url">{t('urlbar.label')}</label>
        <input
          id="url"
          placeholder="https://youtube.com/…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button type="button" className="pill-btn tonal icon-btn" onClick={clear} disabled={!draft} aria-label={t('urlbar.clear')} title={t('urlbar.clear')}>
          <Icon d={PATHS.clear} />
        </button>
        <button type="button" className="pill-btn tonal icon-btn" onClick={() => void paste()} aria-label={t('urlbar.paste')} title={t('urlbar.paste')}>
          <Icon d={PATHS.paste} />
        </button>
        <button
          type="button"
          className="pill-btn filled icon-btn"
          onClick={() => void inspect()}
          disabled={loading}
          aria-label={t('urlbar.inspect')}
          title={t('urlbar.inspect')}
          aria-busy={loading}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : <Icon d={PATHS.inspect} />}
        </button>
      </div>
      <div className="field-error" role="alert">{error}</div>
    </div>
  );
}
