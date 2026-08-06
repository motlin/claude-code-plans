import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { createTerminalFrameConsumer } from "../lib/herdr/terminal-protocol";

type ConnectionStatus = "connecting" | "live" | "reconnecting" | "closed" | "error";

function observerUrl(sessionId: string, columns: number, rows: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/api/herdr/observe", `${protocol}//${window.location.host}`);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("columns", String(columns));
  url.searchParams.set("rows", String(rows));
  return url.toString();
}

export function HerdrTerminal({ sessionId }: { sessionId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      scrollback: 0,
      theme: { background: "#111318", foreground: "#e6e6e6" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let reconnectForResize: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let viewport = { columns: 0, rows: 0 };

    const connect = (): void => {
      if (stopped) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      fitAddon.fit();
      viewport = { columns: terminal.cols, rows: terminal.rows };
      const nextSocket = new WebSocket(observerUrl(sessionId, viewport.columns, viewport.rows));
      const consumer = createTerminalFrameConsumer({
        reset: () => terminal.reset(),
        resize: (columns, rows) => terminal.resize(columns, rows),
        write: (bytes) => terminal.write(bytes),
      });
      socket = nextSocket;
      setStatus((current) => (current === "connecting" ? "connecting" : "reconnecting"));

      nextSocket.addEventListener("message", (event) => {
        try {
          const record = consumer.consume(String(event.data));
          if (record.type === "terminal.frame") {
            setError("");
            setStatus("live");
          } else setStatus("closed");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus("error");
          nextSocket.close(1002, "invalid terminal stream");
        }
      });
      nextSocket.addEventListener("close", (event) => {
        if (stopped || socket !== nextSocket || event.code === 1000) return;
        setStatus("reconnecting");
        retry = setTimeout(connect, 750);
      });
      nextSocket.addEventListener("error", () => {
        setStatus("reconnecting");
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      if (stopped) return;
      if (reconnectForResize) clearTimeout(reconnectForResize);
      reconnectForResize = setTimeout(() => {
        fitAddon.fit();
        if (terminal.cols === viewport.columns && terminal.rows === viewport.rows) return;
        socket?.close(1000, "observer viewport resized");
        setStatus("reconnecting");
        connect();
      }, 150);
    });

    resizeObserver.observe(element);
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (reconnectForResize) clearTimeout(reconnectForResize);
      resizeObserver.disconnect();
      socket?.close(1000, "terminal view closed");
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <section aria-label="Live read-only terminal" className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-text-500">
        <span className="rounded bg-bg-200/60 px-1.5 py-0.5 text-text-300">
          Live read-only view
        </span>
        <span aria-live="polite">{status}</span>
        <span>JSONL transcript remains authoritative for session content.</span>
      </div>
      {error && <p className="mb-2 text-xs text-danger-000">{error}</p>}
      <div
        ref={container}
        className="h-[min(70vh,48rem)] overflow-hidden rounded-md border border-border-300/20 bg-[#111318] p-2"
      />
    </section>
  );
}
