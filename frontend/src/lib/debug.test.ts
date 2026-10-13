import { describe, expect, it } from 'vitest';
import { useStore, blankTransfer } from './store';
import { collectDebugLog, saveDebugLog, DEBUG_LOG_NAME } from './debug';

describe('debug log', () => {
  it('collects queue titles, stages and errors', async () => {
    useStore.getState().set({
      queue: [
        { ...blankTransfer('a', 'Video One'), status: 'done', stage: 'end' },
        { ...blankTransfer('b', 'Video Two'), status: 'error', stage: 'end', error: 'boom' },
      ],
    });
    try {
      const text = await collectDebugLog();
      expect(text).toContain('## Video One [done/end]');
      expect(text).toContain('## Video Two [error/end]');
      expect(text).toContain('error: boom');
    } finally {
      useStore.getState().set({ queue: [] });
    }
  });

  it('reports an empty queue honestly', async () => {
    useStore.getState().set({ queue: [] });
    await expect(collectDebugLog()).resolves.toBe('(empty log)');
  });

  it('saves the log via anchor download on web', async () => {
    useStore.getState().set({ queue: [] });
    let clicked: { download: string; href: string } | null | undefined;
    const origClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked = { download: this.download, href: this.href };
    };
    try {
      await expect(saveDebugLog()).resolves.toBe('');
      expect(clicked?.download).toBe(DEBUG_LOG_NAME);
    } finally {
      window.HTMLAnchorElement.prototype.click = origClick;
      useStore.getState().set({ queue: [] });
    }
  });
});
