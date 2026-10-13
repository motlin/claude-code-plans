import {ChevronRight, Copy} from "lucide-react";
import {type KeyboardEvent, type MouseEvent, useState} from "react";

import {useResizableWidth} from "../../hooks/use-resizable-width";
import {formatRelativeTimeFromIso} from "../../lib/relative-time";
import {changedFileKindLabels} from "../../lib/schema-choices";
import {getFileIcon} from "../file-icon";
import {
	buildChangedFileTree,
	type ChangedFileInput,
	type ChangedFileTreeNode,
	type ChangedFileTreeOptions,
} from "./changed-file-tree";

const FILE_LIST_DEFAULT_WIDTH = 240;
const FILE_LIST_MIN_WIDTH = 160;
const FILE_LIST_MAX_WIDTH = 640;
const INDENT_PX = 8;

const ROW_CLASS =
	"flex h-6 w-full shrink-0 cursor-pointer select-none items-center gap-1 rounded-r5 pr-2 text-left text-body text-primary outline-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover aria-[current=true]:bg-fill-control";

/** ArrowUp/ArrowDown/Home/End roving focus over the rows matching `selector`. */
function moveRowFocus(event: KeyboardEvent<HTMLElement>, selector: string): void {
	const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
	if (rows.length === 0) return;
	const index = rows.indexOf(document.activeElement as HTMLElement);
	let next: number;
	if (event.key === "ArrowDown") next = index === -1 ? 0 : Math.min(rows.length - 1, index + 1);
	else if (event.key === "ArrowUp") next = index === -1 ? 0 : Math.max(0, index - 1);
	else if (event.key === "Home") next = 0;
	else if (event.key === "End") next = rows.length - 1;
	else return;
	event.preventDefault();
	rows[next]?.focus();
}

export function DiffCounts({additions, deletions}: {additions: number; deletions: number}) {
	return (
		<span className="flex shrink-0 items-center gap-0.5 text-footnote tabular-nums">
			<span className="text-extended-green">+{additions}</span>
			<span className="text-extended-pink">−{deletions}</span>
		</span>
	);
}

interface TreeRowsProps {
	nodes: readonly ChangedFileTreeNode[];
	sectionKey: string;
	flat: boolean;
	collapsedDirs: ReadonlySet<string>;
	onToggleDir: (key: string) => void;
	activePath: string | null;
	onFileClick: (event: MouseEvent<HTMLButtonElement>, path: string) => void;
}

