import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Generic source-view kinds. Each kind maps to a known root directory under ~/.claude/
 * and an allowed file extension. A "source path" identifies a file relative to that root.
 */
type SourceKind = "plan" | "memory" | "task" | "command";

export interface SourceKindConfig {
  root: string;
  extension: ".md" | ".json";
  language: "markdown" | "json";
}

export interface SourceFile {
  kind: SourceKind;
  relativePath: string;
  absolutePath: string;
  content: string;
  language: "markdown" | "json";
  mtime: Date;
}

/**
 * Resolve a kind + relative path to an absolute path inside the kind's root.
 * Returns null when the relative path tries to escape the root or has the wrong extension.
 */
export function resolveSourcePath(config: SourceKindConfig, relativePath: string): string | null {
  if (!relativePath || relativePath.length === 0) return null;
  if (relativePath.startsWith("/") || relativePath.startsWith(sep)) return null;
  if (!relativePath.endsWith(config.extension)) return null;

  const segments = relativePath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }

  const rootResolved = resolve(config.root);
  const candidate = resolve(rootResolved, relativePath);
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (candidate !== rootResolved && !candidate.startsWith(prefix)) return null;
  return candidate;
}

export async function readSourceFile(
  kind: SourceKind,
  config: SourceKindConfig,
  relativePath: string,
): Promise<SourceFile | null> {
  const absolutePath = resolveSourcePath(config, relativePath);
  if (!absolutePath) return null;

  try {
    const [content, fileStat] = await Promise.all([
      readFile(absolutePath, "utf-8"),
      stat(absolutePath),
    ]);
    return {
      kind,
      relativePath,
      absolutePath,
      content,
      language: config.language,
      mtime: fileStat.mtime,
    };
  } catch {
    return null;
  }
}

export function buildSourceConfig(kind: SourceKind, claudeHome: string): SourceKindConfig | null {
  switch (kind) {
    case "plan":
      return {
        root: join(claudeHome, "plans"),
        extension: ".md",
        language: "markdown",
      };
    case "memory":
      return {
        root: join(claudeHome, "projects"),
        extension: ".md",
        language: "markdown",
      };
    case "task":
      return {
        root: join(claudeHome, "tasks"),
        extension: ".json",
        language: "json",
      };
    case "command":
      return null; // commands live in plugin trees; not supported via this generic helper yet
  }
}

export function isValidSourceKind(value: string): value is SourceKind {
  return value === "plan" || value === "memory" || value === "task" || value === "command";
}
