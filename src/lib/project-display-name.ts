import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { encodeProjectPath } from "./memory.js";

export interface KnownProjectName {
  id: string;
  name: string;
  projectPath: string | null;
}

export interface DeriveProjectDisplayNameOptions {
  workspaceRoots?: readonly string[];
  directoryExists?: (path: string) => boolean;
}

/** Hidden worktree container directories, e.g. ".claude-worktrees", ".llm-worktrees". */
const WORKTREE_DIR_PATTERN = /^\.[A-Za-z0-9_]+-worktrees$/;

/**
 * The encoded form of "/.<tool>-worktrees/": the slash always becomes "-",
 * while the dot is either encoded to "-" (older ids) or kept verbatim.
 */
const ENCODED_WORKTREE_MARKER = /(?:--|-\.)[A-Za-z0-9_]+-worktrees-/;

const UUID_SEGMENT_PREFIX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-/;

function defaultWorkspaceRoots(): string[] {
  const home = homedir();
  return [home, join(home, "projects"), "/tmp", "/private/tmp"];
}

function defaultDirectoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The pre-fix naming rule: the final hyphen-delimited token of the encoded id. */
export function lastEncodedSegment(encodedId: string): string {
  const segments = encodedId.split("-");
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment) return segment;
  }
  return encodedId;
}

/**
 * Derive a meaningful, unique display name for a Claude project directory.
 *
 * The encoded id collapses every "/", "." and "_" to "-", so the last hyphen
 * token alone produces names like "4" or "format" for worktree checkouts.
 * This resolves names from the decoded path when one is known, renders
 * worktrees and nested checkouts as "parent/worktree", and only falls back to
 * the lossy final token when nothing better can be recovered.
 */
export function deriveProjectDisplayName(
  encodedId: string,
  projectPath: string | null,
  knownProjects: readonly KnownProjectName[],
  options?: DeriveProjectDisplayNameOptions,
): string {
  const workspaceRoots = options?.workspaceRoots ?? defaultWorkspaceRoots();
  const directoryExists = options?.directoryExists ?? defaultDirectoryExists;

  if (projectPath) {
    const fromPath = nameFromProjectPath(encodedId, projectPath, knownProjects, workspaceRoots);
    if (fromPath) return fromPath;
  }
  return nameFromEncodedId(encodedId, knownProjects, workspaceRoots, directoryExists);
}

function nameFromProjectPath(
  encodedId: string,
  projectPath: string,
  knownProjects: readonly KnownProjectName[],
  workspaceRoots: readonly string[],
): string | null {
  const segments = projectPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const worktreeIndex = segments.findIndex((segment) => WORKTREE_DIR_PATTERN.test(segment));
  if (worktreeIndex > 0 && worktreeIndex < segments.length - 1) {
    return `${segments[worktreeIndex - 1]}/${segments.slice(worktreeIndex + 1).join("/")}`;
  }

  const ancestor = deepestKnownAncestor(encodedId, projectPath, knownProjects, workspaceRoots);
  if (ancestor?.projectPath) {
    return `${ancestor.name}${projectPath.slice(ancestor.projectPath.length)}`;
  }

  return segments[segments.length - 1] ?? null;
}

function deepestKnownAncestor(
  encodedId: string,
  projectPath: string,
  knownProjects: readonly KnownProjectName[],
  workspaceRoots: readonly string[],
): KnownProjectName | null {
  let deepest: KnownProjectName | null = null;
  for (const known of knownProjects) {
    if (known.id === encodedId || !known.projectPath) continue;
    if (workspaceRoots.includes(known.projectPath)) continue;
    if (!projectPath.startsWith(`${known.projectPath}/`)) continue;
    if (!deepest?.projectPath || known.projectPath.length > deepest.projectPath.length) {
      deepest = known;
    }
  }
  return deepest;
}

function nameFromEncodedId(
  encodedId: string,
  knownProjects: readonly KnownProjectName[],
  workspaceRoots: readonly string[],
  directoryExists: (path: string) => boolean,
): string {
  const marker = ENCODED_WORKTREE_MARKER.exec(encodedId);
  if (marker && marker.index > 0) {
    const base = encodedId.slice(0, marker.index);
    const leaf = encodedId.slice(marker.index + marker[0].length);
    if (leaf) {
      const baseKnown = knownProjects.find((known) => known.id === base);
      const baseName =
        baseKnown?.name ?? nameFromEncodedId(base, knownProjects, workspaceRoots, directoryExists);
      return `${baseName}/${leaf}`;
    }
  }

  const parentMatch = bestKnownParentMatch(encodedId, knownProjects, workspaceRoots);
  if (parentMatch) {
    const rest = encodedId.slice(parentMatch.restStart).replace(UUID_SEGMENT_PREFIX, "");
    if (rest) {
      const { known, isPrefix } = parentMatch;
      // "<parent>-<rest>" decodes to either the nested checkout
      // "<parentPath>/<rest>" or the peer directory "<parentPath>-<rest>".
      // Trust whichever one actually exists on disk before guessing nested.
      if (isPrefix && known.projectPath) {
        const nestedPath = `${known.projectPath}/${rest}`;
        const peerPath = `${known.projectPath}-${rest}`;
        if (!directoryExists(nestedPath) && directoryExists(peerPath)) {
          return lastPathSegment(peerPath) ?? `${known.name}/${rest}`;
        }
      }
      return `${known.name}/${rest}`;
    }
  }

  return lastEncodedSegment(encodedId);
}

interface KnownParentMatch {
  known: KnownProjectName;
  restStart: number;
  isPrefix: boolean;
}

/**
 * Find the longest known project id that appears in the encoded id, either as
 * a leading prefix (nested checkout / worktree) or embedded at a hyphen
 * boundary (scratchpad dirs under /private/tmp embed their owning project's
 * encoded id). Workspace roots like "~" and "~/projects" are containers, not
 * parents, so they never contribute a "parent/" prefix.
 */
function bestKnownParentMatch(
  encodedId: string,
  knownProjects: readonly KnownProjectName[],
  workspaceRoots: readonly string[],
): KnownParentMatch | null {
  const rootIds = new Set(workspaceRoots.map(encodeProjectPath));
  let best: KnownParentMatch | null = null;
  for (const known of knownProjects) {
    if (known.id === encodedId || rootIds.has(known.id)) continue;
    if (known.projectPath && workspaceRoots.includes(known.projectPath)) continue;

    const needle = `${known.id}-`;
    let matchStart = -1;
    if (encodedId.startsWith(needle)) {
      matchStart = 0;
    } else {
      const embedded = encodedId.indexOf(`-${needle}`);
      if (embedded >= 0) matchStart = embedded + 1;
    }
    if (matchStart < 0) continue;

    if (
      !best ||
      known.id.length > best.known.id.length ||
      (known.id.length === best.known.id.length && matchStart === 0 && !best.isPrefix)
    ) {
      best = { known, restStart: matchStart + needle.length, isPrefix: matchStart === 0 };
    }
  }
  return best;
}

function lastPathSegment(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? null;
}
