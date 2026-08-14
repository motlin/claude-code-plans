import type { SyntheticEvent } from "react";

export const SESSION_IMAGE_CLASS_NAME =
  "max-w-full max-h-96 rounded-lg border border-border shadow-sm";

const IMAGE_PATH_PATTERN = /(?<![\w/])@?(\/[^\s'"`<>]+\.(?:png|jpe?g|webp|gif))/gi;

export function extractInlineImagePaths(text: string): string[] {
  IMAGE_PATH_PATTERN.lastIndex = 0;
  const paths = new Set<string>();
  let match = IMAGE_PATH_PATTERN.exec(text);
  while (match !== null) {
    const path = match[1];
    if (path !== undefined) paths.add(path);
    match = IMAGE_PATH_PATTERN.exec(text);
  }
  return [...paths];
}

function normalizeAbsolutePath(path: string): string | undefined {
  if (!path.startsWith("/")) return undefined;

  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

export function isPathInsideAllowedImageRoot(
  path: string,
  allowedRoots: readonly string[],
): boolean {
  const normalizedPath = normalizeAbsolutePath(path);
  if (normalizedPath === undefined) return false;

  return allowedRoots.some((root) => {
    const normalizedRoot = normalizeAbsolutePath(root);
    if (normalizedRoot === undefined) return false;
    return (
      normalizedRoot === "/" ||
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`)
    );
  });
}

function hideFailedImage(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = "none";
}

export function InlinePathImages({
  text,
  allowedRoots,
}: {
  text: string;
  allowedRoots: readonly string[];
}) {
  const paths = extractInlineImagePaths(text).filter((path) =>
    isPathInsideAllowedImageRoot(path, allowedRoots),
  );

  if (paths.length === 0) return null;

  return (
    <>
      {paths.map((path) => {
        const imageUrl = `/api/image?path=${encodeURIComponent(path)}`;
        return (
          <a
            key={path}
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-zoom-in"
          >
            <img
              src={imageUrl}
              alt={`Referenced image ${path}`}
              className={SESSION_IMAGE_CLASS_NAME}
              loading="lazy"
              onError={hideFailedImage}
            />
          </a>
        );
      })}
    </>
  );
}
