import { useEffect, useRef, useState } from 'react';
import { useStore, useLocale } from '../lib/store';
import TransferCard from './TransferCard';

interface Props {
  onRemove: (id: string) => void;
  onClearFinished: () => void;
  onCancelAll: () => void;
}

const TERMINAL = ['done', 'error', 'cancelled'];
/** Fallback row height for never-measured rows. */
const FALLBACK_H = 170;
const OVERSCAN = 4;

/** Batch view: per-file user-end transfers (no server jobs). */
export default function QueueView({ onRemove, onClearFinished, onCancelAll }: Props) {
  const { queue, media } = useStore();
  const { t } = useLocale();
  const active = queue.filter((q) => !TERMINAL.includes(q.status));
  const finished = queue.filter((q) => TERMINAL.includes(q.status));
  // Windowing with per-row measured heights: a single estimate undershoots
  // the tall rows and cuts the scroll range short, so each rendered card is
  // measured (ResizeObserver) and spacers sum real heights + fallback.
  const listRef = useRef<HTMLDivElement | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const elsRef = useRef(new Map<string, Element>());
  const roRef = useRef<ResizeObserver | null>(null);
  const [, setMeasTick] = useState(0);
  const [win, setWin] = useState({ start: 0, end: 25 });
  if (!roRef.current && typeof ResizeObserver !== 'undefined') {
    roRef.current = new ResizeObserver((es) => {
      let changed = false;
      for (const en of es) {
        const id = (en.target as HTMLElement).dataset.tid;
        const h = Math.ceil(en.contentRect.height);
        if (!id || h <= 0) continue;
        const prev = heightsRef.current.get(id);
        if (prev === undefined || Math.abs(prev - h) > 4) {
          heightsRef.current.set(id, h);
          changed = true;
        }
      }
      if (changed) setMeasTick((n) => n + 1);
    });
  }
  useEffect(() => {
    const ro = roRef.current;
    const els = elsRef.current;
    return () => {
      ro?.disconnect();
      els.clear();
    };
  }, []);
  const heightOf = (id: string) => heightsRef.current.get(id) ?? FALLBACK_H;
  const n = queue.length;
  const offs: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offs[i] = acc;
    acc += heightOf(queue[i].id);
  }
  const totalH = acc;
  const updateWin = () => {
    const el = listRef.current;
    if (!el) return;
    const st = el.scrollTop;
    const vh = el.clientHeight || 600;
    let start = 0;
    while (start < n && offs[start] + heightOf(queue[start].id) <= st) start++;
    start = Math.max(0, start - OVERSCAN);
    let end = start;
    while (end < n && offs[end] < st + vh) end++;
    end = Math.min(n, end + OVERSCAN);
    setWin((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };
  const observeRow = (id: string) => (el: HTMLDivElement | null) => {
    const ro = roRef.current;
    if (!ro) return;
    const prev = elsRef.current.get(id);
    if (prev) ro.unobserve(prev);
    if (el) {
      ro.observe(el);
      elsRef.current.set(id, el);
    } else {
      elsRef.current.delete(id);
    }
  };
  useEffect(() => {
    // Prune measurements for removed rows so spacers never go stale.
    const live = new Set(queue.map((q) => q.id));
    for (const id of heightsRef.current.keys()) {
      if (!live.has(id)) heightsRef.current.delete(id);
    }
    updateWin();
  }, [queue.length]);
  const clampedStart = Math.min(win.start, n);
  const topH = clampedStart >= n ? totalH : offs[clampedStart];
  const lastIdx = Math.min(win.end, n) - 1;
  const endOff = lastIdx >= 0 ? offs[lastIdx] + heightOf(queue[lastIdx].id) : 0;
  return (
    <div className="card queue-grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {media?.isPlaylist
            ? t('queue.titlePlaylist', { shown: media.playlistCount ?? queue.length, n: active.length })
            : t('queue.titleDl', { n: active.length })}
        </h2>
        <div className="row">
          {finished.length > 0 && (
            <button className="pill-btn text" style={{ minHeight: 36 }} onClick={onClearFinished}>
              {t('queue.clear')}
            </button>
          )}
          {active.length > 0 && (
            <button className="pill-btn text" style={{ minHeight: 36 }} onClick={onCancelAll}>
              {t('queue.cancelAll')}
            </button>
          )}
        </div>
      </div>
      {media?.isPlaylist && queue.length === 0 && (
        <p className="empty">{t('queue.emptyPlaylist')}</p>
      )}
      {!media?.isPlaylist && queue.length === 0 && (
        <p className="empty">{t('queue.empty')}</p>
      )}
      <div ref={listRef} className="queue-cards" onScroll={updateWin}>
        {clampedStart > 0 && <div style={{ height: topH }} aria-hidden="true" />}
        {queue.slice(clampedStart, win.end).map((j) => (
          <div key={j.id} data-tid={j.id} ref={observeRow(j.id)}>
            <TransferCard transferId={j.id} onRemove={onRemove} />
          </div>
        ))}
        {win.end < queue.length && <div style={{ height: Math.max(0, totalH - endOff) }} aria-hidden="true" />}
      </div>
    </div>
  );
}
