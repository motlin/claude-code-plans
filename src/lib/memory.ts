import { readdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { extractTitle } from "./markdown-utils.js";

interface MemoryEntry {
  filename: string;
  title: string;
  mtime: Date;
  project: string;
  projectName: string;
}

interface ProjectGroup {
  project: string;
  projectName: string;
  memories: MemoryEntry[];
}

export function encodeProjectPath(dirPath: string): string {
  return dirPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function decodeProjectDir(encoded: string, projectPath?: string): string {
  if (projectPath) {
    const segments = projectPath.split("/");
    const last = segments[segments.length - 1];
    if (last) return last;
  }

  const segments = encoded.split("-");
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment) return segment;
  }
  return encoded;
}

const resolvedProjectNames = new Map<string, string>();

export async function resolveProjectName(encoded: string, projectPath?: string): Promise<string> {
  if (projectPath) {
    const segments = projectPath.split("/");
    const last = segments[segments.length - 1];
    if (last) return last;
  }

  const cached = resolvedProjectNames.get(encoded);
  if (cached) return cached;

  const resolvedPath = await resolveProjectPath(encoded);
  if (resolvedPath) {
    const segments = resolvedPath.split("/");
    const name = segments[segments.length - 1]!;
    resolvedProjectNames.set(encoded, name);
    return name;
  }

  // The encoding is lossy, so only the final segment is safe as a display name.
  const name = decodeProjectDir(encoded);
  resolvedProjectNames.set(encoded, name);
  return name;
}

const resolvedProjectPaths = new Map<string, string | null>();

/**
 * Resolve the filesystem path for a Claude project directory name.
 * e.g. "-Users-craig-projects-claude-code-plans" -> "/Users/craig/projects/claude-code-plans"
 */
export async function resolveProjectPath(encoded: string): Promise<string | null> {
  const cached = resolvedProjectPaths.get(encoded);
  if (cached !== undefined) return cached;

  const chars = encoded.slice(1); // remove leading -
  const hyphenPositions: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "-") hyphenPositions.push(i);
  }

  for (let i = hyphenPositions.length - 1; i >= 0; i--) {
    const pos = hyphenPositions[i]!;
    const pathPart = "/" + chars.slice(0, pos).replace(/-/g, "/");
    const namePart = chars.slice(pos + 1);
    const candidate = pathPart + "/" + namePart;
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) {
        resolvedProjectPaths.set(encoded, candidate);
        return candidate;
      }
    } catch {
      // not a valid path, try next
    }
  }

  resolvedProjectPaths.set(encoded, null);
  return null;
}

async function processProject(projectsDir: string, project: string): Promise<ProjectGroup | null> {
  const memDir = join(projectsDir, project, "memory");
  let files: string[];
  try {
    files = await readdir(memDir);
  } catch {
    return null;
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return null;

  const projectName = await resolveProjectName(project);

  const entries = await Promise.all(
    mdFiles.map(async (filename) => {
      const filePath = join(memDir, filename);
      try {
        const fileStat = await stat(filePath);
        const title = await extractTitle(filePath, filename);
        return {
          filename,
          title,
          mtime: fileStat.mtime,
          project,
          projectName,
        };
      } catch {
        return null;
      }
    }),
  );
  const memories = entries.filter((entry): entry is MemoryEntry => entry !== null);
  if (memories.length === 0) return null;

  memories.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return { project, projectName, memories };
}

export async function listMemories(projectsDir: string): Promise<ProjectGroup[]> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  const results = await Promise.all(
    projectDirs.map((project) => processProject(projectsDir, project)),
  );
  const groups = results.filter((g): g is ProjectGroup => g !== null);

  const maxMtimes = new Map(
    groups.map((g) => [g.project, Math.max(...g.memories.map((m) => m.mtime.getTime()))]),
  );
  groups.sort((a, b) => maxMtimes.get(b.project)! - maxMtimes.get(a.project)!);

  return groups;
}

export async function readMemory(
  projectsDir: string,
  project: string,
  filename: string,
): Promise<string | null> {
  if (project.includes("..") || project.includes("/")) return null;
  if (filename.includes("..") || filename.includes("/") || !filename.endsWith(".md")) return null;

  try {
    const filePath = join(projectsDir, project, "memory", filename);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function writeMemory(
  projectsDir: string,
  project: string,
  filename: string,
  content: string,
): Promise<boolean> {
  if (project.includes("..") || project.includes("/")) return false;
  if (filename.includes("..") || filename.includes("/") || !filename.endsWith(".md")) return false;
  await writeFile(join(projectsDir, project, "memory", filename), content, "utf-8");
  return true;
}

export async function deleteMemory(
  projectsDir: string,
  project: string,
  filename: string,
): Promise<boolean> {
  if (project.includes("..") || project.includes("/")) return false;
  if (filename.includes("..") || filename.includes("/") || !filename.endsWith(".md")) return false;

  try {
    await unlink(join(projectsDir, project, "memory", filename));
    return true;
  } catch {
    return false;
  }
}

export function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}
