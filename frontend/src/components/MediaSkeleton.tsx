/** Skeleton shown while resolve is in flight (first + re-inspect). */
import { useLocale } from '../lib/store';

export default function MediaSkeleton() {
  const { t } = useLocale();
  return (
    <div className="card" role="status" aria-label={t('sk.loading')}>
      <div className="sk sk-thumb" />
      <div className="sk sk-line" style={{ width: '80%' }} />
      <div className="sk sk-line" style={{ width: '55%' }} />
      <div className="sk-row">
        <div className="sk sk-avatar" />
        <div className="sk sk-line" style={{ width: '40%' }} />
      </div>
    </div>
  );
}
