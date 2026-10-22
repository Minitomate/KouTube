import { describe, expect, it } from 'vitest';
import { linkDockAction } from './linkDock';

describe('link dock action', () => {
  it('inspects empty and changed links', () => {
    expect(linkDockAction({ draft: '', url: '', hasMedia: false })).toBe('inspect');
    expect(linkDockAction({ draft: 'https://youtu.be/a', url: 'https://youtu.be/a', hasMedia: false })).toBe('inspect');
    expect(linkDockAction({ draft: 'https://youtu.be/b', url: 'https://youtu.be/a', hasMedia: true })).toBe('inspect');
  });

  it('downloads only the inspected link', () => {
    expect(linkDockAction({ draft: ' https://youtu.be/a ', url: 'https://youtu.be/a', hasMedia: true })).toBe('download');
  });
});
