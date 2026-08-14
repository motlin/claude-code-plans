import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { watch as watchNative, type FSWatcher as NativeWatcher, type Stats } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveDirectoryRoots } from "./config";

const DEBOUNCE_MS = 100;

/** Sentinel written into each root until the native watcher reports it back. */
const PROBE_PREFIX = ".claude-code-browser-watch-probe-";
const PROBE_RETRY_MS = 25;
const PROBE_TIMEOUT_MS = 1000;

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

/**
 * Prefer a git-ignored directory for the probe so a repository root never shows
 * the sentinel as an untracked file, even for the milliseconds it exists.
 */
async function resolveProbeDirectory(root: string): Promise<string> {
  const gitDirectory = join(root, ".git");
  try {
    if ((await stat(gitDirectory)).isDirectory()) return gitDirectory;
  } catch {
    // A watched root does not have to be a git repository.
  }
  return root;
}

class RecursiveWatcherImpl extends EventEmitter implements RecursiveWatcher {
  private readonly debounceByPath = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly nativeWatchers = new Map<string, NativeWatcher>();
  private readonly probeObservers = new Map<string, () => void>();
  private readonly probeTimers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(
    roots: readonly string[],
    private readonly ignored: (path: string, stats?: Stats) => boolean,
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

    for (const timer of this.debounceByPath.values()) clearTimeout(timer);
    this.debounceByPath.clear();
    for (const timer of this.probeTimers) clearTimeout(timer);
    this.probeTimers.clear();
    for (const observe of this.probeObservers.values()) observe();
    this.probeObservers.clear();

    for (const watcher of this.nativeWatchers.values()) watcher.close();
    this.nativeWatchers.clear();

    this.removeAllListeners();
  }

  private async start(roots: readonly string[]): Promise<void> {
    const resolvedRoots = await resolveDirectoryRoots(roots, new Set(), "widest");
    if (this.closed) return;

    const attachedRoots: string[] = [];
    for (const root of resolvedRoots) {
      try {
        const watcher = watchNative(
          root,
          { recursive: true, persistent: true },
          (_event, relativePath) => this.handleNativeEvent(root, relativePath),
        );
        watcher.on("error", (error) => this.handleNativeError(root, watcher, error));
        this.nativeWatchers.set(root, watcher);
        attachedRoots.push(root);
      } catch (error) {
        console.error(`Recursive watcher failed for root ${root}:`, error);
      }
    }

    await Promise.all(attachedRoots.map((root) => this.waitUntilArmed(root)));
    if (!this.closed) this.emit("ready");
  }

  /**
   * A returned native watcher is not necessarily delivering events yet: macOS
   * arms the FSEvents stream asynchronously, so a write issued right after
   * `watch()` returns can be dropped. Announce readiness only once the watcher
   * has reported a sentinel of our own back to us.
   */
  private async waitUntilArmed(root: string): Promise<void> {
    const probePath = join(
      await resolveProbeDirectory(root),
      `${PROBE_PREFIX}${process.pid}-${randomUUID()}`,
    );
    const observed = new Promise<void>((resolve) => this.probeObservers.set(probePath, resolve));
    const deadline = Date.now() + PROBE_TIMEOUT_MS;

    try {
      while (!this.closed) {
        await writeFile(probePath, "", "utf8");
        if (await this.raceProbe(observed)) return;
        if (Date.now() >= deadline) {
          console.error(`Recursive watcher could not confirm event delivery for root ${root}`);
          return;
        }
      }
    } catch {
      // A root we cannot write into cannot be probed; trust the native watcher.
    } finally {
      this.probeObservers.delete(probePath);
      await rm(probePath, { force: true }).catch(() => {});
    }
  }

  /** Resolve true when the probe came back, false when it is time to rewrite it. */
  private raceProbe(observed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.probeTimers.delete(timer);
        resolve(false);
      }, PROBE_RETRY_MS);
      this.probeTimers.add(timer);
      void observed.then(() => {
        clearTimeout(timer);
        this.probeTimers.delete(timer);
        resolve(true);
      });
    });
  }

  private handleNativeEvent(root: string, relativePath: string | Buffer | null): void {
    if (this.closed || typeof relativePath !== "string") return;

    const path = join(root, relativePath);
    if (basename(path).startsWith(PROBE_PREFIX)) {
      this.probeObservers.get(path)?.();
      return;
    }
    if (this.ignored(path)) return;

    // macOS reports a mutation of the watched directory itself under the root's
    // own basename, which reads as a child path that never existed.
    const describesRootItself = relativePath === basename(root);

    const existingTimer = this.debounceByPath.get(path);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    this.debounceByPath.set(
      path,
      setTimeout(() => {
        this.debounceByPath.delete(path);
        void this.classifyAndEmit(path, describesRootItself);
      }, DEBOUNCE_MS),
    );
  }

  private async classifyAndEmit(path: string, describesRootItself: boolean): Promise<void> {
    try {
      const stats = await stat(path);
      if (!this.closed && stats.isFile() && !this.ignored(path, stats)) {
        this.emit("change", path);
      }
    } catch (error) {
      if (!this.closed && hasErrorCode(error, "ENOENT")) {
        if (describesRootItself) return;
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
): RecursiveWatcher {
  return new RecursiveWatcherImpl(roots, ignored);
}
