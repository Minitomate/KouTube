import { describe, expect, it } from 'vitest';
import { parentOf } from './FolderBrowser';

describe('parentOf', () => {
  it('walks up to the volume root and stops at /storage', () => {
    expect(parentOf('/storage/emulated/0/Download/')).toBe('/storage/emulated/0');
    expect(parentOf('/storage/emulated/0')).toBe('/storage/emulated');
    expect(parentOf('/storage')).toBeNull();
    expect(parentOf('/storage/1234-5678/Movies')).toBe('/storage/1234-5678');
  });
});
