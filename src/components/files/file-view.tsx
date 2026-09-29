import { useQuery } from "@tanstack/react-query";
import { Code, Eye, FileX } from "lucide-react";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";

import { useShortcut, useShortcutKeys } from "../../hooks/use-shortcut";

import { ApiResponseError } from "../../lib/api/client";
import { fileContentUrl, fileViewQueryOptions } from "../../lib/api/file";
import { writeClipboardText } from "../../lib/clipboard";
import { formatAttachContext } from "../../lib/context-attach";
import {
  formatFileSize,
  imageContentType,
  isMarkdownPath,
  normalizeFileTabSize,
} from "../../lib/file-preview";
import { fromMdSlug } from "../../lib/md-slug";
import { FileViewer, fileViewerLanguage } from "../file-viewer";
import { MarkdownArticle } from "../markdown-article";
import { useSettings } from "../settings-provider";
import { useToast } from "../toast";
import { ContextMenu, ContextMenuTrigger, MenuContent } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { mentionPath, ViewerMenuItems } from "./file-context-menu";

/**
 * Sibling `.md` links render under this prefix; a click handler resolves them
 * against the file's own directory, since file routes are keyed by an opaque
 * path token rather than a directory and slug.
 */
const SIBLING_MD_BASE = "/__file-sibling";

export interface FileViewProps {
  /** Absolute path of the file. */
  path: string;
  /** Working directory; paths inside it show and copy relative to it. */
  cwd?: string | undefined;
  line?: number | undefined;
  endLine?: number | undefined;
  /** Follow `#L<n>` in the page URL; only the full-page `/file/$` route owns the hash. */
  hashNavigation?: boolean;
  /** Opens another file, such as a sibling `.md` link in rendered markdown. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** Sends an "Attach as context" snippet to the chat input; without it the viewer offers none. */
  onAttachContext?: ((snippet: string) => void) | undefined;
}

function displayPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined) return path;
  const prefix = `${cwd.replace(/\/+$/, "")}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** The subheader's `dir / dir / name` breadcrumb, which copies the path when clicked. */
function Breadcrumb({ path }: { path: string }) {
  const toast = useToast();
  const segments = path.split("/");
  const copy = async () => {
    const copied = await writeClipboardText(path);
    toast(
      copied
        ? { kind: "success", message: "Path copied to clipboard." }
        : { kind: "error", message: "Couldn’t copy the path." },
    );
  };
  return (
    <button
      type="button"
      title={path}
      aria-label={`Copy path ${path}`}
      onClick={() => void copy()}
      className="-mx-0.75 flex min-w-0 flex-1 cursor-pointer rounded-r3 text-left text-body text-secondary hover:bg-fill-ghost-hover"
    >
      <span className="-mx-1 -my-1 flex min-w-0 overflow-x-auto px-1 py-1 whitespace-nowrap [direction:rtl] [scrollbar-width:none]">
        <span dir="ltr" className="flex min-w-full shrink-0 items-baseline">
          {segments.map((segment, index) => {
            const isName = index === segments.length - 1;
            return (
              <span key={index} className="flex shrink-0 items-baseline">
                {segment !== "" && (
                  <span
                    data-breadcrumb-segment=""
                    className={`shrink-0 px-0.75 ${isName ? "" : "text-muted"}`}
                  >
                    {segment}
                  </span>
                )}
                {!isName && <span className="shrink-0 text-muted">/</span>}
              </span>
            );
          })}
        </span>
      </span>
    </button>
  );
}

function ViewerMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
      <FileX aria-hidden="true" className="size-7 text-t6" />
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-[36ch] text-pretty break-words text-body text-primary">{title}</p>
        {detail !== undefined && (
          <p className="max-w-[36ch] text-pretty break-all text-footnote text-t6">{detail}</p>
        )}
      </div>
      {children !== undefined && (
        <div className="flex flex-wrap items-center justify-center gap-1">{children}</div>
      )}
    </div>
  );
}

const MESSAGE_BUTTON =
  "inline-flex h-7 cursor-pointer items-center rounded-r5 border border-strong px-2.5 text-footnote text-primary hover:bg-fill-ghost-hover";

function ImageView({ path }: { path: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <ViewerMessage title="This image couldn’t be loaded. It may be too large, or it may have been deleted or moved." />
    );
  }
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-3">
      <img
        alt={path.slice(path.lastIndexOf("/") + 1)}
        src={fileContentUrl(path)}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

function lineNumberOf(node: Node): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const row = element?.closest<HTMLElement>('[role="row"][id^="L"]');
  if (row === null || row === undefined) return null;
  const line = Number(row.id.slice(1));
  return Number.isSafeInteger(line) && line > 0 ? line : null;
}

/**
 * The attach snippet for the page selection when it lies inside `container`:
 * whole source lines with their `#L` range, or the selected text of rendered
 * markdown. Null without such a selection.
 */
