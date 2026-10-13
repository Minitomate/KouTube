import { describe, expect, it } from 'vitest';
import { useStore, blankTransfer } from './store';
import { collectDebugLog } from './debug';

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
});
