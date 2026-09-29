import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { useShortcut } from "../../hooks/use-shortcut";
import type { TileId } from "../../lib/pane-layout";
import { dispatchTerminalTabs, useShellTabs } from "../../lib/shell-tabs";
import { CLAUDE_TAB_ID, type CloseGuard, closeGuard } from "../../lib/terminal-tabs";
import { ConfirmDialog } from "../confirm-dialog";
import { type ConnectionStatus, HerdrTerminal } from "../herdr-terminal";
import { ShellTerminal } from "../shell-terminal";
import { type PaneChrome, registerPane } from "./pane-registry";
import { GHOST_ICON_BUTTON, type TerminalTabActions, TerminalTabStrip } from "./terminal-tab-strip";
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

const ShellCreatedResponse = z.object({ ptyKey: z.string().min(1) }).strict();
const ShellErrorResponse = z.object({ error: z.string().min(1) }).strict();
const ShellBusyResponse = z.object({ busy: z.array(z.string()) }).strict();

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

/** The shells still running a foreground command; none when the server cannot say. */
async function busyShells(ptyKeys: readonly string[]): Promise<ReadonlySet<string>> {
  try {
    const response = await fetch("/api/shell-busy", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ptyKeys }),
    });
    if (!response.ok) return new Set();
    return new Set(ShellBusyResponse.parse(await response.json()).busy);
  } catch {
    return new Set();
  }
}

export interface TerminalPaneAvailability {
  /** herdr has a live pane running this session's TUI: show the Claude tab. */
  livePane: boolean;
  /** The Claude tab accepts input (herdr writes enabled). */
  interactive: boolean;
  /** Shell tabs are enabled in settings. */
  shells: boolean;
}

interface PendingClose {
  guard: Extract<CloseGuard, { confirm: true }>;
  apply: () => void;
}

const PANEL_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-accent-100 focus-visible:ring-inset";

/** The Claude tab once herdr closes the session's pane: the TUI is gone, the transcript stays. */
function SessionEnded({ sessionId }: { sessionId: string }) {
  const host = usePaneHost();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="text-body text-primary">Session ended</p>
      <a
        href={`/session/${encodeURIComponent(sessionId)}`}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          host.closePane("terminal");
        }}
        className="text-body text-accent-100 hover:underline"
      >
        View transcript
      </a>
    </div>
  );
}

/**
 * The session Terminal pane. Upstream's tabs are plain shells, and so are
 * the **Shell** tabs here. Locally the first tab is **Claude**, the live
 * herdr pane running this session's TUI, whenever herdr has one; once herdr
 * closes that pane the tab stays behind as "Session ended".
 */
