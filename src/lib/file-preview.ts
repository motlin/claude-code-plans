/**
 * Shared by the file API and the unified file viewer: which files render as
 * images, how a file's type and size read in the "{type} · {size}" line, and
 * which tab sizes the Files pane offers.
 */

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? null : name.slice(dot + 1).toLowerCase();
}

/** The `image/*` content type the viewer shows as a picture, or null for everything else. */
export function imageContentType(path: string): string | null {
  const extension = extensionOf(path);
  return extension === null ? null : (IMAGE_CONTENT_TYPES[extension] ?? null);
}

export function isMarkdownPath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === "md" || extension === "markdown" || extension === "mdx";
}

/** "PNG file", or "File" when the name has no extension. */
export function fileTypeLabel(path: string): string {
  const extension = extensionOf(path);
  return extension === null ? "File" : `${extension.toUpperCase()} file`;
}

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

export const FILE_TAB_SIZES = [2, 4, 8] as const;
export type FileTabSize = (typeof FILE_TAB_SIZES)[number];

export function normalizeFileTabSize(value: number): FileTabSize {
  return FILE_TAB_SIZES.find((size) => size === value) ?? 4;
}
