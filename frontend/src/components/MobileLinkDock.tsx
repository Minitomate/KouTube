import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useStore } from '../lib/store';
import { useLinkInput } from '../lib/linkInput';
import { linkDockAction } from '../lib/linkDock';
import { Icon, PATHS } from './icons';

interface Props {
  /** Download-level error; URL errors come from the link field itself. */
  error: string;
  busy: boolean;
  canCancel: boolean;
  ctaBusy: boolean;
  ctaPct: number;
  ctaLabel: string;
  downloadDisabled: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

/** Keep the fixed dock above the Android keyboard, whether it resizes or
 *  overlays the layout viewport. No-op where visualViewport is unavailable. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        setInset((prev) => (prev === next ? prev : next));
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return inset;
}

/** Android-only bottom link + download dock. */
export default function MobileLinkDock({
  error, busy, canCancel, ctaBusy, ctaPct, ctaLabel, downloadDisabled, onDownload, onCancel,
}: Props) {
  const { t } = useLocale();
  const { url, media } = useStore();
  const { draft, setDraft, error: linkError, loading, inspect, paste, clear } = useLinkInput();
  const inset = useKeyboardInset();
  const action = linkDockAction({ draft, url, hasMedia: media != null, busy });
  const message = linkError || error;
  const disabled = loading || !draft.trim() || (action === 'download' && downloadDisabled);
  const style = { bottom: `calc(12px + env(safe-area-inset-bottom, 0px) + ${inset}px)` };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    if (action === 'download') onDownload();
    else void inspect();
  }

  const progressLabel = ctaBusy ? ctaLabel : t('transfer.preparing');

  return (
    <div className="link-dock" style={style}>
      {message && <div className="dock-error" role="alert">{message}</div>}
      {busy ? (
        <div className="dock-surface dock-busy" aria-live="polite">
          <div
            className="pill-btn filled cta-progress dock-progress"
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={ctaBusy ? 0 : undefined}
            aria-valuemax={ctaBusy ? 100 : undefined}
            aria-valuenow={ctaBusy ? ctaPct : undefined}
          >
            {ctaBusy && <span className="cta-fill" style={{ width: `${ctaPct}%` }} aria-hidden="true" />}
            {!ctaBusy && <span className="spinner" aria-hidden="true" />}
            <span className="cta-label">{progressLabel}</span>
          </div>
          {canCancel && (
            <button type="button" className="pill-btn outlined dock-cancel" onClick={onCancel} aria-label={t('home.cancelDownload')}>
              {t('home.cancel')}
            </button>
          )}
        </div>
      ) : (
        <form className="dock-surface" onSubmit={submit}>
          <div className="dock-field">
            <label className="sr" htmlFor="url">{t('urlbar.label')}</label>
            <input
              id="url"
              className={draft ? 'has-clear' : undefined}
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
            {draft && (
              <button
                type="button"
                className="dock-icon dock-clear"
                onClick={clear}
                disabled={loading}
                aria-label={t('urlbar.clear')}
                title={t('urlbar.clear')}
              >
                <Icon d={PATHS.clear} />
              </button>
            )}
            <button
              type="button"
              className="dock-icon dock-paste"
              onClick={() => void paste()}
              disabled={loading}
              aria-label={t('urlbar.paste')}
              title={t('urlbar.paste')}
            >
              <Icon d={PATHS.paste} />
            </button>
          </div>
          <button
            type="submit"
            className="pill-btn filled dock-cta"
            disabled={disabled}
            aria-label={action === 'download' ? ctaLabel : t('urlbar.inspect')}
            aria-busy={loading}
          >
            {loading ? <span className="spinner" aria-hidden="true" /> : <Icon d={action === 'download' ? PATHS.download : PATHS.inspect} />}
            <span className="dock-cta-label">{action === 'download' ? ctaLabel : t('urlbar.inspectShort')}</span>
          </button>
        </form>
      )}
    </div>
  );
}
