import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  /** Idle/queue CTA text; ctaLabel carries batch progress while busy. */
  downloadLabel: string;
  downloadDisabled: boolean;
  /** Current inspected URL is already active/queued in this batch. */
  queued: boolean;
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
  error, busy, canCancel, ctaBusy, ctaPct, ctaLabel, downloadLabel, downloadDisabled, queued, onDownload, onCancel,
}: Props) {
  const { t } = useLocale();
  const { url, media } = useStore();
  const { draft, setDraft, error: linkError, loading, inspect, paste, clear } = useLinkInput();
  const inset = useKeyboardInset();
  const action = linkDockAction({ draft, url, hasMedia: media != null });
  const message = linkError || error;
  const [inspectOpen, setInspectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout>>();
  const label = action === 'download'
    ? (busy && queued ? t('dock.queued') : downloadLabel)
    : t('urlbar.inspectShort');
  const disabled = loading || !draft.trim() || (action === 'download' && (downloadDisabled || queued || submitting));
  const style = { bottom: `calc(12px + env(safe-area-inset-bottom, 0px) + ${inset}px)` };

  useEffect(() => () => {
    if (submitTimer.current) clearTimeout(submitTimer.current);
  }, []);

  // A new batch starts from the idle form: collapse to progress and hide the
  // keyboard. Queueing while already busy leaves the inspect panel open.
  useEffect(() => {
    if (!busy) return;
    inputRef.current?.blur();
    setInspectOpen(false);
  }, [busy]);

  // Focus on expand so the keyboard opens with the field.
  useEffect(() => {
    if (!busy || !inspectOpen) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [busy, inspectOpen]);

  // Tap anywhere outside the dock to collapse it and dismiss the keyboard.
  useEffect(() => {
    if (!busy || !inspectOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      inputRef.current?.blur();
      setInspectOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [busy, inspectOpen]);

  // The global Paste & Inspect entry point must reveal the field it fills.
  useEffect(() => {
    if (!busy) return;
    const open = () => setInspectOpen(true);
    window.addEventListener('koutube:paste-inspect', open);
    return () => window.removeEventListener('koutube:paste-inspect', open);
  }, [busy]);

  function changeDraft(value: string) {
    setDraft(value);
    setSubmitting(false);
  }

  function toggleInspect() {
    if (inspectOpen) {
      inputRef.current?.blur();
      setInspectOpen(false);
    } else {
      setInspectOpen(true);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    if (action === 'download') {
      // Preflight is async and does not flip `busy` immediately; lock the
      // button so a double tap cannot enqueue the same video twice.
      setSubmitting(true);
      if (submitTimer.current) clearTimeout(submitTimer.current);
      submitTimer.current = setTimeout(() => setSubmitting(false), 1500);
      onDownload();
    } else {
      void inspect();
    }
  }

  const progressLabel = ctaBusy ? ctaLabel : t('transfer.preparing');

  return (
    <div className="link-dock" ref={rootRef} style={style}>
      {message && <div className="dock-error" role="alert">{message}</div>}
      <div className={`dock-surface${busy ? ' dock-busy' : ''}${busy && inspectOpen ? ' dock-expanded' : ''}`}>
        {busy && (
          <div className="dock-busy-top">
            <div
              className="pill-btn filled cta-progress dock-progress"
              role="progressbar"
              aria-live="polite"
              aria-atomic="true"
              aria-label={progressLabel}
              aria-valuemin={ctaBusy ? 0 : undefined}
              aria-valuemax={ctaBusy ? 100 : undefined}
              aria-valuenow={ctaBusy ? ctaPct : undefined}
            >
              {ctaBusy && <span className="cta-fill" style={{ width: `${ctaPct}%` }} aria-hidden="true" />}
              {!ctaBusy && <span className="spinner" aria-hidden="true" />}
              <span className="cta-label">{progressLabel}</span>
            </div>
            <button
              type="button"
              className="pill-btn tonal dock-toggle"
              onClick={toggleInspect}
              aria-expanded={inspectOpen}
              aria-controls="dock-inspect-panel"
              aria-label={inspectOpen ? t('dock.closeInspect') : t('dock.inspectAnother')}
              title={inspectOpen ? t('dock.closeInspect') : t('dock.inspectAnother')}
            >
              <span className="dock-toggle-icon dock-toggle-inspect"><Icon d={PATHS.inspect} /></span>
              <span className="dock-toggle-icon dock-toggle-close"><Icon d={PATHS.clear} /></span>
            </button>
            {canCancel && (
              <button type="button" className="pill-btn outlined dock-cancel" onClick={onCancel} aria-label={t('home.cancelDownload')}>
                {t('home.cancel')}
              </button>
            )}
          </div>
        )}
        <div
          id="dock-inspect-panel"
          className="dock-panel"
          aria-hidden={busy && !inspectOpen}
        >
          <form className="dock-form" onSubmit={submit}>
            <div className="dock-field">
              <label className="sr" htmlFor="url">{t('urlbar.label')}</label>
              <input
                ref={inputRef}
                id="url"
                className={draft ? 'has-clear' : undefined}
                placeholder="https://youtube.com/…"
                value={draft}
                onChange={(e) => changeDraft(e.target.value)}
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
              aria-label={label}
              aria-busy={loading || submitting}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : <Icon d={action === 'download' ? PATHS.download : PATHS.inspect} />}
              <span className="dock-cta-label">{label}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
