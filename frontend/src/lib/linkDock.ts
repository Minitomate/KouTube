export type LinkDockAction = 'inspect' | 'download';

/** What the dock's primary button means right now. */
export function linkDockAction(input: {
  draft: string;
  url: string;
  hasMedia: boolean;
}): LinkDockAction {
  const value = input.draft.trim();
  return input.hasMedia && value === input.url ? 'download' : 'inspect';
}
