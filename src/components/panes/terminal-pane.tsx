import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { useShortcut } from "../../hooks/use-shortcut";
import type { TileId } from "../../lib/pane-layout";
import {
  addShellTab,
  CLAUDE_TAB_ID,
  removeShellTab,
  requestShellTabClose,
  selectTerminalTab,
  useShellTabs,
} from "../../lib/shell-tabs";
import { type ConnectionStatus, HerdrTerminal } from "../herdr-terminal";
import { ShellTerminal } from "../shell-terminal";
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

const TAB_CLASS =
  "flex h-6 cursor-pointer items-center rounded-r5 px-1.5 text-body outline-none focus-visible:ring-1 focus-visible:ring-accent-100 aria-selected:bg-fill-control aria-selected:text-primary text-secondary hover:text-primary";

const GHOST_ICON_BUTTON =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50";

const ShellCreatedResponse = z.object({ ptyKey: z.string().min(1) }).strict();
const ShellErrorResponse = z.object({ error: z.string().min(1) }).strict();

async function startShell(sessionId: string): Promise<string> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/shell`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = ShellErrorResponse.safeParse(body);
    throw new Error(failure.success ? failure.data.error : "Failed to start shell");
  }
  return ShellCreatedResponse.parse(body).ptyKey;
}

export interface TerminalPaneAvailability {
  /** herdr has a live pane running this session's TUI: show the Claude tab. */
  livePane: boolean;
  /** The Claude tab accepts input (herdr writes enabled). */
  interactive: boolean;
  /** Shell tabs are enabled in settings. */
  shells: boolean;
}

/**
 * The session Terminal pane. Upstream's tabs are plain shells, and so are
 * the **Shell** tabs here. Locally the first tab is **Claude**, the live
 * herdr pane running this session's TUI, whenever herdr has one.
 */
function TerminalPane({
  sessionId,
  availability,
  chrome,
}: {
  sessionId: string;
  availability: TerminalPaneAvailability;
  chrome: PaneChrome;
}) {
  const { livePane, interactive, shells } = availability;
  const focusRef = useRef<HTMLDivElement>(null);
  const [claudeStatus, setClaudeStatus] = useState<ConnectionStatus>("connecting");
  const [shellStatuses, setShellStatuses] = useState<Readonly<Record<string, ConnectionStatus>>>(
    {},
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const shellTabs = useShellTabs(sessionId);
  const autoStarted = useRef(false);

  const tabIds = [...(livePane ? [CLAUDE_TAB_ID] : []), ...shellTabs.tabs.map((tab) => tab.id)];
  const active =
    shellTabs.active !== null && tabIds.includes(shellTabs.active)
      ? shellTabs.active
      : (tabIds[0] ?? null);

  const newTerminal = useCallback(async () => {
    setStarting(true);
    setError("");
    try {
      addShellTab(sessionId, await startShell(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!pendingTerminalFocus) return;
    pendingTerminalFocus = false;
    focusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (livePane || !shells || shellTabs.tabs.length > 0 || autoStarted.current) return;
    autoStarted.current = true;
    void newTerminal();
  }, [livePane, shells, shellTabs.tabs.length, newTerminal]);

  const shellStatusChange = useCallback(
    (id: string) => (status: ConnectionStatus) =>
      setShellStatuses((current) =>
        current[id] === status ? current : { ...current, [id]: status },
      ),
    [],
  );
  const statusHandlers = useMemo(
    () => new Map(shellTabs.tabs.map((tab) => [tab.id, shellStatusChange(tab.id)])),
    [shellTabs.tabs, shellStatusChange],
  );
  const closeHandlers = useMemo(
    () => new Map(shellTabs.tabs.map((tab) => [tab.id, () => removeShellTab(sessionId, tab.id)])),
    [shellTabs.tabs, sessionId],
  );

  const activeStatus =
    active === CLAUDE_TAB_ID
      ? claudeStatus
      : active === null
        ? null
        : (shellStatuses[active] ?? "connecting");

  return (
    <>
      <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center gap-0.5">
            {livePane && (
              <button
                type="button"
                role="tab"
                aria-selected={active === CLAUDE_TAB_ID}
                aria-controls="terminal-pane-claude"
                onClick={() => {
                  selectTerminalTab(sessionId, CLAUDE_TAB_ID);
                  focusRef.current?.focus();
                }}
                className={TAB_CLASS}
              >
                Claude
              </button>
            )}
            {shellTabs.tabs.map((tab) => (
              <span key={tab.id} className="flex items-center">
                <button
                  type="button"
                  role="tab"
                  aria-selected={active === tab.id}
                  aria-controls={`terminal-pane-${tab.id}`}
                  onClick={() => selectTerminalTab(sessionId, tab.id)}
                  className={TAB_CLASS}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  disabled={tab.closing}
                  onClick={() => requestShellTabClose(sessionId, tab.id)}
                  className={GHOST_ICON_BUTTON}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ))}
          </div>
          {shells && (
            <button
              type="button"
              aria-label="New terminal"
              title="New terminal"
              disabled={starting}
              onClick={() => void newTerminal()}
              className={GHOST_ICON_BUTTON}
            >
              <Plus aria-hidden="true" className="size-4" />
            </button>
          )}
          {activeStatus !== null && <StatusChip status={activeStatus} />}
        </div>
        {chrome.moveHandle}
        <div className="relative z-[1] flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
      </div>
      {error && (
        <p role="alert" className="px-3 py-1 text-caption text-danger-000">
          {error}
        </p>
      )}
      {livePane && (
        <div
          ref={active === CLAUDE_TAB_ID ? focusRef : undefined}
          id="terminal-pane-claude"
          role="tabpanel"
          hidden={active !== CLAUDE_TAB_ID}
          tabIndex={0}
          aria-label="Claude terminal"
          data-terminal-focus={active === CLAUDE_TAB_ID ? "" : undefined}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-accent-100 focus-visible:ring-inset"
        >
          <HerdrTerminal
            sessionId={sessionId}
            variant="pane"
            interactive={interactive}
            onStatusChange={setClaudeStatus}
          />
        </div>
      )}
      {shellTabs.tabs.map((tab) => (
        <div
          key={tab.id}
          ref={active === tab.id ? focusRef : undefined}
          id={`terminal-pane-${tab.id}`}
          role="tabpanel"
          hidden={active !== tab.id}
          tabIndex={0}
          aria-label={`${tab.title} terminal`}
          data-terminal-focus={active === tab.id ? "" : undefined}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-accent-100 focus-visible:ring-inset"
        >
          <ShellTerminal
            ptyKey={tab.ptyKey}
            closeRequested={tab.closing}
            onClosed={closeHandlers.get(tab.id) ?? noop}
            onStatusChange={statusHandlers.get(tab.id) ?? noop}
          />
        </div>
      ))}
    </>
  );
}

function noop(): void {}

/**
 * Registers the `terminal` pane kind while it has something to show: a live
 * herdr pane for this session (the Claude tab) or Shell tabs, mirroring
 * upstream showing the toggle only when a transport exists. `interactive`
 * follows the herdr writes setting; without it the Claude tab stays a
 * read-only observer.
 */
export function useRegisterTerminalPane(
  sessionId: string,
  { livePane, interactive, shells }: TerminalPaneAvailability,
): void {
  useEffect(() => {
    if (!livePane && !shells) return;
    return registerPane("terminal", {
      title: "Terminal",
      header: "custom",
      render: (chrome) => (
        <TerminalPane
          sessionId={sessionId}
          availability={{ livePane, interactive, shells }}
          chrome={chrome}
        />
      ),
    });
  }, [sessionId, livePane, interactive, shells]);
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
