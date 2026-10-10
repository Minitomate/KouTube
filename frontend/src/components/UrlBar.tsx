import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { isTauri, desktopResolve, ensureDesktopTools, inspectFailedMessage } from '../lib/desktop';

const ytSchema = z.string().url().refine(
  (u) => /(youtube\.com|youtu\.be)/.test(u),
  { message: 'Only YouTube URLs are supported' },
);

export default function UrlBar() {
  const { url, set } = useStore();
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function inspect(target?: string) {
    const value = (target ?? draft).trim();
    const parsed = ytSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid URL');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (isTauri()) {
        try {
          await ensureDesktopTools();
        } catch (e) {
          setError(e instanceof Error
            ? `Setup failed: ${e.message}. Check your connection and retry.`
            : 'Setup failed. Check your connection and retry.');
          return;
        }
        const media = await desktopResolve(value);
        set({ url: value, media, step: 1 });
      } else {
        const media = await api.resolve(value);
        set({ url: value, media, step: 1 });
      }
    } catch {
      setError(inspectFailedMessage(isTauri()));
    } finally {
      setLoading(false);
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      setDraft(text);
      if (text) void inspect(text);
    } catch {
      setError('Clipboard blocked — paste manually.');
    }
  }

  return (
    <div className="card">
      <h2>1 · Paste link</h2>
      <div className="urlbar">
        <label className="sr" htmlFor="url">YouTube URL</label>
        <input
          id="url"
          placeholder="https://youtube.com/watch?v=…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="url"
        />
        <button className="pill-btn tonal" onClick={paste} aria-label="Paste from clipboard">
          Paste
        </button>
        <button
          className="pill-btn filled"
          onClick={() => inspect()}
          disabled={loading}
          aria-label="Inspect video"
        >
          {loading ? '…' : 'Inspect'}
        </button>
      </div>
      <div className="field-error" role="alert">{error}</div>
    </div>
  );
}
