// Custom context menu: replaces the webview default everywhere.
// Every entry reuses an existing action; nothing here invents behavior.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, type Transfer } from '../lib/store';
import type { Settings } from '../lib/settings';
import { isTauri, playFile, revealFile, trashDownload } from '../lib/desktop';
import { runUpdateCheck, getAppVersion } from '../lib/updater';
import { copyDebugLog } from '../lib/debug';
import Confirm from './Confirm';

export type MenuContext =
  | { kind: 'input'; input: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'transfer'; transfer: Transfer }
  | { kind: 'global' };

export interface MenuEntry {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

/** Separator marker between entries. */
export const MENU_SEP = 'sep';

export interface MenuOptions {
  dev: boolean;
  version: string;
  desktop: boolean;
}

/** Pure spec: entry ids + labels per context. Unit-tested. */
export function menuEntriesFor(ctx: MenuContext, opts: MenuOptions): MenuEntry[] {
  switch (ctx.kind) {
    case 'input':
      return [
        { id: 'cut', label: 'Cut' },
        { id: 'copy', label: 'Copy' },
        { id: 'paste', label: 'Paste' },
        { id: 'selectAll', label: 'Select all' },
        { id: MENU_SEP, label: '' },
        { id: 'pasteInspect', label: 'Paste & Inspect' },
      ];
    case 'transfer': {
      const t = ctx.transfer;
      const entries: MenuEntry[] = [];
      // Mirror the card buttons: actions only exist for finished Tauri cards.
      if (t.status === 'done' && t.filepath && opts.desktop) {
        entries.push(
          { id: 'play', label: 'Play' },
          { id: 'reveal', label: 'Show in folder' },
          { id: 'copyPath', label: 'Copy file path' },
          { id: MENU_SEP, label: '' },
          { id: 'delete', label: 'Delete file', danger: true },
        );
      }
      if (t.error) entries.push({ id: 'copyError', label: 'Copy error text' });
      entries.push({ id: 'remove', label: 'Remove from list' });
      return entries;
    }
    default:
      return [
        { id: 'header', label: `KouTube ${opts.version}`, disabled: true },
        { id: 'pasteInspect', label: 'Paste & Inspect' },
        { id: 'copyDebug', label: 'Copy debug log' },
        { id: 'checkUpdates', label: 'Check for updates' },
        { id: MENU_SEP, label: '' },
        { id: 'goHome', label: 'Home' },
        { id: 'goSettings', label: 'Settings' },
        { id: MENU_SEP, label: '' },
        { id: 'accent', label: 'Accent color…' },
        { id: 'variant', label: 'Variant…' },
        ...(opts.dev
          ? [
              { id: MENU_SEP, label: '' },
              { id: 'reload', label: 'Reload' },
              { id: 'inspect', label: 'Inspect element' },
            ]
          : []),
      ];
  }
}

/** Appearance submenu rows: Back + choices with a check on the current one.
 *  Lists are parameters (same SEEDS/VARIANTS objects Settings uses) so this
 *  stays testable without pulling the settings module. */
export function accentEntries(
  seeds: Array<{ name: string; seed: string }>,
  currentSeed: string,
): MenuEntry[] {
  return [
    { id: 'back', label: '← Back' },
    { id: MENU_SEP, label: '' },
    ...seeds.map((s) => ({
      id: `seed:${s.seed}`,
      label: `${s.name}${s.seed.toLowerCase() === currentSeed.toLowerCase() ? ' ✓' : ''}`,
    })),
  ];
}

export function variantEntries(
  variants: Array<{ id: string; label: string }>,
  currentVariant: string,
): MenuEntry[] {
  return [
    { id: 'back', label: '← Back' },
    { id: MENU_SEP, label: '' },
    ...variants.map((v) => ({
      id: `variant:${v.id}`,
      label: `${v.label}${v.id === currentVariant ? ' ✓' : ''}`,
    })),
  ];
}

/** React-controlled value set: dispatches `input` so bindings pick it up. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement
    ? window.HTMLInputElement.prototype
    : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.value = value; // last resort; the next render may clobber it
  }
}

function editOp(
  op: 'cut' | 'copy' | 'paste' | 'selectAll',
  input: HTMLInputElement | HTMLTextAreaElement,
): Promise<void> {
  switch (op) {
    case 'selectAll':
      input.focus();
      input.select();
      return Promise.resolve();
    case 'copy': {
      const text = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? input.value.length);
      return navigator.clipboard.writeText(text);
    }
    case 'cut': {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? input.value.length;
      const text = input.value.slice(start, end);
      return navigator.clipboard.writeText(text).then(() => {
        input.focus();
        setNativeValue(input, input.value.slice(0, start) + input.value.slice(end));
        input.setSelectionRange(start, start);
      });
    }
    case 'paste': {
      return navigator.clipboard.readText().then((text) => {
        if (!text) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.focus();
        setNativeValue(input, input.value.slice(0, start) + text + input.value.slice(end));
        const caret = start + text.length;
        input.setSelectionRange(caret, caret);
      });
    }
  }
}

interface OpenMenu {
  x: number;
  y: number;
  ctx: MenuContext;
  entries: MenuEntry[];
}

function removeTransfer(id: string): void {
  const { queue, set } = useStore.getState();
  set({ queue: queue.filter((q) => q.id !== id) });
}

export default function ContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [submenu, setSubmenu] = useState<MenuEntry[] | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Transfer | null>(null);
  const [version, setVersion] = useState('…');
  const menuRef = useRef<HTMLDivElement>(null);
  const lastMenu = useRef<OpenMenu | null>(null);

  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => setVersion('unknown'));
  }, []);

  const close = useCallback(() => {
    setMenu(null);
    setSubmenu(null);
    setError('');
  }, []);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const input = target?.closest?.('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
      let ctx: MenuContext;
      if (input) {
        ctx = { kind: 'input', input };
      } else {
        const card = target?.closest?.('[data-transfer-id]');
        const t = card
          ? useStore.getState().queue.find((q) => q.id === card.getAttribute('data-transfer-id'))
          : undefined;
        ctx = t ? { kind: 'transfer', transfer: t } : { kind: 'global' };
      }
      const entries = menuEntriesFor(ctx, {
        dev: import.meta.env.DEV,
        version,
        desktop: isTauri(),
      });
      const opened: OpenMenu = {
        // Compact rows (~32px each): the whole menu always fits, no scroll.
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - 200)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - entries.length * 34 - 20)),
        ctx,
        entries,
      };
      lastMenu.current = opened;
      setMenu(opened);
      setError('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        setConfirmDelete(null);
      }
    };
    const onScroll = () => close();
    // Left-click anywhere outside the menu dismisses it (click passes through).
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [close, version]);

  // Keyboard: focus the first action when the menu opens.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [menu, submenu]);

  /** Appearance submenu: lists load async (settings module), choices apply
   *  through the shared patch helper so Settings and menu never diverge. */
  async function openSubmenu(kind: 'accent' | 'variant'): Promise<void> {
    const { SEEDS, VARIANTS } = await import('../lib/settings');
    const s = useStore.getState();
    setSubmenu(
      kind === 'accent' ? accentEntries(SEEDS, s.seed) : variantEntries(VARIANTS, s.variant),
    );
  }

