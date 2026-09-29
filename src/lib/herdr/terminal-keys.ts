type TerminalKeyEvent = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

interface AppChord {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * App shortcuts that must escape an interactive terminal: ⌃` toggles the
 * terminal pane, ⌃Q switches recents, ⌘K opens search and ⌘/ the shortcuts
 * dialog. Everything else, including ⌃K and ⌃C, belongs to the TUI.
 */
const APP_CHORDS: readonly AppChord[] = [
  { code: "Backquote", ctrlKey: true, metaKey: false },
  { code: "KeyQ", ctrlKey: true, metaKey: false },
  { code: "KeyK", ctrlKey: false, metaKey: true },
  { code: "Slash", ctrlKey: false, metaKey: true },
];

/** xterm-style custom key handler: `false` leaves the key to the app. */
export function terminalHandlesKey(event: TerminalKeyEvent): boolean {
  if (event.altKey || event.shiftKey) return true;
  return !APP_CHORDS.some(
    (chord) =>
      chord.code === event.code &&
      chord.ctrlKey === event.ctrlKey &&
      chord.metaKey === event.metaKey,
  );
}
