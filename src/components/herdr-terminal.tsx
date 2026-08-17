import { useEffect, useRef, useState } from "react";
import { createTerminalFrameConsumer } from "../lib/herdr/terminal-protocol";
import { getGhosttyAppearance, type GhosttyAppearance } from "../lib/server-fns";

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
  const [appearance, setAppearance] = useState<GhosttyAppearance | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    /**
     * Ghostty parses VT sequences in WebAssembly, so the module has to finish
     * instantiating before a terminal can be constructed. Everything below runs
     * once that resolves, and is skipped outright if the view unmounted first.
     */
    const start = (
      ghostty: typeof import("ghostty-web"),
      ghosttyAppearance: GhosttyAppearance,
    ): (() => void) => {
      const terminal = new ghostty.Terminal({
        convertEol: false,
        cursorBlink: false,
        disableStdin: true,
        fontFamily: ghosttyAppearance.fontFamily,
        fontSize: ghosttyAppearance.fontSize,
        scrollback: 0,
        theme: ghosttyAppearance.theme,
      });
      const fitAddon = new ghostty.FitAddon();
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
            if (record.type === "connected") return;
            if (record.type === "observer.error") {
              stopped = true;
              setError(record.message);
              setStatus("error");
            } else if (record.type === "terminal.frame") {
              setError("");
              setStatus("live");
            } else setStatus("closed");
          } catch (cause) {
            stopped = true;
            setError(cause instanceof Error ? cause.message : String(cause));
            setStatus("error");
            nextSocket.close(4000, "invalid terminal stream");
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
    };

    void (async () => {
      const [ghostty, ghosttyAppearance] = await Promise.all([
        import("ghostty-web"),
        getGhosttyAppearance(),
      ]);
      await ghostty.init();
      /**
       * Ghostty rasterizes glyphs into a canvas that never reflows, so a
       * webfont still in flight paints Nerd Font symbols as tofu forever.
       * Canvas text alone does not pull in a self-hosted face, hence the
       * explicit request for the whole stack before waiting on the set. A
       * stack the browser rejects costs glyph fidelity, never the terminal.
       */
      await Promise.all([
        document.fonts
          .load(`${ghosttyAppearance.fontSize}px ${ghosttyAppearance.fontFamily}`)
          .catch(() => []),
        document.fonts.ready,
      ]);
      if (disposed) return;
      setAppearance(ghosttyAppearance);
      teardown = start(ghostty, ghosttyAppearance);
    })().catch((cause: unknown) => {
      if (disposed) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [sessionId]);

  return (
    <section aria-label="Live read-only terminal" className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-t6">
        <span className="rounded bg-surface-0/60 px-1.5 py-0.5 text-secondary">
          Live read-only view
        </span>
        <span aria-live="polite">{status}</span>
        <span>JSONL transcript remains authoritative for session content.</span>
      </div>
      {error && <p className="mb-2 text-xs text-danger-000">{error}</p>}
      <div
        ref={container}
        className="h-[min(70vh,48rem)] overflow-hidden rounded-md border border-strong p-2"
        style={appearance ? { backgroundColor: appearance.theme.background } : undefined}
      />
    </section>
  );
}
