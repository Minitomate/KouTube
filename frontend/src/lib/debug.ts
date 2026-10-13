// Shared debug-log collection: queue snapshot + backend tail.
// Used by Settings (Copy debug log) and the context menu alike.
import { useStore } from './store';
import { isTauri, getRecentLogs, pickSaveLogPath, saveTextFile } from './desktop';
import { saveBlob } from './transfer';

export const DEBUG_LOG_NAME = 'koutube-debug-log.txt';

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

/** Save the log to disk: save dialog + backend write on desktop, anchor
 *  download on web. Returns the saved path, '' for the anchor download,
 *  null when the user cancels the dialog. */
export async function saveDebugLog(): Promise<string | null> {
  const text = await collectDebugLog();
  if (!isTauri()) {
    saveBlob(new Blob([text], { type: 'text/plain' }), DEBUG_LOG_NAME);
    return '';
  }
  const path = await pickSaveLogPath(DEBUG_LOG_NAME);
  if (!path) return null;
  await saveTextFile(path, text);
  return path;
}
