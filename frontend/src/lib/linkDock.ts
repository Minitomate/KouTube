export type LinkDockAction = 'inspect' | 'download' | 'progress';

/** What the dock's primary button means right now. */
export function linkDockAction(input: {
  draft: string;
  url: string;
  hasMedia: boolean;
  busy: boolean;
}): LinkDockAction {
  if (input.busy) return 'progress';
  const value = input.draft.trim();
  return input.hasMedia && value === input.url ? 'download' : 'inspect';
}
