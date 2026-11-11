import {ChevronRight, Copy} from "lucide-react";
import {type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, useState} from "react";

import {clampFileColumnWidth, useFileColumnResize} from "../../hooks/use-file-column-resize";
import {formatRelativeTimeFromIso} from "../../lib/relative-time";
import {changedFileKindLabels} from "../../lib/schema-choices";
import {FileTypeIcon} from "../file-type-icon";
import {FILE_TYPE_ICON_SIZE_PX} from "../file-type-icon-size";
import {Icon} from "../ui/icon";
import {Pulse} from "../ui/pulse";
import {useTreeFileMark} from "./diff-marks-context";
import {useSettings} from "../settings-context";
import {FILE_COLUMN_HANDLE_Z, FileColumnEdgeHandle} from "../ui/file-column-edge-handle";
import {FileColumnResizeShield} from "../ui/file-column-resize-shield";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "../ui/menu";
import {ResizeHandle} from "../ui/resize-handle";
import {RESIZE_HANDLE_HALF_CLIP_CLASS} from "../ui/resize-pill";
import {
	buildChangedFileTree,
	type ChangedFileInput,
	type ChangedFileTreeFile,
	type ChangedFileTreeNode,
	type ChangedFileTreeOptions,
} from "./changed-file-tree";

const INDENT_PX = 8;

const ROW_CLASS =
	"flex h-6 w-full shrink-0 cursor-pointer select-none items-center gap-1 rounded-r5 pr-2 text-left text-body text-primary outline-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover aria-[current=true]:bg-fill-control";

/** ArrowUp/ArrowDown/Home/End roving focus over the rows matching `selector`. */
function moveRowFocus(event: KeyboardEvent<HTMLElement>, selector: string): void {
	const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
	if (rows.length === 0) return;
	const active = document.activeElement;
	const index = active instanceof HTMLElement ? rows.indexOf(active) : -1;
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
			<span className="text-diff-added">+{additions}</span>
			<span className="text-diff-removed">−{deletions}</span>
		</span>
	);
}

/** A row's right-click menu: the file menu for a file or folder path (upstream `fp`). */
export type ChangedFileRowMenu = (path: string, isDirectory: boolean) => ReactNode;

