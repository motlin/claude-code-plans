import { useEffect, useRef, useState } from "react";
import { dispatchShortcutEvent } from "../hooks/use-shortcut";
import { terminalHandlesKey } from "../lib/herdr/terminal-keys";
import {
  decodeTerminalBytes,
  encodeTerminalText,
  parseShellServerFrame,
  type ShellClientFrame,
} from "../lib/herdr/terminal-protocol";
import type { GhosttyAppearance } from "../lib/server-fns";
import { type ConnectionStatus, loadGhostty } from "./herdr-terminal";

/** Socket closes that mean "stop", not "reconnect". */
const FINAL_CLOSE_CODES = new Set([1000, 1008, 4001, 4404]);

function shellSocketUrl(ptyKey: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/shell/${encodeURIComponent(ptyKey)}`;
}

/**
 * One Shell tab: a login `$SHELL` PTY on the server, attached over
 * `/api/shell/$ptyKey`. Reconnects replay the PTY's buffered output, so a
 * dropped socket or a re-mounted pane picks up where it left off.
 * `closeRequested` sends the close frame, which ends the PTY, then reports
 * `onClosed` so the tab can go. Without a live socket the idle timeout on the
 * server reaps the PTY instead.
 */
export function ShellTerminal({
  ptyKey,
  closeRequested,
  onClosed,
  onStatusChange,
}: {
  ptyKey: string;
  closeRequested: boolean;
  onClosed: () => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sendRef = useRef<((frame: ShellClientFrame) => boolean) | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [message, setMessage] = useState("");
  const [appearance, setAppearance] = useState<GhosttyAppearance | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    const start = (
      ghostty: typeof import("ghostty-web"),
      ghosttyAppearance: GhosttyAppearance,
    ): (() => void) => {
      const terminal = new ghostty.Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily: ghosttyAppearance.fontFamily,
        fontSize: ghosttyAppearance.fontSize,
        scrollback: 10_000,
        theme: ghosttyAppearance.theme,
      });
      const fitAddon = new ghostty.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(element);
      terminal.attachCustomKeyEventHandler((event) => {
        if (terminalHandlesKey(event)) return false;
        dispatchShortcutEvent(event);
        return true;
      });

      let socket: WebSocket | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const send = (frame: ShellClientFrame): boolean => {
        if (socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(frame));
        return true;
      };
      sendRef.current = send;
      const dataSubscription = terminal.onData((data) =>
        send({ type: "data", data: encodeTerminalText(data) }),
      );
      const sendSize = (): void => {
        fitAddon.fit();
        send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
      };

      const connect = (): void => {
        if (stopped) return;
        retry = null;
        const nextSocket = new WebSocket(shellSocketUrl(ptyKey));
        socket = nextSocket;

        nextSocket.addEventListener("open", sendSize);
        nextSocket.addEventListener("message", (event) => {
          let frame;
          try {
            frame = parseShellServerFrame(String(event.data));
          } catch {
            setMessage("Shell disconnected: invalid shell frame");
            setStatus("error");
            nextSocket.close(4000, "invalid shell frame");
            return;
          }
          switch (frame.type) {
            case "opened":
              terminal.reset();
              terminal.write(decodeTerminalBytes(frame.buffered));
              setMessage("");
              setStatus("live");
              return;
            case "data":
              terminal.write(decodeTerminalBytes(frame.data));
              return;
            case "exit":
              stopped = true;
              setMessage("Shell exited.");
              setStatus("closed");
              return;
            case "error":
              stopped = true;
              setMessage(frame.message);
              setStatus("error");
          }
        });
        nextSocket.addEventListener("close", (event) => {
          if (socket !== nextSocket) return;
          socket = null;
          if (event.code === 4404) {
            stopped = true;
            setMessage("Shell exited.");
            setStatus("closed");
          }
          if (stopped || FINAL_CLOSE_CODES.has(event.code)) {
            stopped = true;
            return;
          }
          setStatus("reconnecting");
          retry = setTimeout(connect, 750);
        });
      };

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(sendSize, 150);
      });
      resizeObserver.observe(element);
      fitAddon.fit();
      connect();

      return () => {
        stopped = true;
        sendRef.current = null;
        if (retry) clearTimeout(retry);
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        dataSubscription.dispose();
        socket?.close(1000, "shell view closed");
        terminal.dispose();
      };
    };

    void loadGhostty()
      .then(({ ghostty, appearance: ghosttyAppearance }) => {
        if (disposed) return;
        setAppearance(ghosttyAppearance);
        teardown = start(ghostty, ghosttyAppearance);
      })
      .catch(() => {
        if (disposed) return;
        setMessage("Couldn’t load the terminal. Reload the page to try again.");
        setStatus("error");
      });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [ptyKey]);

  useEffect(() => {
    if (!closeRequested) return;
    sendRef.current?.({ type: "close" });
    onClosedRef.current();
  }, [closeRequested]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {message && <p className="px-3 py-1 text-caption text-secondary">{message}</p>}
      <div
        ref={container}
        data-terminal=""
        className="min-h-0 flex-1 overflow-hidden rounded-b-[inherit] p-2"
        style={appearance ? { backgroundColor: appearance.theme.background } : undefined}
      />
    </div>
  );
}
