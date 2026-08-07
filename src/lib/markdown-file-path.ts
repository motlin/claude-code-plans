import { basename, dirname, resolve } from "node:path";

export function resolveMarkdownFilePath(directory: string, filename: string): string | null {
  if (filename.includes("..") || basename(filename) !== filename || !filename.endsWith(".md")) {
    return null;
  }

  const resolvedDirectory = resolve(directory);
  const resolvedFilePath = resolve(resolvedDirectory, filename);
  return dirname(resolvedFilePath) === resolvedDirectory ? resolvedFilePath : null;
}