function selectionSnippet(
  container: HTMLElement | null,
  path: string,
  cwd: string | undefined,
  content: string | undefined,
): string | null {
  const selection = window.getSelection();
  if (container === null || selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null;
  const mention = mentionPath(path, cwd);
  const start = lineNumberOf(range.startContainer);
  const end = lineNumberOf(range.endContainer);
  if (start !== null && end !== null && content !== undefined) {
    return formatAttachContext({
      path: mention,
      range: { start, end },
      text: content
        .split("\n")
        .slice(start - 1, end)
        .join("\n"),
      language: fileViewerLanguage(path),
    });
  }
  const text = selection.toString();
  if (text.trim() === "") return null;
  return formatAttachContext({ path: mention, text, language: null });
}

function errorTitle(error: unknown): string {
  if (error instanceof ApiResponseError && error.status === 404) return "Couldn’t find this file";
  return "Can’t read this file";
}

/**
 * The one file viewer, used by the Files pane and the full-page `/file/$`
 * route: a Copy path breadcrumb, rendered markdown with a View source toggle,
 * Shiki source with wrap and tab size from the Files ⋯ menu, images, and the
 * binary / too-large states.
 */
export function FileView({
  path,
  cwd,
  line,
  endLine,
  hashNavigation = false,
  onOpenFile,
  onAttachContext,
}: FileViewProps) {
  const { settings } = useSettings();
  const [forceText, setForceText] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const isImage = imageContentType(path) !== null;
  const markdown = isMarkdownPath(path);
  const file = useQuery({ ...fileViewQueryOptions(path, forceText), enabled: !isImage });
  const viewerRef = useRef<HTMLDivElement>(null);
  const [menuSelection, setMenuSelection] = useState<string | null>(null);
  const attachKeys = useShortcutKeys("attach_selection");
  const content = file.data?.kind === "text" ? file.data.content : undefined;

  useShortcut(
    "attach_selection",
    () => {
      const snippet = selectionSnippet(viewerRef.current, path, cwd, content);
      if (snippet === null) return false;
      onAttachContext?.(snippet);
      return true;
    },
    { disabled: onAttachContext === undefined },
  );

  const openSiblingLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element).closest("a");
    const href = anchor?.getAttribute("href");
    if (onOpenFile === undefined || !href?.startsWith(`${SIBLING_MD_BASE}/`)) return;
    event.preventDefault();
    const slug = decodeURIComponent(href.slice(SIBLING_MD_BASE.length + 1).split("#")[0] ?? "");
    onOpenFile(`${directoryOf(path)}/${fromMdSlug(slug)}`);
  };

  const body = (): ReactNode => {
    if (isImage) return <ImageView path={path} />;
    if (file.isPending) return <ViewerMessage title="Loading file" />;
    if (file.isError) return <ViewerMessage title={errorTitle(file.error)} detail={path} />;
    const data = file.data;
    if (data.kind === "binary") {
      return (
        <ViewerMessage title="This file looks like binary data and can’t be previewed as text.">
          <button type="button" className={MESSAGE_BUTTON} onClick={() => setForceText(true)}>
            View as text anyway
          </button>
        </ViewerMessage>
      );
    }
    if (data.kind === "too-large") {
      return (
        <ViewerMessage
          title={`${data.type} · ${formatFileSize(data.size)}`}
          detail="It’s too large to preview here."
        >
          <a href={fileContentUrl(path, { download: true })} download className={MESSAGE_BUTTON}>
            Download
          </a>
        </ViewerMessage>
      );
    }
    if (data.content === "") return <ViewerMessage title="This file is empty." />;
    if (markdown && !showSource) {
      return (
        <div className="p-4" onClick={openSiblingLink}>
          <div className="mx-auto max-w-[860px]">
            <MarkdownArticle
              markdown={data.content}
              mdLinkBase={onOpenFile === undefined ? undefined : SIBLING_MD_BASE}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="px-2 pb-2">
        <FileViewer
          file={data}
          wrap={settings.filesWordWrap}
          tabSize={normalizeFileTabSize(settings.filesTabSize)}
          line={line}
          endLine={endLine}
          hashNavigation={hashNavigation}
        />
      </div>
    );
  };

  const canToggleSource = markdown && file.data?.kind === "text";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-3">
        <Breadcrumb path={displayPath(path, cwd)} />
        {canToggleSource && (
          <Tooltip content={showSource ? "Preview" : "View source"}>
            <button
              type="button"
              aria-label={showSource ? "Preview" : "View source"}
              onClick={() => setShowSource((shown) => !shown)}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
            >
              {showSource ? (
                <Eye aria-hidden="true" className="size-4" />
              ) : (
                <Code aria-hidden="true" className="size-4" />
              )}
            </button>
          </Tooltip>
        )}
      </div>
      <ContextMenu>
        <ContextMenuTrigger
          render={<div ref={viewerRef} />}
          data-file-viewer="true"
          className="min-h-0 flex-1 overflow-auto select-text"
          onContextMenu={() =>
            setMenuSelection(selectionSnippet(viewerRef.current, path, cwd, content))
          }
        >
          {body()}
        </ContextMenuTrigger>
        <MenuContent>
          <ViewerMenuItems
            path={path}
            cwd={cwd}
            content={content}
            line={line ?? 1}
            attachSnippet={() => menuSelection ?? `@${mentionPath(path, cwd)}`}
            onAttachContext={onAttachContext}
            attachShortcut={attachKeys.keys}
          />
        </MenuContent>
      </ContextMenu>
    </div>
  );
}