function TreeRows({nodes, sectionKey, flat, collapsedDirs, onToggleDir, activePath, onFileClick}: TreeRowsProps) {
	return nodes.map((node) => {
		const paddingLeft = INDENT_PX * (node.depth + 1);
		if (node.type === "dir") {
			const key = `${sectionKey}:${node.path}`;
			const expanded = !collapsedDirs.has(key);
			return (
				<div key={key} role="none" className="contents">
					<button
						type="button"
						data-diff-tree-row
						role="treeitem"
						tabIndex={-1}
						aria-level={node.depth + 1}
						aria-expanded={expanded}
						title={node.path}
						onClick={() => {
							onToggleDir(key);
						}}
						className={ROW_CLASS}
						style={{paddingLeft}}
					>
						<ChevronRight
							aria-hidden="true"
							className={`size-3 shrink-0 text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}
						/>
						<span className="min-w-0 truncate">{node.name}</span>
					</button>
					{expanded && (
						<TreeRows
							nodes={node.children}
							sectionKey={sectionKey}
							flat={flat}
							collapsedDirs={collapsedDirs}
							onToggleDir={onToggleDir}
							activePath={activePath}
							onFileClick={onFileClick}
						/>
					)}
				</div>
			);
		}
		const Icon = getFileIcon(node.name);
		return (
			<button
				key={`${sectionKey}:${node.path}`}
				type="button"
				data-diff-tree-row
				role="treeitem"
				tabIndex={-1}
				aria-level={node.depth + 1}
				aria-current={node.path === activePath ? "true" : undefined}
				title={node.path}
				draggable
				onDragStart={(event) => {
					event.dataTransfer.setData("text/plain", node.path);
				}}
				onClick={(event) => {
					onFileClick(event, node.path);
				}}
				className={ROW_CLASS}
				style={{paddingLeft}}
			>
				<Icon aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
				<span className="flex min-w-0 flex-1 items-baseline gap-1">
					<span className={flat ? "shrink-0 truncate" : "min-w-0 truncate"}>{node.name}</span>
					{flat && node.dir !== "" && (
						<span className="min-w-0 truncate text-footnote text-ink-muted">{node.dir}</span>
					)}
				</span>
				<DiffCounts additions={node.additions} deletions={node.deletions} />
			</button>
		);
	});
}

export interface ChangedFileCommit {
	sha: string;
	shortSha: string;
	subject: string;
	author: string;
	date: string;
}

function CommitList({
	commits,
	selectedCommitSha,
	onSelectCommit,
	onCopyCommitSha,
}: {
	commits: readonly ChangedFileCommit[];
	selectedCommitSha: string | null;
	onSelectCommit: (sha: string | null) => void;
	onCopyCommitSha: (sha: string) => void;
}) {
	const rowClass =
		"w-full cursor-pointer rounded-r5 px-1 py-[6px] text-left text-body text-primary outline-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover aria-pressed:bg-fill-control";
	return (
		<div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border px-1">
			<div
				role="toolbar"
				aria-orientation="vertical"
				aria-label="Commits"
				tabIndex={0}
				onKeyDown={(event) => {
					moveRowFocus(event, "[data-commit-row]");
				}}
				className="flex flex-col gap-[2px] py-2 outline-none"
			>
				<button
					type="button"
					data-commit-row
					tabIndex={-1}
					aria-pressed={selectedCommitSha === null}
					onClick={() => {
						onSelectCommit(null);
					}}
					className={rowClass}
				>
					All changes
				</button>
				{commits.map((commit) => (
					<div key={commit.sha} className="group relative">
						<button
							type="button"
							data-commit-row="commit"
							tabIndex={-1}
							aria-pressed={selectedCommitSha === commit.sha}
							title={commit.subject}
							onClick={() => {
								onSelectCommit(commit.sha);
							}}
							className={`flex flex-col items-start gap-[2px] pr-7 ${rowClass}`}
						>
							<span className="block w-full min-w-0 truncate">{commit.subject}</span>
							<span className="flex w-full min-w-0 items-center gap-1 text-footnote text-ink-muted">
								<span className="shrink-0 font-mono">{commit.shortSha}</span>
								<span aria-hidden="true">·</span>
								<span className="min-w-0 truncate">{commit.author}</span>
								<span aria-hidden="true">·</span>
								<time dateTime={commit.date} className="shrink-0">
									{formatRelativeTimeFromIso(commit.date)}
								</time>
							</span>
						</button>
						<button
							type="button"
							aria-label="Copy commit SHA"
							title="Copy commit SHA"
							onClick={() => {
								onCopyCommitSha(commit.sha);
							}}
							className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-r5 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100"
						>
							<Copy aria-hidden="true" className="size-3" />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}

export interface ChangedFilesSidebarProps extends ChangedFileTreeOptions {
	files: readonly ChangedFileInput[];
	/** The file currently in view in the diff body. */
	activePath: string | null;
	onSelectFile: (path: string) => void;
	/** Cmd/Ctrl+click opens the file instead of jumping to it. */
	onOpenFile?: (path: string) => void;
	/** Branch commits, newest first; the commit list is hidden when empty. */
	commits: readonly ChangedFileCommit[];
	selectedCommitSha: string | null;
	onSelectCommit: (sha: string | null) => void;
	onCopyCommitSha: (sha: string) => void;
}

/**
 * claude.ai/code's Changes file list (⌃⇧Y): a resizable 240px column holding the "Changed
 * files" tree over the "Commits" toolbar.
 */
export function ChangedFilesSidebar({
	files,
	groupByFolder,
	groupByKind,
	activePath,
	onSelectFile,
	onOpenFile,
	commits,
	selectedCommitSha,
	onSelectCommit,
	onCopyCommitSha,
}: ChangedFilesSidebarProps) {
	const [width, setWidth] = useState(FILE_LIST_DEFAULT_WIDTH);
	const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set());
	const resizeHandleProps = useResizableWidth({
		label: "Resize file list",
		min: FILE_LIST_MIN_WIDTH,
		max: FILE_LIST_MAX_WIDTH,
		step: 8,
		edge: "end",
		value: width,
		onChange: setWidth,
	});
	const sections = buildChangedFileTree(files, {groupByFolder, groupByKind});

	function toggleDir(key: string): void {
		setCollapsedDirs((previous) => {
			const next = new Set(previous);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	}

	function handleFileClick(event: MouseEvent<HTMLButtonElement>, path: string): void {
		if ((event.metaKey || event.ctrlKey) && onOpenFile) {
			onOpenFile(path);
			return;
		}
		if (event.metaKey || event.ctrlKey) return;
		onSelectFile(path);
	}

	return (
		<div
			className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
			style={{
				width,
				minWidth: `min(${FILE_LIST_MIN_WIDTH}px, 100% - 160px)`,
				maxWidth: `min(${FILE_LIST_MAX_WIDTH}px, 100% - 160px)`,
			}}
		>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div
					role="tree"
					aria-label="Changed files"
					tabIndex={0}
					onKeyDown={(event) => {
						moveRowFocus(event, "[data-diff-tree-row]");
					}}
					className="flex h-full flex-col overflow-y-auto px-1 py-1.25 outline-none"
				>
					{sections.map((section) => {
						const sectionKey = section.kind ?? "all";
						return (
							<div key={sectionKey} role="group" className="flex flex-col">
								{section.kind !== null && section.kind !== "source" && (
									<div
										data-diff-tree-section-label
										className="mt-2 px-2 pb-1 text-footnote text-ink-muted"
									>
										{changedFileKindLabels[section.kind]}
									</div>
								)}
								<TreeRows
									nodes={section.nodes}
									sectionKey={sectionKey}
									flat={!groupByFolder}
									collapsedDirs={collapsedDirs}
									onToggleDir={toggleDir}
									activePath={activePath}
									onFileClick={handleFileClick}
								/>
							</div>
						);
					})}
				</div>
			</div>
			{commits.length > 0 && (
				<CommitList
					commits={commits}
					selectedCommitSha={selectedCommitSha}
					onSelectCommit={onSelectCommit}
					onCopyCommitSha={onCopyCommitSha}
				/>
			)}
			<div
				{...resizeHandleProps}
				className="group/resize absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize justify-center outline-none"
			>
				<div className="h-full max-h-12 w-[3px] self-center rounded-full bg-ink-muted opacity-0 transition-opacity delay-200 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100" />
			</div>
		</div>
	);
}
