import { useStore, useLocale } from '../lib/store';
import TransferCard from './TransferCard';

interface Props {
  onRemove: (id: string) => void;
  onClearFinished: () => void;
  onCancelAll: () => void;
}

const TERMINAL = ['done', 'error', 'cancelled'];

/** Batch view: per-file user-end transfers (no server jobs). */
export default function QueueView({ onRemove, onClearFinished, onCancelAll }: Props) {
  const { queue, media } = useStore();
  const { t } = useLocale();
  const active = queue.filter((q) => !TERMINAL.includes(q.status));
  const finished = queue.filter((q) => TERMINAL.includes(q.status));
  return (
    <div className="card queue-grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {media?.isPlaylist
            ? t('queue.titlePlaylist', { shown: Math.min(media.playlistCount ?? queue.length, 10), n: active.length })
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
      <div className="queue-cards">
        {queue.map((j) => <TransferCard key={j.id} transferId={j.id} onRemove={onRemove} />)}
      </div>
    </div>
  );
}
