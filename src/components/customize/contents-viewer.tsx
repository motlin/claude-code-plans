import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Code, Eye, File, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { useResizableWidth } from "../../hooks/use-resizable-width";
import type { FileTreeNodeData } from "../../lib/api/plugins";
import { FileViewer } from "../file-viewer";
import { MarkdownView } from "../markdown-view";
import { SegmentedControl } from "../settings/segmented-control";
import {
  containsFile,
  defaultContentsFile,
  isMarkdownPath,
  orderContentsTree,
  stripFrontmatter,
} from "./contents-order";

export interface ContentsFile {
  path: string;
  content: string;
}

/** Query options for one file, addressed by its path relative to the tree root. */
export type ContentsFileQuery<TKey extends QueryKey = QueryKey> = (
  path: string,
) => UseQueryOptions<ContentsFile, Error, ContentsFile, TKey>;

interface ContentsViewerProps<TKey extends QueryKey> {
  /** Shown in the version combobox as "<name> · current". */
  name: string;
  /** Children of the root directory, paths relative to it. */
  tree: readonly FileTreeNodeData[];
  fileQuery: ContentsFileQuery<TKey>;
  /** A path to select instead of the default file, when it is in the tree. */
  initialFile?: string | undefined;
}

const FILE_LIST_DEFAULT_WIDTH = 244;
const FILE_LIST_MIN_WIDTH = 160;
const FILE_LIST_MAX_WIDTH = 520;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function VersionCombobox({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const label = `${name} · current`;
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-label="Version"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="contents-version-listbox"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-r6 border border-border bg-surface-0 px-3 text-body text-primary hover:bg-fill-ghost-hover"
      >
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-t6" />
      </button>
      {open && (
        <div
          id="contents-version-listbox"
          role="listbox"
          aria-label="Versions"
          className="absolute top-full left-0 z-20 mt-1 min-w-56 rounded-card border border-border bg-surface-0 p-1 shadow-md"
        >
          <div
            role="option"
            aria-selected="true"
            tabIndex={-1}
            className="flex items-center justify-between gap-3 rounded-r6 px-2 py-1.5 text-body text-primary"
          >
            <span>{label}</span>
            <Check aria-hidden="true" className="size-4" />
          </div>
          <p className="px-2 py-1.5 text-caption text-t6">No other versions</p>
        </div>
      )}
    </div>
  );
}

interface TreeRowsProps {
  nodes: readonly FileTreeNodeData[];
  depth: number;
  selected: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

function TreeRows({ nodes, depth, selected, collapsed, onSelect, onToggle }: TreeRowsProps) {
  return nodes.map((node) => {
    const name = baseName(node.path);
    const indent = { paddingInlineStart: `${8 + depth * 28}px` };
    if (node.children !== undefined) {
      const expanded = !collapsed.has(node.path);
      return (
        <li key={node.path} role="none">
          <div
            role="treeitem"
            aria-expanded={expanded}
            aria-selected={false}
            tabIndex={-1}
            onClick={() => onToggle(node.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle(node.path);
              }
            }}
            style={indent}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-r6 pe-2 text-body text-secondary hover:bg-fill-ghost-hover"
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-t6 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            <Folder aria-hidden="true" className="size-4 shrink-0 text-t6" />
            <span className="truncate">{name}</span>
          </div>
          {expanded && (
            <ul role="group">
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                collapsed={collapsed}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            </ul>
          )}
        </li>
      );
    }
    const active = node.path === selected;
    return (
      <li key={node.path} role="none">
        <div
          role="treeitem"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          onClick={() => onSelect(node.path)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(node.path);
            }
          }}
          style={indent}
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-r6 pe-2 text-body hover:bg-fill-ghost-hover ${
            active ? "bg-fill-ghost-hover font-semibold text-primary" : "text-secondary"
          }`}
        >
          <File aria-hidden="true" className="ms-5 size-4 shrink-0 text-t6" />
          <span className="truncate">{name}</span>
        </div>
      </li>
    );
  });
}

type ViewMode = "preview" | "code";

function FilePane<TKey extends QueryKey>({
  path,
  fileQuery,
}: {
  path: string;
  fileQuery: ContentsFileQuery<TKey>;
}) {
  const markdown = isMarkdownPath(path);
  const [mode, setMode] = useState<ViewMode>("preview");
  const { data, isPending, isError } = useQuery(fileQuery(path));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <span
          data-testid="contents-path"
          className="truncate font-mono text-caption text-secondary"
        >
          /{path}
        </span>
        {markdown && (
          <SegmentedControl<ViewMode>
            aria-label="File view mode"
            iconOnly
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "preview", label: "Preview", icon: <Eye aria-hidden="true" /> },
              { value: "code", label: "Code", icon: <Code aria-hidden="true" /> },
            ]}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isPending ? (
          <p className="text-body text-t6">Loading file…</p>
        ) : isError || data === undefined ? (
          <p className="text-body text-t6">This file could not be read.</p>
        ) : markdown && mode === "preview" ? (
          <MarkdownView markdown={stripFrontmatter(data.content)} />
        ) : (
          <FileViewer file={data} />
        )}
      </div>
    </div>
  );
}

/**
 * Upstream Contents tab: a version combobox over a bordered split of a
 * resizable file list (SKILL.md / README.md first, then folders, then files)
 * and the selected file — markdown gets Preview | Code, everything else is
 * highlighted code with line numbers. The selection is local state, not URL.
 */
export function ContentsViewer<TKey extends QueryKey>({
  name,
  tree,
  fileQuery,
  initialFile,
}: ContentsViewerProps<TKey>) {
  const ordered = useMemo(() => orderContentsTree(tree), [tree]);
  const [selected, setSelected] = useState<string | null>(() =>
    initialFile !== undefined && containsFile(ordered, initialFile)
      ? initialFile
      : defaultContentsFile(ordered),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState(FILE_LIST_DEFAULT_WIDTH);
  const separator = useResizableWidth({
    label: "Resize file list",
    min: FILE_LIST_MIN_WIDTH,
    max: FILE_LIST_MAX_WIDTH,
    step: 16,
    edge: "end",
    value: width,
    onChange: setWidth,
  });

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <VersionCombobox name={name} />
      </div>
      <div className="flex min-h-[480px] overflow-hidden rounded-xl border border-border bg-surface-0">
        <nav aria-label="Files" style={{ width }} className="shrink-0 overflow-auto p-2">
          <ul role="tree" aria-label="Files">
            <TreeRows
              nodes={ordered}
              depth={0}
              selected={selected}
              collapsed={collapsed}
              onSelect={setSelected}
              onToggle={toggle}
            />
          </ul>
        </nav>
        <div
          {...separator}
          className="w-1 shrink-0 cursor-col-resize border-l border-border outline-none hover:bg-accent-100/30 focus-visible:bg-accent-100/40"
        />
        {selected === null ? (
          <p className="p-4 text-body text-t6">No files.</p>
        ) : (
          <FilePane key={selected} path={selected} fileQuery={fileQuery} />
        )}
      </div>
    </div>
  );
}
