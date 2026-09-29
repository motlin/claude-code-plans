import { useQuery } from "@tanstack/react-query";
import { Code, Eye, FileX } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useShortcut, useShortcutKeys } from "../../hooks/use-shortcut";

import { ApiResponseError } from "../../lib/api/client";
import { fileContentUrl, fileViewQueryOptions } from "../../lib/api/file";
import { writeClipboardText } from "../../lib/clipboard";
import type { AttachContextHandler, ContextAttachment } from "../../lib/context-attach";
import {
  formatFileSize,
  imageContentType,
  isMarkdownPath,
  normalizeFileTabSize,
} from "../../lib/file-preview";
import {
  firstMatchFromLine,
  lineMatchOffsets,
  lineOfMatch,
  stepMatch,
} from "../../lib/find-in-file";
import { editableMarkdownTarget } from "../../lib/file-edit";
import { fromMdSlug } from "../../lib/md-slug";
import { isMacPlatform } from "../../lib/shortcuts/match";
import { FileViewer, fileViewerLanguage } from "../file-viewer";
import { MarkdownArticle } from "../markdown-article";
import { useSettings } from "../settings-provider";
import { useToast } from "../toast";
import { ContextMenu, ContextMenuTrigger, MenuContent } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { mentionPath, ViewerMenuItems } from "./file-context-menu";
import {
  clearFindHighlights,
  collectFindBlocks,
  FindBar,
  paintFindHighlights,
} from "./find-in-file";
import { useMarkdownEdit } from "./markdown-edit";

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
  /** The content search query that opened the file, handed to find in file. */
  findQuery?: string | undefined;
  /** Follow `#L<n>` in the page URL; only the full-page `/file/$` route owns the hash. */
  hashNavigation?: boolean;
  /** Opens another file, such as a sibling `.md` link in rendered markdown. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** Sends an "Attach as context" snippet to the chat input; without it the viewer offers none. */
  onAttachContext?: AttachContextHandler | undefined;
  /** Starting an edit of a plan or memory; the Files pane pins the tab. */
  onEditStart?: (() => void) | undefined;
  /** Whether the file has unsaved edits, for the pane's leave-tab guard. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
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
 * The attachment for the page selection when it lies inside `container`:
 * whole source lines with their `#L` range, or the selected text of rendered
 * markdown. Null without such a selection.
 */
