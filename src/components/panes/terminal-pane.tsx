import { useEffect, useRef, useState } from "react";

import { useShortcut } from "../../hooks/use-shortcut";
import type { TileId } from "../../lib/pane-layout";
import { type ConnectionStatus, HerdrTerminal } from "../herdr-terminal";
import { type PaneChrome, registerPane } from "./pane-registry";
import { usePaneHost } from "./tile-host";

export type TerminalShortcutAction = "noop" | "open" | "focus" | "close" | "caret";

/**
 * Upstream's ⌃` state machine: nothing without a transport, open a closed
 * pane, pull focus over from another tile, close when focus is already inside
 * the terminal, and otherwise put the caret back into the active terminal.
 */
export function terminalShortcutAction({
  available,
  open,
  focusedTile,
  focusInTerminal,
}: {
  available: boolean;
  open: boolean;
  focusedTile: TileId;
  focusInTerminal: boolean;
}): TerminalShortcutAction {
  if (!available) return "noop";
  if (!open) return "open";
  if (focusInTerminal) return "close";
  if (focusedTile !== "terminal") return "focus";
  return "caret";
}

const TERMINAL_FOCUS_SELECTOR = '[data-pane-kind="terminal"] [data-terminal-focus]';

/** Set by ⌃` when it opens the pane, consumed on mount so the new pane takes focus. */
let pendingTerminalFocus = false;

function focusTerminal(): void {
  document.querySelector<HTMLElement>(TERMINAL_FOCUS_SELECTOR)?.focus();
}

function isFocusInTerminal(): boolean {
  return document.activeElement?.closest('[data-pane-kind="terminal"]') != null;
}

const STATUS_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  closed: "Closed",
  error: "Error",
};

function StatusChip({ status }: { status: ConnectionStatus }) {
  return (
    <span
      data-terminal-status={status}
      aria-live="polite"
      className="flex shrink-0 items-center gap-1 rounded-full bg-alpha-2 px-1.5 text-caption text-secondary"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${
          status === "live"
            ? "bg-success-000"
            : status === "error"
              ? "bg-danger-000"
              : "bg-fill-control"
        }`}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The session Terminal pane. Upstream's tabs are plain shells; locally the
 * first (and for now only) tab is **Claude**, the live herdr pane running this
 * session's TUI.
 */
function TerminalPane({
  sessionId,
  interactive,
  chrome,
}: {
  sessionId: string;
  interactive: boolean;
  chrome: PaneChrome;
}) {
  const focusRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!pendingTerminalFocus) return;
    pendingTerminalFocus = false;
    focusRef.current?.focus();
  }, []);

  return (
    <>
      <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={true}
              aria-controls="terminal-pane-claude"
              onClick={() => focusRef.current?.focus()}
              className="flex h-6 cursor-pointer items-center rounded-r5 bg-fill-control px-1.5 text-body text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
            >
              Claude
            </button>
          </div>
          <StatusChip status={status} />
        </div>
        {chrome.moveHandle}
        <div className="relative z-[1] flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
      </div>
      <div
        ref={focusRef}
        id="terminal-pane-claude"
        role="tabpanel"
        tabIndex={0}
        aria-label="Claude terminal"
        data-terminal-focus=""
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-accent-100 focus-visible:ring-inset"
      >
        <HerdrTerminal
          sessionId={sessionId}
          variant="pane"
          interactive={interactive}
          onStatusChange={setStatus}
        />
      </div>
    </>
  );
}

/**
 * Registers the `terminal` pane kind while herdr has a live pane for this
 * session, mirroring upstream showing the toggle only when a transport exists.
 * `interactive` follows the herdr writes setting; without it the Claude tab
 * stays a read-only observer.
 */
export function useRegisterTerminalPane(
  sessionId: string,
  available: boolean,
  interactive: boolean,
): void {
  useEffect(() => {
    if (!available) return;
    return registerPane("terminal", {
      title: "Terminal",
      header: "custom",
      render: (chrome) => (
        <TerminalPane sessionId={sessionId} interactive={interactive} chrome={chrome} />
      ),
    });
  }, [sessionId, available, interactive]);
}

/** Binds ⌃` to the Terminal pane state machine. */
export function TerminalPaneShortcut({ available }: { available: boolean }) {
  const host = usePaneHost();
  useShortcut("toggle_terminal", () => {
    const action = terminalShortcutAction({
      available,
      open: host.isOpen("terminal"),
      focusedTile: host.layout.focused,
      focusInTerminal: isFocusInTerminal(),
    });
    switch (action) {
      case "noop":
        return false;
      case "open":
        pendingTerminalFocus = true;
        host.openPane("terminal");
        return true;
      case "close":
        host.closePane("terminal");
        return true;
      case "focus":
      case "caret":
        focusTerminal();
        return true;
    }
  });
  return null;
}
