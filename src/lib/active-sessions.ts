import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveProjectName } from "./memory";
import { getActiveSessionEntries } from "./active-session-store";
import { ACTIVE_SESSION_WINDOW_MS } from "./active-session-window";

export interface ActiveSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  lastModified: number;
}

export async function scanActiveSessions(
  activeTimeoutMs = ACTIVE_SESSION_WINDOW_MS,
): Promise<ActiveSession[]> {
  // Build both views and union them: the hook-driven store (accurate liveness,
  // richer project/cwd info) and the filesystem mtime scan (catches sessions
  // whose hooks never registered, e.g. the current one). Either alone is lossy,
  // so a session shows up if *either* source knows about it.
  const [storeSessions, fsSessions] = await Promise.all([
    getActiveSessionsFromStore(getActiveSessionEntries()),
    getActiveSessionsFromFilesystem(activeTimeoutMs),
  ]);

  // Dedup by sessionId, keeping the entry with the fresher lastModified. Store
  // entries are visited first, so on a tie they win (richer project/cwd info).
  const bySessionId = new Map<string, ActiveSession>();
  for (const session of [...storeSessions, ...fsSessions]) {
    const existing = bySessionId.get(session.sessionId);
    if (!existing || session.lastModified > existing.lastModified) {
      bySessionId.set(session.sessionId, session);
    }
  }

  return [...bySessionId.values()].sort((a, b) => b.lastModified - a.lastModified);
}

async function getActiveSessionsFromStore(
  entries: ReturnType<typeof getActiveSessionEntries>,
): Promise<ActiveSession[]> {
  const sorted = [...entries].sort((a, b) => b.lastActivity - a.lastActivity);
  const nameCache = new Map<string, string>();
  const result: ActiveSession[] = [];

  for (const entry of sorted) {
    // Resolve project dir from cwd — look for matching project dirs
    const projectDir = await findProjectDirForCwd(entry.cwd);
    if (!projectDir) continue;

    result.push({
      sessionId: entry.sessionId,
      projectDir,
      projectName: await resolveProjectNameCached(nameCache, projectDir),
      lastModified: entry.lastActivity,
    });
  }
  return result;
}

async function resolveProjectNameCached(
  cache: Map<string, string>,
  projectDir: string,
): Promise<string> {
  const cached = cache.get(projectDir);
  if (cached) return cached;
  const name = await resolveProjectName(projectDir);
  cache.set(projectDir, name);
  return name;
}

async function findProjectDirForCwd(cwd: string): Promise<string | null> {
  if (!cwd) return null;
  const projectsDir = join(homedir(), ".claude", "projects");
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return null;
  }
  // The project dir name is an encoded form of the cwd path
  // Try to find a dir whose decoded name matches the cwd
  for (const dir of dirs) {
    const decoded = await resolveProjectName(dir);
    if (decoded === cwd || cwd.endsWith(decoded)) return dir;
  }
  return null;
}

async function getActiveSessionsFromFilesystem(
  activeThresholdMs: number,
): Promise<ActiveSession[]> {
  const projectsDir = join(homedir(), ".claude", "projects");
  const now = Date.now();
  const active: Array<Omit<ActiveSession, "projectName"> & { projectDir: string }> = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return [];
  }

  for (const dir of projectDirs) {
    const projectPath = join(projectsDir, dir);
    let files: string[];
    try {
      files = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(projectPath, file);
      try {
        const st = statSync(filePath);
        if (now - st.mtimeMs < activeThresholdMs) {
          active.push({
            sessionId: file.replace(/\.jsonl$/, ""),
            projectDir: dir,
            lastModified: st.mtimeMs,
          });
        }
      } catch {
        continue;
      }
    }
  }

  active.sort((a, b) => b.lastModified - a.lastModified);

  const nameCache = new Map<string, string>();
  const result: ActiveSession[] = [];
  for (const s of active) {
    result.push({ ...s, projectName: await resolveProjectNameCached(nameCache, s.projectDir) });
  }
  return result;
}
