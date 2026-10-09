import { useEffect, useState } from 'react';
import { api, subscribeJob, type JobEvent } from '../lib/api';
import { useStore } from '../lib/store';

export default function JobCard({ jobId }: { jobId: string }) {
  const { queue, upsertJob } = useStore();
  const job = queue.find((q) => q.id === jobId);
  const [files, setFiles] = useState<{ name: string; url: string }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const off = subscribeJob(jobId, (e: JobEvent) => {
      upsertJob({ id: jobId, url: job?.url ?? '', title: job?.title ?? jobId, progress: e.progress, status: e.status });
      if (e.status === 'done') {
        api.files(jobId).then((f) => setFiles(f.files)).catch(() => {});
      }
      if (e.status === 'error') setError(e.error ?? 'Download failed');
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (!job) return null;
  return (
    <div className="job">
      <div className="row">
        <strong style={{ flex: 1 }}>{job.title}</strong>
        <span className="meta">{job.status} · {Math.round(job.progress * 100)}%</span>
      </div>
      <div className="progress-pill" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Download progress ${job.title}`}>
        <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="pill-btn outlined" style={{ minHeight: 40 }} aria-label={`Cancel ${job.title}`}
          onClick={() => api.cancel(jobId).catch(() => setError('Cancel failed'))}>
          Cancel
        </button>
        {(job.status === 'error' || job.status === 'cancelled') && (
          <button className="pill-btn tonal" style={{ minHeight: 40 }} aria-label={`Retry ${job.title}`}
            onClick={() => { setError(''); api.retry(jobId).catch(() => setError('Retry failed')); }}>
            Retry
          </button>
        )}
        {files.map((f) => (
          <a key={f.url} href={f.url} className="pill-btn filled" style={{ minHeight: 40, textDecoration: 'none' }} download>
            {f.name}
          </a>
        ))}
      </div>
    </div>
  );
}
