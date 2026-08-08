import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const MAX_GIT_OUTPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_REFRESH_DEBOUNCE_MILLISECONDS = 50;

interface TrackedFilesEntry {
  files: Set<string>;
  indexMtimeMilliseconds: number;
}

interface RefreshWaiter {
  resolve(files: Set<string>): void;
  reject(error: unknown): void;
}

/** Return whether a directory has a Git directory or worktree marker. */
export function isGitRepository(directory: string): boolean {
  const gitMarker = join(resolve(directory), ".git");
  if (!existsSync(gitMarker)) return false;

  const markerStat = statSync(gitMarker);
  return markerStat.isDirectory() || markerStat.isFile();
}

/** List the cached Git index entries as absolute paths. */
export function listTrackedFiles(root: string): Promise<string[]> {
  const resolvedRoot = resolve(root);
  return new Promise((resolveFiles, rejectFiles) => {
    execFile(
      "git",
      ["-C", resolvedRoot, "ls-files", "-z", "--cached"],
      { encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES },
      (error, stdout) => {
        if (error) {
          rejectFiles(error);
          return;
        }

        resolveFiles(
          stdout
            .split("\0")
            .filter((path) => path.length > 0)
            .map((path) => resolve(resolvedRoot, path)),
        );
      },
    );
  });
}

function gitIndexPath(root: string): string {
  const gitMarker = join(root, ".git");
  const markerStat = statSync(gitMarker);
  if (markerStat.isDirectory()) return join(gitMarker, "index");

  const gitDirectoryMarker = "gitdir: ";
  const markerContents = readFileSync(gitMarker, "utf8").trim();
  if (!markerContents.startsWith(gitDirectoryMarker)) {
    throw new Error(`Invalid Git directory marker: ${gitMarker}`);
  }

  const gitDirectory = markerContents.slice(gitDirectoryMarker.length);
  return join(
    isAbsolute(gitDirectory) ? gitDirectory : resolve(dirname(gitMarker), gitDirectory),
    "index",
  );
}

function indexMtimeMilliseconds(root: string): number {
  const indexPath = gitIndexPath(root);
  return existsSync(indexPath) ? statSync(indexPath).mtimeMs : -1;
}

/** Cache tracked files by repository and coalesce bursts of index refreshes. */
export class TrackedFileIndex {
  private readonly entriesByRoot = new Map<string, TrackedFilesEntry>();
  private readonly refreshTimersByRoot = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refreshWaitersByRoot = new Map<string, RefreshWaiter[]>();

  constructor(
    private readonly refreshDebounceMilliseconds = DEFAULT_REFRESH_DEBOUNCE_MILLISECONDS,
  ) {
    if (!Number.isInteger(refreshDebounceMilliseconds) || refreshDebounceMilliseconds < 0) {
      throw new RangeError("Refresh debounce must be a non-negative integer");
    }
  }

  has(root: string, path: string): boolean {
    return this.entriesByRoot.get(resolve(root))?.files.has(resolve(path)) ?? false;
  }

  snapshot(root: string): Set<string> {
    return new Set(this.entriesByRoot.get(resolve(root))?.files ?? []);
  }

  refresh(root: string): Promise<Set<string>> {
    const resolvedRoot = resolve(root);
    const existingTimer = this.refreshTimersByRoot.get(resolvedRoot);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const refreshPromise = new Promise<Set<string>>((resolveRefresh, rejectRefresh) => {
      const waiters = this.refreshWaitersByRoot.get(resolvedRoot) ?? [];
      waiters.push({ resolve: resolveRefresh, reject: rejectRefresh });
      this.refreshWaitersByRoot.set(resolvedRoot, waiters);
    });

    this.refreshTimersByRoot.set(
      resolvedRoot,
      setTimeout(() => {
        this.refreshTimersByRoot.delete(resolvedRoot);
        const waiters = this.refreshWaitersByRoot.get(resolvedRoot) ?? [];
        this.refreshWaitersByRoot.delete(resolvedRoot);

        void this.refreshNow(resolvedRoot).then(
          (files) => {
            for (const waiter of waiters) waiter.resolve(new Set(files));
          },
          (error: unknown) => {
            for (const waiter of waiters) waiter.reject(error);
          },
        );
      }, this.refreshDebounceMilliseconds),
    );

    return refreshPromise;
  }

  private async refreshNow(root: string): Promise<Set<string>> {
    const currentIndexMtimeMilliseconds = indexMtimeMilliseconds(root);
    const existingEntry = this.entriesByRoot.get(root);
    if (existingEntry?.indexMtimeMilliseconds === currentIndexMtimeMilliseconds) {
      return existingEntry.files;
    }

    const files = new Set(await listTrackedFiles(root));
    this.entriesByRoot.set(root, {
      files,
      indexMtimeMilliseconds: currentIndexMtimeMilliseconds,
    });
    return files;
  }
}