/** Wraps a tree row in its ContextMenu when the caller supplies row menus. */
function withRowMenu(
	key: string,
	row: ReactElement,
	path: string,
	isDirectory: boolean,
	rowMenu: ChangedFileRowMenu | undefined,
): ReactElement {
	if (rowMenu === undefined) return row;
	return (
		<ContextMenu key={key}>
			<ContextMenuTrigger render={row} />
			<MenuContent>{rowMenu(path, isDirectory)}</MenuContent>
		</ContextMenu>
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
	rowMenu: ChangedFileRowMenu | undefined;
}

function TreeRows({
	nodes,
	sectionKey,
	flat,
	collapsedDirs,
	onToggleDir,
	activePath,
	onFileClick,
	rowMenu,
}: TreeRowsProps) {
	return nodes.map((node) => {
		const paddingLeft = INDENT_PX * (node.depth + 1);
		if (node.type === "dir") {
			const key = `${sectionKey}:${node.path}`;
			const expanded = !collapsedDirs.has(key);
			return (
				<div key={key} role="none" className="contents">
					{withRowMenu(
						key,
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
								className={`size-3 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
							/>
							<span className="min-w-0 truncate">{node.name}</span>
						</button>,
						node.path,
						true,
						rowMenu,
					)}
					{expanded && (
						<TreeRows
							nodes={node.children}
							sectionKey={sectionKey}
							flat={flat}
							collapsedDirs={collapsedDirs}
							onToggleDir={onToggleDir}
							activePath={activePath}
							onFileClick={onFileClick}
							rowMenu={rowMenu}
						/>
					)}
				</div>
			);
		}
		const fileKey = `${sectionKey}:${node.path}`;
		return (
			<FileRow
				key={fileKey}
				node={node}
				rowKey={fileKey}
				flat={flat}
				paddingLeft={paddingLeft}
				active={node.path === activePath}
				onFileClick={onFileClick}
				rowMenu={rowMenu}
			/>
		);
	});
}

const TREE_ICON_PX = `${String(FILE_TYPE_ICON_SIZE_PX.xs)}px`;
const TREE_ICON_BOX = {width: TREE_ICON_PX, height: TREE_ICON_PX};

/** Upstream `Ec`: the check a mark slot shows on hover. */
function HoverCheck() {
	return (
		<span className="hidden group-hover/mark:contents">
			<Icon name="CheckCircle" size="xs" className="text-secondary" />
		</span>
	);
}

/** Upstream `Dc`: the file icon, which a markable row turns into a hover check. */
function UnmarkedFileIcon({name, markable}: {name: string; markable: boolean}) {
	// FileTypeIcon adds upstream's `shrink-0` itself.
	if (!markable) return <FileTypeIcon fileName={name} size="xs" className="text-muted-control" />;
	return (
		<span data-diff-tree-mark="" className="group/mark grid shrink-0 place-items-center" style={TREE_ICON_BOX}>
			<span className="contents group-hover/mark:hidden">
				<FileTypeIcon fileName={name} size="xs" className="text-muted-control" />
			</span>
			<HoverCheck />
		</span>
	);
}

/** Upstream `Oc`: a marked row's filled check, or a stale row's accent dot that turns into the check on hover. */
function FileMarkGlyph({stale}: {stale: boolean}) {
	if (!stale) {
		return (
			<Icon
				name="CheckCircleFilled"
				size="xs"
				alt="Viewed"
				data-diff-tree-mark=""
				className="order-first shrink-0 text-secondary hover:text-primary"
			/>
		);
	}
	return (
		<span
			role="img"
			aria-label="Changed since you viewed it"
			data-diff-tree-mark=""
			className="group/mark order-first grid shrink-0 place-items-center"
			style={TREE_ICON_BOX}
		>
			<Pulse animate={false} className="group-hover/mark:hidden" />
			<HoverCheck />
		</span>
	);
}

/**
 * Upstream `Tc`: a click toggles the mark only from inside the mark slot, without ⌘/Ctrl, a touch pointer, or a
 * text selection in the row's document.
 */
function isMarkToggleClick(event: MouseEvent<HTMLButtonElement>): boolean {
	const native = event.nativeEvent;
	if (event.metaKey || event.ctrlKey) return false;
	if ("pointerType" in native && native.pointerType === "touch") return false;
	const selection = event.currentTarget.ownerDocument.getSelection();
	if (selection !== null && selection.toString() !== "") return false;
	return event.target instanceof Element && event.target.closest("[data-diff-tree-mark]") !== null;
}

function FileRow({
	node,
	rowKey,
	flat,
	paddingLeft,
	active,
	onFileClick,
	rowMenu,
}: {
	node: ChangedFileTreeFile;
	rowKey: string;
	flat: boolean;
	paddingLeft: number;
	active: boolean;
	onFileClick: (event: MouseEvent<HTMLButtonElement>, path: string) => void;
	rowMenu: ChangedFileRowMenu | undefined;
}) {
	const mark = useTreeFileMark(node.path);
	const marked = mark !== undefined && mark.status !== "none";
	const nameInk = mark?.status === "marked" && !active ? " text-muted-as-secondary" : "";
	return withRowMenu(
		rowKey,
		<button
			type="button"
			data-diff-tree-row
			role="treeitem"
			tabIndex={-1}
			aria-level={node.depth + 1}
			aria-current={active ? "true" : undefined}
			title={node.path}
			draggable
			onDragStart={(event) => {
				event.dataTransfer.setData("text/plain", node.path);
			}}
			onClick={(event) => {
				if (mark?.canMark === true && isMarkToggleClick(event)) mark.setMarked(mark.status !== "marked");
				else onFileClick(event, node.path);
			}}
			className={ROW_CLASS}
			style={{paddingLeft}}
		>
			{!marked && <UnmarkedFileIcon name={node.name} markable={mark?.canMark === true} />}
			<span className={`flex min-w-0 flex-1 items-baseline gap-1${nameInk}`}>
				<span className={flat ? "shrink-0 truncate" : "min-w-0 truncate"}>{node.name}</span>
				{flat && node.dir !== "" && (
					<span className="min-w-0 truncate text-footnote text-ink-muted">{node.dir}</span>
				)}
			</span>
			{marked && <FileMarkGlyph stale={mark.status === "stale"} />}
			<DiffCounts additions={node.additions} deletions={node.deletions} />
		</button>,
		node.path,
		false,
		rowMenu,
	);
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
	/** Gives each file and folder row a right-click menu. */
	rowMenu?: ChangedFileRowMenu | undefined;
	/** Branch commits, newest first; the commit list is hidden when empty. */
	commits: readonly ChangedFileCommit[];
	selectedCommitSha: string | null;
	onSelectCommit: (sha: string | null) => void;
	onCopyCommitSha: (sha: string) => void;
	shown?: boolean;
	/** Lets a click on the handle, or a drag below 80px, hide the list, and a 3px edge handle show it. */
	onShownChange?: (shown: boolean) => void;
}

/**
 * claude.ai/code's Changes file list (⌃⇧Y): a resizable 240px column, its width persisted like
 * upstream's `epitaxy-diff-tree-width`, holding the "Changed files" tree over the "Commits" toolbar.
 * It stays mounted while hidden, so its folders keep their collapsed state.
 */
export function ChangedFilesSidebar({
	files,
	groupByFolder,
	groupByKind,
	activePath,
	onSelectFile,
	onOpenFile,
	rowMenu,
	commits,
	selectedCommitSha,
	onSelectCommit,
	onCopyCommitSha,
	shown = true,
	onShownChange,
}: ChangedFilesSidebarProps) {
	const {settings, setSetting} = useSettings();
	const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set());
	const {columnRef, columnStyle, resizing, handleProps, edgeHandleProps} = useFileColumnResize({
		width: clampFileColumnWidth(settings.diffTreeWidth),
		onWidthChange: (next) => {
			setSetting("diffTreeWidth", next);
		},
		shown,
		onShownChange,
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
		<>
			<div
				data-changed-files-list
				ref={columnRef}
				hidden={!shown}
				className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
				style={columnStyle}
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
										rowMenu={rowMenu}
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
				{shown && (
					<ResizeHandle
						{...handleProps}
						aria-label="Resize file list"
						onBorder
						className={RESIZE_HANDLE_HALF_CLIP_CLASS}
						style={{zIndex: FILE_COLUMN_HANDLE_Z}}
					/>
				)}
			</div>
			{edgeHandleProps && <FileColumnEdgeHandle handleProps={edgeHandleProps} label="Resize file list" />}
			<FileColumnResizeShield active={resizing} />
		</>
	);
}
