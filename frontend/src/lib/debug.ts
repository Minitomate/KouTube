// Shared debug-log collection: queue snapshot + backend tail.
// Used by Settings (Copy debug log) and the context menu alike.
import { useStore } from './store';
import { isTauri, getRecentLogs } from './desktop';

export async function collectDebugLog(): Promise<string> {
  const lines: string[] = [];
  for (const q of useStore.getState().queue) {
    lines.push(`## ${q.title} [${q.status}/${q.stage}]`);
    for (const l of q.log ?? []) lines.push(`  ${l}`);
    if (q.error) lines.push(`  error: ${q.error}`);
  }
  if (isTauri()) {
    try {
      const recent = await getRecentLogs();
      lines.push('## backend recent');
      for (const l of recent.slice(-60)) lines.push(`  ${l}`);
    } catch { /* frontend log alone still helps */ }
  }
  return lines.join('\n') || '(empty log)';
}

export async function copyDebugLog(): Promise<void> {
  await navigator.clipboard.writeText(await collectDebugLog());
}