function selectionAttachment(
  container: HTMLElement | null,
  path: string,
  cwd: string | undefined,
  content: string | undefined,
): ContextAttachment | null {
  const selection = window.getSelection();
  if (container === null || selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null;
  const mention = mentionPath(path, cwd);
  const start = lineNumberOf(range.startContainer);
  const end = lineNumberOf(range.endContainer);
  if (start !== null && end !== null && content !== undefined) {
    return {
      kind: "selection",
      path: mention,
      range: { start, end },
      text: content
        .split("\n")
        .slice(start - 1, end)
        .join("\n"),
      language: fileViewerLanguage(path),
    };
  }
  const text = selection.toString();
  if (text.trim() === "") return null;
  return { kind: "selection", path: mention, text, language: null };
}

function errorTitle(error: unknown): string {
  if (error instanceof ApiResponseError && error.status === 404) return "Couldn’t find this file";
  return "Can’t read this file";
}

function isFindShortcut(event: KeyboardEvent): boolean {
  const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
}

/**
 * Find in file: a ⌘F bar claimed only while focus is inside the pane. Source
 * view counts matches from the file text, since virtualized rows may not be
 * mounted, and numbers the mounted rows' ranges from each line's offset;
 * rendered markdown counts what is in the DOM.
 */
function useFindInFile({
  viewerRef,
  content,
  sourceMode,
  line,
  findQuery,
}: {
  viewerRef: RefObject<HTMLDivElement | null>;
  content: string | undefined;
  sourceMode: boolean;
  line: number | undefined;
  findQuery: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeState, setActiveState] = useState(0);
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [domTotal, setDomTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const scrolledRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState(0);

  // A content search hit opens the bar prefilled, on the match at its line.
  const [seenTarget, setSeenTarget] = useState<{ findQuery?: string; line?: number }>({});
  if (seenTarget.findQuery !== findQuery || seenTarget.line !== line) {
    setSeenTarget({
      ...(findQuery === undefined ? {} : { findQuery }),
      ...(line === undefined ? {} : { line }),
    });
    if (findQuery !== undefined && findQuery !== "") {
      setOpen(true);
      setQuery(findQuery);
      setActiveState(0);
      setAnchorLine(line ?? null);
      setScrollRequest((request) => request + 1);
    }
  }

  const sourceMatches = useMemo(
    () => (open && sourceMode && content !== undefined ? lineMatchOffsets(content, query) : null),
    [open, sourceMode, content, query],
  );
  const total = sourceMatches?.total ?? domTotal;
  const anchored =
    sourceMatches !== null && anchorLine !== null
      ? firstMatchFromLine(sourceMatches, anchorLine)
      : activeState;
  const active = total === 0 ? 0 : Math.min(anchored, total - 1);
  const revealLine =
    sourceMatches !== null && total > 0 ? lineOfMatch(sourceMatches.offsets, active) : undefined;

  useEffect(() => {
    const root = viewerRef.current;
    if (!open || root === null) return;
    const apply = () => {
      const blocks = collectFindBlocks(root, query);
      const ranges: Range[] = [];
      let activeRange: Range | null = null;
      for (const { block, ranges: blockRanges } of blocks) {
        const lineNumber = sourceMatches === null ? null : Number(block.id.slice(1));
        const base =
          lineNumber === null ? ranges.length : (sourceMatches?.offsets[lineNumber - 1] ?? -1);
        blockRanges.forEach((range, index) => {
          if (base + index === active) activeRange = range;
          ranges.push(range);
        });
      }
      if (sourceMatches === null) setDomTotal(ranges.length);
      paintFindHighlights(ranges, activeRange);
      if (scrolledRef.current !== scrollRequest && activeRange !== null) {
        scrolledRef.current = scrollRequest;
        (activeRange as Range).startContainer.parentElement?.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearFindHighlights();
    };
  }, [viewerRef, open, query, active, sourceMatches, scrollRequest]);

  useEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const openBar = () => {
    setOpen(true);
    setFocusRequest((request) => request + 1);
  };

  const close = () => {
    setOpen(false);
    viewerRef.current?.focus({ preventScroll: true });
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    setActiveState(0);
    setAnchorLine(null);
    setScrollRequest((request) => request + 1);
  };

  const step = (direction: 1 | -1) => {
    setActiveState(stepMatch(active, total, direction));
    setAnchorLine(null);
    setScrollRequest((request) => request + 1);
  };

  const handlePaneKeyDown = (event: KeyboardEvent) => {
    if (!isFindShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    openBar();
  };

  return {
    handlePaneKeyDown,
    revealLine: open ? revealLine : undefined,
    bar: open ? (
      <FindBar
        inputRef={inputRef}
        query={query}
        active={active}
        total={total}
        onQueryChange={changeQuery}
        onStep={step}
        onClose={close}
      />
    ) : null,
  };
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
  findQuery,
  hashNavigation = false,
  onOpenFile,
  onAttachContext,
  onEditStart,
  onDirtyChange,
}: FileViewProps) {
  const { settings } = useSettings();
  const [forceText, setForceText] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const isImage = imageContentType(path) !== null;
  const markdown = isMarkdownPath(path);
  const file = useQuery({ ...fileViewQueryOptions(path, forceText), enabled: !isImage });
  const viewerRef = useRef<HTMLDivElement>(null);
  const [menuSelection, setMenuSelection] = useState<ContextAttachment | null>(null);
  const attachKeys = useShortcutKeys("attach_selection");
  const content = file.data?.kind === "text" ? file.data.content : undefined;
  const edit = useMarkdownEdit({
    path,
    target: markdown && content !== undefined ? editableMarkdownTarget(path) : null,
    onEditStart,
    onDirtyChange,
  });
  const find = useFindInFile({
    viewerRef,
    content,
    sourceMode: content !== undefined && content !== "" && (!markdown || showSource),
    line,
    findQuery,
  });

  useShortcut(
    "attach_selection",
    () => {
      const attachment = selectionAttachment(viewerRef.current, path, cwd, content);
      if (attachment === null) return false;
      onAttachContext?.(attachment);
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
    if (edit.editor !== null) return edit.editor;
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
          revealLine={find.revealLine}
        />
      </div>
    );
  };

  const canToggleSource = markdown && file.data?.kind === "text" && !edit.editing;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        edit.handleKeyDown(event);
        find.handlePaneKeyDown(event);
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 px-3">
        <Breadcrumb path={displayPath(path, cwd)} />
        {edit.editButton}
        {edit.toolbar}
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {find.bar}
        <ContextMenu>
          <ContextMenuTrigger
            render={<div ref={viewerRef} />}
            tabIndex={-1}
            data-file-viewer="true"
            data-find-query={findQuery}
            className="min-h-0 flex-1 overflow-auto outline-none select-text"
            onContextMenu={() =>
              setMenuSelection(selectionAttachment(viewerRef.current, path, cwd, content))
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
              attachment={() => menuSelection ?? { kind: "file", path: mentionPath(path, cwd) }}
              onAttachContext={onAttachContext}
              attachShortcut={attachKeys.keys}
            />
          </MenuContent>
        </ContextMenu>
      </div>
      {edit.dialog}
    </div>
  );
}