  async function applyAppearance(patch: { seed?: string; variant?: Settings['variant'] }): Promise<void> {
    const { patchSettings } = await import('../lib/settings');
    const next = await patchSettings(patch);
    const st = useStore.getState();
    if (patch.seed !== undefined) st.set({ seed: next.seed });
    if (patch.variant !== undefined) st.set({ variant: next.variant });
  }

  async function run(id: string): Promise<void> {
    if (!menu) return;
    const { ctx } = menu;
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    try {
      switch (id) {
        case 'cut':
        case 'copy':
        case 'paste':
        case 'selectAll':
          if (ctx.kind !== 'input') return;
          await editOp(id, ctx.input);
          break;
        case 'pasteInspect': {
          const st = useStore.getState();
          if (st.view !== 'home') {
            st.set({ view: 'home' });
            // UrlBar mounts with the Home view; let it attach before dispatching.
            await new Promise((r) => setTimeout(r, 80));
          }
          window.dispatchEvent(new CustomEvent('koutube:paste-inspect'));
          break;
        }
        case 'play':
        case 'reveal':
        case 'copyPath':
        case 'delete': {
          if (ctx.kind !== 'transfer') return;
          const t = ctx.transfer;
          if (!t.filepath) throw new Error('No file attached yet.');
          if (id === 'play') await playFile(t.filepath);
          else if (id === 'reveal') await revealFile(t.filepath);
          else if (id === 'copyPath') await navigator.clipboard.writeText(t.filepath);
          else {
            setConfirmDelete(t);
            close();
            return;
          }
          break;
        }
        case 'copyError':
          if (ctx.kind !== 'transfer') return;
          await navigator.clipboard.writeText(ctx.transfer.error ?? '');
          break;
        case 'remove':
          if (ctx.kind !== 'transfer') return;
          removeTransfer(ctx.transfer.id);
          break;
        case 'copyDebug':
          await copyDebugLog();
          break;
        case 'checkUpdates':
          await runUpdateCheck();
          break;
        case 'goHome':
        case 'goSettings':
          useStore.getState().set({ view: id === 'goHome' ? 'home' : 'settings' });
          break;
        case 'accent':
          await openSubmenu('accent');
          return;
        case 'variant':
          await openSubmenu('variant');
          return;
        case 'back':
          setSubmenu(null);
          return;
        case 'reload':
          window.location.reload();
          return; // no close needed; the page is going away
        case 'inspect': {
          const core = await import('@tauri-apps/api/core');
          await core.invoke('open_devtools');
          break;
        }
        default: {
          // Appearance picks from the submenu: apply, then rebuild it so the
          // checkmark follows the new choice. Anything else is a no-op.
          if (id.startsWith('seed:')) {
            await applyAppearance({ seed: id.slice('seed:'.length) });
            await openSubmenu('accent');
            return;
          }
          if (id.startsWith('variant:')) {
            await applyAppearance({ variant: id.slice('variant:'.length) as Settings['variant'] });
            await openSubmenu('variant');
            return;
          }
          return;
        }
      }
      close();
    } catch (e) {
      console.error('[KouTube] menu action failed', id, e);
      fail(e);
    }
  }

