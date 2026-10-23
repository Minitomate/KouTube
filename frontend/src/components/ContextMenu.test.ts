import { describe, expect, it } from 'vitest';
import { menuEntriesFor, accentEntries, variantEntries, usesNativeTextMenu, MENU_SEP, type MenuContext } from './ContextMenu';
import { blankTransfer, type Transfer } from '../lib/store';

const OPTS = { dev: false, version: '0.3.1', desktop: true };
const ids = (ctx: MenuContext, dev = false) =>
  menuEntriesFor(ctx, { ...OPTS, dev }).map((e) => e.id);

function fakeInput(): HTMLInputElement {
  return { focus() {}, select() {} } as unknown as HTMLInputElement;
}

describe('native text menu', () => {
  it('leaves Android text fields to the system selection menu', () => {
    expect(usesNativeTextMenu(true, document.createElement('input'))).toBe(true);
    expect(usesNativeTextMenu(true, document.createElement('textarea'))).toBe(true);
  });

  it('keeps the custom menu on desktop and non-text targets', () => {
    expect(usesNativeTextMenu(false, document.createElement('input'))).toBe(false);
    expect(usesNativeTextMenu(true, document.createElement('div'))).toBe(false);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(usesNativeTextMenu(true, checkbox)).toBe(false);
  });
});

describe('context menu entries', () => {
  it('offers edit ops plus Paste & Inspect in inputs', () => {
    expect(ids({ kind: 'input', input: fakeInput() })).toEqual(
      ['cut', 'copy', 'paste', 'selectAll', MENU_SEP, 'pasteInspect'],
    );
  });

  it('mirrors the card buttons for finished desktop downloads', () => {
    const t = { ...blankTransfer('a', 'Vid'), status: 'done', stage: 'end', filepath: '/tmp/v.mp4' } as const;
    const entries = menuEntriesFor({ kind: 'transfer', transfer: { ...t } }, OPTS);
    expect(entries.map((e) => e.id)).toEqual(
      ['play', 'reveal', 'copyPath', MENU_SEP, 'delete', 'remove'],
    );
    expect(entries.find((e) => e.id === 'delete')?.danger).toBe(true);
  });

  it('drops file actions without a filepath and adds error copy', () => {
    const working: Transfer = { ...blankTransfer('b', 'Vid'), status: 'working', stage: 'downloading' };
    expect(ids({ kind: 'transfer', transfer: { ...working } })).toEqual(['remove']);
    const failed: Transfer = { ...working, status: 'error', stage: 'end', error: 'boom' };
    expect(ids({ kind: 'transfer', transfer: { ...failed } })).toEqual(['copyError', 'remove']);
  });

  it('shows the global menu with a disabled version header', () => {
    const entries = menuEntriesFor({ kind: 'global' }, OPTS);
    expect(entries.map((e) => e.id)).toEqual(
      ['header', 'pasteInspect', 'copyDebug', 'checkUpdates', MENU_SEP, 'goHome', 'goSettings', MENU_SEP, 'accent', 'variant'],
    );
    expect(entries[0].label).toBe('KouTube 0.3.1');
    expect(entries[0].disabled).toBe(true);
  });

  it('adds Reload and Inspect in dev builds only', () => {
    expect(ids({ kind: 'global' }, true)).toEqual(
      ['header', 'pasteInspect', 'copyDebug', 'checkUpdates', MENU_SEP, 'goHome', 'goSettings', MENU_SEP, 'accent', 'variant', MENU_SEP, 'reload', 'inspect'],
    );
  });

  it('marks the current accent and variant with a check', () => {
    const seeds = [{ name: 'Grape', seed: '#6750A4' }, { name: 'Ocean', seed: '#0061a4' }];
    const accent = accentEntries(seeds, '#0061a4');
    expect(accent.map((e) => e.id)).toEqual(['back', MENU_SEP, 'seed:#6750A4', 'seed:#0061a4']);
    expect(accent[2].label).toBe('Grape');
    expect(accent[3].label).toBe('Ocean ✓');
    const variants = [{ id: 'tonal-spot', label: 'Tonal Spot' }, { id: 'vibrant', label: 'Vibrant' }];
    const variant = variantEntries(variants, 'vibrant');
    expect(variant.map((e) => e.id)).toEqual(['back', MENU_SEP, 'variant:tonal-spot', 'variant:vibrant']);
    expect(variant[2].label).toBe('Tonal Spot');
    expect(variant[3].label).toBe('Vibrant ✓');
  });
});
