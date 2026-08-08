import { EventEmitter } from "node:events";
import { watch as watchNative, type FSWatcher as NativeWatcher, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { watch as watchPolling, type FSWatcher as PollingWatcher } from "chokidar";
import { resolveDirectoryRoots } from "./config";

const DEBOUNCE_MS = 100;

export interface RecursiveWatcher {
  once(event: "ready", listener: () => void): this;
  on(event: "add" | "change" | "unlink", listener: (path: string) => void): this;
  close(): Promise<void>;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
}

class RecursiveWatcherImpl extends EventEmitter implements RecursiveWatcher {
  private readonly debounceByPath = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly nativeWatchers = new Map<string, NativeWatcher>();
  private pollingWatcher: PollingWatcher | undefined;
  private readyImmediate: ReturnType<typeof setImmediate> | undefined;
  private closed = false;

  constructor(
    roots: readonly string[],
    private readonly ignored: (path: string, stats?: Stats) => boolean,
    private readonly polling: boolean,
  ) {
    super();
    void this.start(roots);
  }

  override once(event: "ready", listener: () => void): this {
    return super.once(event, listener);
  }

  override on(event: "add" | "change" | "unlink", listener: (path: string) => void): this {
    return super.on(event, listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.readyImmediate !== undefined) clearImmediate(this.readyImmediate);
    for (const timer of this.debounceByPath.values()) clearTimeout(timer);
    this.debounceByPath.clear();

    for (const watcher of this.nativeWatchers.values()) watcher.close();
    this.nativeWatchers.clear();

    if (this.pollingWatcher !== undefined) {
      await this.pollingWatcher.close();
      this.pollingWatcher = undefined;
    }
    this.removeAllListeners();
  }

  private async start(roots: readonly string[]): Promise<void> {
    const resolvedRoots = await resolveDirectoryRoots(roots, new Set(), "widest");
    if (this.closed) return;

    if (this.polling) {
      this.startPolling(resolvedRoots);
      return;
    }

    for (const root of resolvedRoots) {
      try {
        const watcher = watchNative(
          root,
          { recursive: true, persistent: true },
          (_event, relativePath) => this.handleNativeEvent(root, relativePath),
        );
        watcher.on("error", (error) => this.handleNativeError(root, watcher, error));
        this.nativeWatchers.set(root, watcher);
      } catch (error) {
        if (hasErrorCode(error, "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM")) {
          for (const watcher of this.nativeWatchers.values()) watcher.close();
          this.nativeWatchers.clear();
          this.startPolling(resolvedRoots);
          return;
        }
        console.error(`Recursive watcher failed for root ${root}:`, error);
      }
    }

    this.readyImmediate = setImmediate(() => {
      this.readyImmediate = undefined;
      if (!this.closed) this.emit("ready");
    });
  }

  private startPolling(roots: readonly string[]): void {
    const watcher = watchPolling([...roots], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 200 },
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
      ignored: this.ignored,
    });
    this.pollingWatcher = watcher;
    watcher.once("ready", () => {
      if (!this.closed) this.emit("ready");
    });
    watcher.on("add", (path) => {
      if (!this.closed) this.emit("add", path);
    });
    watcher.on("change", (path) => {
      if (!this.closed) this.emit("change", path);
    });
    watcher.on("unlink", (path) => {
      if (!this.closed) this.emit("unlink", path);
    });
    watcher.on("error", (error) => console.error("Polling watcher failed:", error));
  }

  private handleNativeEvent(root: string, relativePath: string | Buffer | null): void {
    if (this.closed || typeof relativePath !== "string") return;

    const path = join(root, relativePath);
    if (this.ignored(path)) return;

    const existingTimer = this.debounceByPath.get(path);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    this.debounceByPath.set(
      path,
      setTimeout(() => {
        this.debounceByPath.delete(path);
        void this.classifyAndEmit(path);
      }, DEBOUNCE_MS),
    );
  }

  private async classifyAndEmit(path: string): Promise<void> {
    try {
      const stats = await stat(path);
      if (!this.closed && stats.isFile() && !this.ignored(path, stats)) {
        this.emit("change", path);
      }
    } catch (error) {
      if (!this.closed && hasErrorCode(error, "ENOENT")) {
        this.emit("unlink", path);
      } else if (!this.closed) {
        console.error(`Recursive watcher could not classify ${path}:`, error);
      }
    }
  }

  private handleNativeError(root: string, watcher: NativeWatcher, error: Error): void {
    if (this.closed || this.nativeWatchers.get(root) !== watcher) return;
    console.error(`Recursive watcher failed for root ${root}:`, error);
    watcher.close();
    this.nativeWatchers.delete(root);
  }
}

export function createRecursiveWatcher(
  roots: readonly string[],
  ignored: (path: string, stats?: Stats) => boolean,
  polling = false,
): RecursiveWatcher {
  return new RecursiveWatcherImpl(roots, ignored, polling);
}