  async function confirmTrash(): Promise<void> {
    const t = confirmDelete;
    setConfirmDelete(null);
    if (!t?.filepath) return;
    try {
      await trashDownload(t.filepath);
      removeTransfer(t.id);
    } catch (e) {
      // Reopen where the user was, with the reason visible.
      if (lastMenu.current) setMenu(lastMenu.current);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (confirmDelete) {
    return (
      <Confirm
        title="Move file to trash?"
        body="The download stays in the list. This cannot be undone from here."
        items={confirmDelete.filepath ? [confirmDelete.filepath] : []}
        confirmLabel="Move to trash"
        onConfirm={() => void confirmTrash()}
        onCancel={() => setConfirmDelete(null)}
      />
    );
  }
  if (!menu) return null;
  // Submenu replaces the top-level list until Back (or dismiss).
  const visible = submenu ?? menu.entries;
  return (
    <div ref={menuRef} className="md-panel ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {visible.map((e, i) => e.id === MENU_SEP
        ? <div key={`${e.id}-${i}`} className="ctx-sep" role="separator" />
        : (
          <button
            key={e.id}
            role="menuitem"
            className={`md-option${e.danger ? ' ctx-danger' : ''}`}
            disabled={e.disabled}
            onClick={() => void run(e.id)}
          >
            {e.label}
          </button>
        ))}
      {error && <div className="ctx-error" role="alert">{error}</div>}
    </div>
  );
}
