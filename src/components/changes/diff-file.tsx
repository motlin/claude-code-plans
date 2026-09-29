import { getSingularPatch, registerCustomTheme } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs/react";
import { ArrowUpRight, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { useCodeThemes } from "../../hooks/use-code-themes";
import { claudeLight } from "../../lib/claude-light-theme";
import type { DiffStyle } from "../settings-provider";
import { useResolvedTheme } from "../theme-provider";

// Register our claude.ai code theme with the library's shared highlighter so
// the Changes pane highlights with the same Shiki themes as the transcript.
registerCustomTheme("claude-light", () => Promise.resolve(claudeLight));

/**
 * The `--diffs-*` variables upstream's Changes pane sets on its CodeView,
 * remapped from `--cds-*` onto our upstream tokens. Custom properties inherit
 * through the `<diffs-container>` shadow boundary, so setting them on the host
 * reaches the library's internal stylesheet.
 */
export const DIFFS_STYLE_OVERRIDES = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-font-size": "var(--upstream-text-code)",
  "--diffs-line-height": "var(--upstream-leading-code)",
  "--diffs-bg-hover-override": "var(--upstream-fill-ghost-hover)",
  "--diffs-bg-context-override": "transparent",
  "--diffs-bg-separator-override": "transparent",
  "--diffs-fg-number-override": "var(--upstream-text-muted)",
  "--diffs-fg-number-addition-override": "var(--upstream-extended-green)",
  "--diffs-fg-number-deletion-override": "var(--upstream-extended-pink)",
  "--diffs-addition-color-override": "var(--upstream-extended-green)",
  "--diffs-deletion-color-override": "var(--upstream-extended-pink)",
  "--diffs-modified-color-override": "var(--color-git-conflicting)",
  "--diffs-selection-color-override": "var(--accent-100)",
  "--diffs-bg-selection-override": "var(--accent-900)",
  "--diffs-bg-selection-number-override": "var(--accent-900)",
  "--diffs-fg-conflict-marker-override": "var(--upstream-text-muted)",
  "--diffs-gap-style": "0",
  "--diffs-overflow-override": "clip",
  "--diffs-scrollbar-gutter-override": "0px",
} as CSSProperties;

export type { DiffStyle };

/** Content rendered inline beneath one diff line, such as a review finding. */
export interface DiffFileAnnotation {
  side: "additions" | "deletions";
  lineNumber: number;
  content: ReactNode;
}

export interface DiffFileProps {
  /** A single-file unified diff (`git diff` output for one path). */
  patch: string;
  diffStyle?: DiffStyle;
  wordWrap?: boolean;
  /** Highlight the changed words within changed lines. */
  wordDiff?: boolean;
  defaultCollapsed?: boolean;
  /** Controlled collapse state; pair with `onCollapsedChange`. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onOpenFile?: () => void;
  annotations?: readonly DiffFileAnnotation[];
}

function countChanges(fileDiff: FileDiffMetadata): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of fileDiff.hunks) {
    added += hunk.additionLines;
    removed += hunk.deletionLines;
  }
  return { added, removed };
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return { name: path, dir: "" };
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

export interface DiffFileHeaderProps {
  path: string;
  prevPath?: string | undefined;
  additions: number;
  deletions: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Shows the hover-revealed "Open file" action when set. */
  onOpenFile?: (() => void) | undefined;
}

/** Upstream's 32px Changes file header: chevron, name, dir, "Renamed from", +a −r, hover "Open file". */
export function DiffFileHeader({
  path,
  prevPath,
  additions,
  deletions,
  collapsed,
  onToggle,
  onOpenFile,
}: DiffFileHeaderProps) {
  const { name, dir } = splitPath(path);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div data-diff-file-header={path} className="group/diff-file relative">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex h-8 w-full shrink-0 cursor-pointer select-none items-center gap-[4px] bg-surface-2 px-3 text-left font-sans hover:bg-fill-ghost-hover"
      >
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center text-ink-muted"
        >
          <Chevron className="size-3.5" />
        </span>
        <FileText aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
        <span className="flex min-w-0 text-body text-secondary">
          <span
            dir="ltr"
            className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap"
          >
            <span className="max-w-full shrink-0 truncate">{name}</span>
            {dir && <span className="min-w-0 truncate text-footnote text-ink-muted">{dir}</span>}
          </span>
        </span>
        {prevPath && (
          <span className="flex min-w-0 shrink-[9999] items-baseline gap-1 overflow-hidden whitespace-nowrap text-body text-ink-muted">
            <span className="min-w-0 truncate">Renamed from </span>
            <span className="min-w-0 truncate" title={prevPath}>
              {prevPath}
            </span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-body tabular-nums">
          <span className="text-extended-green">+{additions}</span>
          <span className="text-extended-pink">−{deletions}</span>
        </span>
        {onOpenFile && <span aria-hidden="true" className="w-6 shrink-0" />}
      </button>
      {onOpenFile && (
        <span className="absolute inset-y-0 right-0 flex items-center pr-3 opacity-0 transition-opacity group-hover/diff-file:opacity-100 group-focus-within/diff-file:opacity-100 pointer-coarse:opacity-100">
          <button
            type="button"
            aria-label="Open file"
            onClick={onOpenFile}
            className="flex size-5 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
          >
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * One file of the Changes pane, rendered by `@pierre/diffs` (upstream
 * claude.ai/code's diff library) with the pane's options: classic `+`/`-`
 * indicators, wrapped lines, line-info hunk separators, and our own header
 * slotted in place of the library's. The library header stays enabled:
 * `disableFileHeader` would also drop the `header-custom` slot.
 */
export function DiffFile({
  patch,
  diffStyle = "unified",
  wordWrap = true,
  wordDiff = true,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onOpenFile,
  annotations,
}: DiffFileProps) {
  const fileDiff = useMemo(() => getSingularPatch(patch), [patch]);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const toggle = () => {
    setUncontrolledCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const resolvedTheme = useResolvedTheme();
  const codeThemes = useCodeThemes();

  const lineAnnotations = useMemo(
    () =>
      annotations?.map(({ side, lineNumber, content }) => ({
        side,
        lineNumber,
        metadata: content,
      })),
    [annotations],
  );

  const options = useMemo<FileDiffOptions<ReactNode, undefined>>(
    () => ({
      theme: codeThemes,
      themeType: resolvedTheme,
      diffStyle,
      diffIndicators: "classic",
      overflow: wordWrap ? "wrap" : "scroll",
      hunkSeparators: "line-info",
      lineDiffType: wordDiff ? "word-alt" : "none",
      stickyHeader: true,
      collapsed,
    }),
    [codeThemes, resolvedTheme, diffStyle, wordWrap, wordDiff, collapsed],
  );

  return (
    <FileDiff<ReactNode, undefined>
      fileDiff={fileDiff}
      options={options}
      style={DIFFS_STYLE_OVERRIDES}
      disableWorkerPool
      {...(lineAnnotations === undefined
        ? {}
        : { lineAnnotations, renderAnnotation: (annotation) => annotation.metadata })}
      renderCustomHeader={(file) => {
        const { added, removed } = countChanges(file);
        return (
          <DiffFileHeader
            path={file.name}
            prevPath={file.prevName}
            additions={added}
            deletions={removed}
            collapsed={collapsed}
            onToggle={toggle}
            onOpenFile={onOpenFile}
          />
        );
      }}
    />
  );
}
