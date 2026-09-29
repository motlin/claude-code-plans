import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ghPrLookup,
  parseGhPrList,
  parseGhPrStatusCache,
  parseGhPrView,
  resolvePrStatus,
  type PrStatus,
} from "./pr-status";
import type { SessionEntry, SessionPrLink } from "./sessions";

/** Runs `gh <args>` (argv, never a shell) in `cwd` and resolves its stdout. */
export type GhRunner = (args: string[], cwd: string | undefined) => Promise<string>;

export interface PrStatusTarget {
  projectId: string;
  prLink: SessionPrLink | undefined;
  cwd: string | undefined;
  branch: string | undefined;
  /** Last transcript activity; `gh` is only asked about recently active sessions. */
  mtimeMs: number;
}

export interface PrStatusService {
  /** The best known PR status right now; never waits on `gh` or the disk. */
  lookup(target: PrStatusTarget): PrStatus | null;
  /** Resolves once every queued refresh has settled (for tests). */
  idle(): Promise<void>;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OPEN_TTL_MS = 5 * MINUTE;
const FINAL_TTL_MS = 6 * HOUR;
const MAX_BACKOFF_MS = HOUR;

interface GhEntry {
  value: PrStatus | null;
  retryAt: number;
  failures: number;
  pending: boolean;
  projects: Set<string>;
}

function sameStatus(a: PrStatus | null, b: PrStatus | null): boolean {
  return a?.number === b?.number && a?.state === b?.state;
}

/**
 * In-memory PR state for session rows. Sources, in order: the indexed `pr-link` record, the
 * statusline's gh-pr-status-cache.json, then `gh` (serialized, cached with a TTL, exponential
 * backoff on failure). Lookups answer from memory and queue refreshes in the background;
 * `onChange` fires with the project id of every session whose answer changed.
 */
export function createPrStatusService({
  runGh,
  readCacheFile,
  now = Date.now,
  onChange,
  cacheFileTtlMs = MINUTE,
  lookupWindowMs = 14 * DAY,
}: {
  runGh: GhRunner;
  readCacheFile: () => Promise<string | null>;
  now?: () => number;
  onChange: (projectId: string) => void;
  cacheFileTtlMs?: number;
  lookupWindowMs?: number;
}): PrStatusService {
  let cacheFile = new Map<string, PrStatus>();
  let cacheFileReadAt: number | null = null;
  let cacheFileLoad: Promise<void> | null = null;
  const projectsByUrl = new Map<string, Set<string>>();
  const ghEntries = new Map<string, GhEntry>();
  let queue: Promise<void> = Promise.resolve();
  let ghMissing = false;

  function ensureCacheFile(): Promise<void> {
    if (cacheFileLoad !== null) return cacheFileLoad;
    if (cacheFileReadAt !== null && now() - cacheFileReadAt < cacheFileTtlMs) {
      return Promise.resolve();
    }
    cacheFileLoad = readCacheFile()
      .then((text) => {
        const next = text === null ? new Map<string, PrStatus>() : parseGhPrStatusCache(text);
        const changed = new Set<string>();
        for (const url of new Set([...cacheFile.keys(), ...next.keys()])) {
          if (sameStatus(cacheFile.get(url) ?? null, next.get(url) ?? null)) continue;
          for (const projectId of projectsByUrl.get(url) ?? []) changed.add(projectId);
        }
        cacheFile = next;
        for (const projectId of changed) onChange(projectId);
      })
      .catch(() => undefined)
      .finally(() => {
        cacheFileReadAt = now();
        cacheFileLoad = null;
      });
    return cacheFileLoad;
  }

  async function refresh(
    entry: GhEntry,
    target: PrStatusTarget,
    args: string[],
    cwd: string | undefined,
    kind: "view" | "list",
  ) {
    try {
      await ensureCacheFile();
      if (target.prLink !== undefined && cacheFile.has(target.prLink.url)) {
        entry.retryAt = now() + cacheFileTtlMs;
        return;
      }
      const stdout = await runGh(args, cwd);
      const value = kind === "view" ? parseGhPrView(stdout) : parseGhPrList(stdout);
      entry.failures = 0;
      entry.retryAt =
        now() +
        (value?.state === "merged" || value?.state === "closed" ? FINAL_TTL_MS : OPEN_TTL_MS);
      if (!sameStatus(entry.value, value)) {
        entry.value = value;
        for (const projectId of entry.projects) onChange(projectId);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") ghMissing = true;
      entry.failures += 1;
      entry.retryAt = now() + Math.min(MINUTE * 2 ** (entry.failures - 1), MAX_BACKOFF_MS);
    } finally {
      entry.pending = false;
    }
  }

  function lookup(target: PrStatusTarget): PrStatus | null {
    const { prLink } = target;
    if (prLink !== undefined) {
      const projects = projectsByUrl.get(prLink.url) ?? new Set<string>();
      projects.add(target.projectId);
      projectsByUrl.set(prLink.url, projects);
    }
    void ensureCacheFile();

    const request = ghPrLookup(target);
    let entry: GhEntry | undefined;
    if (request !== null) {
      entry = ghEntries.get(request.key);
      if (entry === undefined) {
        entry = { value: null, retryAt: 0, failures: 0, pending: false, projects: new Set() };
        ghEntries.set(request.key, entry);
      }
      entry.projects.add(target.projectId);
      const eligible =
        !ghMissing &&
        !entry.pending &&
        now() >= entry.retryAt &&
        now() - target.mtimeMs < lookupWindowMs &&
        !(prLink !== undefined && cacheFile.has(prLink.url));
      if (eligible) {
        entry.pending = true;
        const queued = entry;
        queue = queue.then(() => refresh(queued, target, request.args, request.cwd, request.kind));
      }
    }
    return resolvePrStatus({ prLink, cacheFile, gh: entry?.value ?? null });
  }

  async function idle(): Promise<void> {
    let settled: Promise<void> | null = null;
    while (settled !== queue || cacheFileLoad !== null) {
      settled = queue;
      await Promise.all([queue, cacheFileLoad]);
    }
  }

  return { lookup, idle };
}

const GH_TIMEOUT_MS = 15 * 1000;

function runGhCommand(args: string[], cwd: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      {
        cwd,
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function readGhPrStatusCacheFile(): Promise<string | null> {
  try {
    return await readFile(join(homedir(), ".claude", "gh-pr-status-cache.json"), "utf8");
  } catch {
    return null;
  }
}

let service: PrStatusService | null = null;

/** Start answering PR lookups at server startup; tests never call this, so they never run `gh`. */
export function initPrStatusService(onChange: (projectId: string) => void): void {
  service = createPrStatusService({
    runGh: runGhCommand,
    readCacheFile: readGhPrStatusCacheFile,
    onChange,
  });
}

/** A session row's PR status, or null before `initPrStatusService` (tests) or without data. */
export function lookupSessionPrStatus(entry: SessionEntry): PrStatus | null {
  return (
    service?.lookup({
      projectId: entry.project,
      prLink: entry.pr,
      cwd: entry.cwd,
      branch: entry.gitBranch,
      mtimeMs: entry.mtime.getTime(),
    }) ?? null
  );
}
