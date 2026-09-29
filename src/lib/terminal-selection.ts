import type { ILink, ILinkProvider } from "ghostty-web";
import { formatFencedExcerpt, requestAttachContext } from "./context-attach";

/**
 * Terminal selections and links as on claude.ai/code: ⌘C (or ⌃⇧C) copies the
 * selection trimmed, ⇧⌘L attaches it to the session's composer, and a link
 * opens only when it is http(s) and the user confirms "Open link?".
 */

export const TERMINAL_ATTACHED_MESSAGE = "Terminal output attached to chat";

type SelectionKeyEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

export interface SelectableTerminal {
  hasSelection(): boolean;
  getSelection(): string;
}

export interface SelectionActions {
  copy: (text: string) => void;
  attach: (text: string) => void;
}

/** Drop the blank cells padding each selected row, and blank rows at either end. */
export function trimTerminalSelection(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function selectionChord(event: SelectionKeyEvent): keyof SelectionActions | null {
  if (event.altKey) return null;
  if (event.code === "KeyC") {
    if (event.metaKey && !event.ctrlKey && !event.shiftKey) return "copy";
    if (event.ctrlKey && event.shiftKey && !event.metaKey) return "copy";
  }
  if (event.code === "KeyL" && event.metaKey && event.shiftKey && !event.ctrlKey) return "attach";
  return null;
}

/**
 * The custom key handler's selection chords: true when the key copied or
 * attached the selection, false to leave it to the terminal.
 */
export function handleTerminalSelectionKey(
  event: SelectionKeyEvent,
  terminal: SelectableTerminal,
  actions: SelectionActions,
): boolean {
  const chord = selectionChord(event);
  if (chord === null || !terminal.hasSelection()) return false;
  const text = trimTerminalSelection(terminal.getSelection());
  if (text === "") return false;
  actions[chord](text);
  return true;
}

/** Send terminal output to the session's composer; false when none is mounted. */
export function attachTerminalSelection(sessionId: string, text: string): boolean {
  return requestAttachContext(sessionId, formatFencedExcerpt(text));
}

function httpUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function openLinkPrompt(url: URL): string {
  return `Open link?\n\nHost: ${url.host}\n${url.href}`;
}

export interface LinkOpener {
  confirm: (message: string) => boolean;
  open: (href: string) => void;
}

/** Open an http(s) link once the user confirms; anything else is ignored. */
export function openTerminalLink(href: string, opener: LinkOpener): boolean {
  const url = httpUrl(href);
  if (url === null || !opener.confirm(openLinkPrompt(url))) return false;
  opener.open(url.href);
  return true;
}

export const browserLinkOpener: LinkOpener = {
  confirm: (message) => window.confirm(message),
  open: (href) => {
    window.open(href, "_blank", "noopener,noreferrer");
  },
};

function guardProvider(provider: ILinkProvider, activate: (href: string) => void): ILinkProvider {
  const guarded: ILinkProvider = {
    provideLinks: (y, callback) =>
      provider.provideLinks(y, (links) =>
        callback(links?.map((link): ILink => ({ ...link, activate: () => activate(link.text) }))),
      ),
  };
  if (provider.dispose) guarded.dispose = () => provider.dispose?.();
  return guarded;
}

interface LinkDetector {
  providers: ILinkProvider[];
  invalidateCache?: () => void;
}

function isLinkDetector(value: unknown): value is LinkDetector {
  return (
    typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "providers"))
  );
}

/**
 * ghostty-web's built-in OSC 8 and URL providers call `window.open` straight
 * from a ⌘-click with no way to configure it, so after `open()` each one is
 * wrapped to hand its link to `activate` instead. False when the terminal has
 * no link detector to guard.
 */
export function guardTerminalLinks(terminal: object, activate: (href: string) => void): boolean {
  const detector: unknown = Reflect.get(terminal, "linkDetector");
  if (!isLinkDetector(detector)) return false;
  detector.providers = detector.providers.map((provider) => guardProvider(provider, activate));
  detector.invalidateCache?.();
  return true;
}