function TerminalPane({
  sessionId,
  availability,
  claudeEnded,
  chrome,
}: {
  sessionId: string;
  availability: TerminalPaneAvailability;
  claudeEnded: boolean;
  chrome: PaneChrome;
}) {
  const { livePane, interactive, shells } = availability;
  const showClaude = livePane || claudeEnded;
  const focusRef = useRef<HTMLDivElement>(null);
  const [claudeStatus, setClaudeStatus] = useState<ConnectionStatus>("connecting");
  const [shellStatuses, setShellStatuses] = useState<Readonly<Record<string, ConnectionStatus>>>(
    {},
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const shellTabs = useShellTabs(sessionId);
  const autoStarted = useRef(false);

  const tabIds = [...(showClaude ? [CLAUDE_TAB_ID] : []), ...shellTabs.tabs.map((tab) => tab.id)];
  const active =
    shellTabs.active !== null && tabIds.includes(shellTabs.active)
      ? shellTabs.active
      : (tabIds[0] ?? null);

  const newTerminal = useCallback(async () => {
    setStarting(true);
    setError("");
    try {
      dispatchTerminalTabs(sessionId, { type: "add", ptyKey: await startShell(sessionId) });
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
    if (showClaude || !shells || shellTabs.tabs.length > 0 || autoStarted.current) return;
    autoStarted.current = true;
    void newTerminal();
  }, [showClaude, shells, shellTabs.tabs.length, newTerminal]);

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
  const closedHandlers = useMemo(
    () =>
      new Map(
        shellTabs.tabs.map((tab) => [
          tab.id,
          () => dispatchTerminalTabs(sessionId, { type: "remove", id: tab.id }),
        ]),
      ),
    [shellTabs.tabs, sessionId],
  );
  const restartHandlers = useMemo(
    () =>
      new Map(
        shellTabs.tabs.map((tab) => [
          tab.id,
          async () => {
            const ptyKey = await startShell(sessionId);
            dispatchTerminalTabs(sessionId, { type: "restart", id: tab.id, ptyKey });
          },
        ]),
      ),
    [shellTabs.tabs, sessionId],
  );

  const activate = (id: string) => {
    dispatchTerminalTabs(sessionId, { type: "select", id });
    requestAnimationFrame(() => focusRef.current?.focus());
  };

  const guardedClose = async (kind: "close" | "close-others", id: string) => {
    const targets = shellTabs.tabs.filter((tab) =>
      kind === "close" ? tab.id === id : tab.id !== id,
    );
    if (targets.length === 0) return;
    const apply = () =>
      dispatchTerminalTabs(
        sessionId,
        kind === "close" ? { type: "request-close", ids: [id] } : { type: "close-others", id },
      );
    const guard = closeGuard(kind, targets, await busyShells(targets.map((tab) => tab.ptyKey)));
    if (guard.confirm) setPendingClose({ guard, apply });
    else apply();
  };

  const tabActions: TerminalTabActions = {
    rename: (id, title) => dispatchTerminalTabs(sessionId, { type: "rename", id, title }),
    close: (id) => void guardedClose("close", id),
    closeOthers: (id) => void guardedClose("close-others", id),
    move: (id, delta) => dispatchTerminalTabs(sessionId, { type: "move", id, delta }),
  };

  const activeStatus =
    active === CLAUDE_TAB_ID
      ? claudeEnded
        ? "closed"
        : claudeStatus
      : active === null
        ? null
        : (shellStatuses[active] ?? "connecting");

  return (
    <>
      <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <TerminalTabStrip
            showClaude={showClaude}
            tabs={shellTabs.tabs}
            active={active}
            actions={tabActions}
            onActivate={activate}
          />
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
      {showClaude && (
        <div
          ref={active === CLAUDE_TAB_ID ? focusRef : undefined}
          id={`terminal-pane-${CLAUDE_TAB_ID}`}
          role="tabpanel"
          hidden={active !== CLAUDE_TAB_ID}
          tabIndex={0}
          aria-label="Claude terminal"
          data-terminal-focus={active === CLAUDE_TAB_ID ? "" : undefined}
          className={PANEL_CLASS}
        >
          {claudeEnded ? (
            <SessionEnded sessionId={sessionId} />
          ) : (
            <HerdrTerminal
              sessionId={sessionId}
              variant="pane"
              interactive={interactive}
              onStatusChange={setClaudeStatus}
            />
          )}
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
          className={PANEL_CLASS}
        >
          <ShellTerminal
            sessionId={sessionId}
            ptyKey={tab.ptyKey}
            closeRequested={tab.closing}
            onClosed={closedHandlers.get(tab.id) ?? noop}
            onRestart={restartHandlers.get(tab.id) ?? resolved}
            onStatusChange={statusHandlers.get(tab.id) ?? noop}
          />
        </div>
      ))}
      <ConfirmDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
        title={pendingClose?.guard.title ?? ""}
        body={pendingClose?.guard.body ?? ""}
        confirmLabel={pendingClose?.guard.confirmLabel ?? "Close terminal"}
        variant="danger"
        onConfirm={() => pendingClose?.apply()}
      />
    </>
  );
}

function noop(): void {}

async function resolved(): Promise<void> {}

/**
 * Registers the `terminal` pane kind while it has something to show: a live
 * herdr pane for this session (the Claude tab), Shell tabs, or a Claude tab
 * whose herdr pane has since closed, mirroring upstream showing the toggle
 * only when a transport exists. `interactive` follows the herdr writes
 * setting; without it the Claude tab stays a read-only observer.
 */
export function useRegisterTerminalPane(
  sessionId: string,
  { livePane, interactive, shells }: TerminalPaneAvailability,
): void {
  const [livePaneSeenFor, setLivePaneSeenFor] = useState<string | null>(null);
  useEffect(() => {
    if (livePane) setLivePaneSeenFor(sessionId);
  }, [livePane, sessionId]);
  const claudeEnded = !livePane && livePaneSeenFor === sessionId;

  useEffect(() => {
    if (!livePane && !shells && !claudeEnded) return;
    return registerPane("terminal", {
      title: "Terminal",
      header: "custom",
      render: (chrome) => (
        <TerminalPane
          sessionId={sessionId}
          availability={{ livePane, interactive, shells }}
          claudeEnded={claudeEnded}
          chrome={chrome}
        />
      ),
    });
  }, [sessionId, livePane, interactive, shells, claudeEnded]);
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
