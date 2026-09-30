import {useQuery} from "@tanstack/react-query";
import {EllipsisVertical, Folder, PanelLeft, Search} from "lucide-react";
import {type ReactNode, type RefObject, useCallback, useEffect, useRef, useState} from "react";

import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {sessionFilesQueryOptions} from "../../lib/api/session-files";
import {sessionResourcesQueryOptions} from "../../lib/api/sessions";
import {EMPTY_FILE_TABS, type FileTabsAction, type FileTabsState, fileTabsReducer} from "../../lib/file-tabs";
import {type AttachContextHandler, attachContext, requestComposerInsert} from "../../lib/context-attach";
import {EMPTY_EDIT_GUARD, type EditGuardEvent, editGuardReducer} from "../../lib/file-edit";
import {onFileOpenRequest, takePendingFileOpen} from "../../lib/file-open-requests";
import type {FileRef} from "../../lib/file-refs";
import {loadFileTabs, saveFileTabs} from "../../lib/pane-layout";
import type {SessionFiles} from "../../lib/session-files";
import {FILE_TAB_SIZES, normalizeFileTabSize} from "../../lib/file-preview";
import {ConfirmDialog} from "../confirm-dialog";
import type {ContentMatchOpenOptions} from "../files/content-search-results";
import {FileView} from "../files/file-view";
import {FileTabsStrip} from "../files/file-tabs-strip";
import {FilesTree, FilesTreeColumn} from "../files/files-tree";
import {JumpTargetProvider, type JumpTargetWindow} from "../jump-target-context";
import {useSettings} from "../settings-provider";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {type PaneChrome, registerPane} from "./pane-registry";
import {
	FILE_SOURCE_OPTIONS,
	type FileSourceSelection,
	sessionFileLabel,
	SessionFilesList,
	useFileSourceSelection,
} from "./session-files-list";
import {usePaneHost} from "./tile-host";

export {
	DEFAULT_FILE_SOURCE_SELECTION,
	FILE_SOURCE_SELECTION_STORAGE_KEY,
	useExtractedSessionFiles,
} from "./session-files-list";

const GHOST_ICON_BUTTON =
	"flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-pressed:bg-fill-control aria-pressed:text-primary";

export interface FilesEmptyState {
	title: string;
	detail: string;
}

/** Upstream's three viewer empty states, chosen by whether the tree shows and how many tabs are open. */
export function filesEmptyState(hasTree: boolean, tabCount: number): FilesEmptyState {
	if (tabCount > 0) {
		return {
			title: "No file selected",
			detail: "Pick an open file above, or click a file path in the conversation.",
		};
	}
	return {
		title: "Open files appear here",
		detail: hasTree
			? "Pick a file in the tree, or click a file path in the conversation."
			: "Click a file path in the conversation to open it.",
	};
}

/**
 * Set by ⇧⌘F when it opens the pane, consumed by the pane's filter input on
 * mount: upstream focuses the filter only when the shortcut opened the pane.
 */
let pendingFilterFocus = false;

function consumePendingFilterFocus(): boolean {
	const pending = pendingFilterFocus;
	pendingFilterFocus = false;
	return pending;
}

function TreeToggle({shown, onToggle}: {shown: boolean; onToggle: () => void}) {
	const keys = useShortcutKeys("toggle_changes_file_list");
	const label = shown ? "Hide file tree" : "Show file tree";
	return (
		<Tooltip content={label} shortcut={keys.keys}>
			<button
				type="button"
				aria-pressed={shown}
				aria-label={label}
				aria-keyshortcuts={keys.ariaKeyShortcuts}
				onClick={onToggle}
				className={GHOST_ICON_BUTTON}
			>
				<PanelLeft aria-hidden="true" className="size-4" />
			</button>
		</Tooltip>
	);
}

interface FileSourcesMenuProps {
	counts: SessionFiles["counts"];
	sourceSelection: FileSourceSelection;
	onSourceSelectedChange: (source: keyof FileSourceSelection, selected: boolean) => void;
	onUnselectAll: () => void;
}

function FilesSettingsMenu({
	treeShown,
	onTreeShownChange,
	sources,
}: {
	treeShown: boolean;
	onTreeShownChange: (shown: boolean) => void;
	sources: FileSourcesMenuProps;
}) {
	const treeKeys = useShortcutKeys("toggle_changes_file_list");
	const {settings, setSetting} = useSettings();
	return (
		<Menu>
			<MenuTrigger aria-label="Files settings" className={GHOST_ICON_BUTTON}>
				<EllipsisVertical aria-hidden="true" className="size-4" />
			</MenuTrigger>
			<MenuContent align="end">
				<MenuCheckboxItem checked={treeShown} onCheckedChange={onTreeShownChange} shortcut={treeKeys.keys}>
					Show file tree
				</MenuCheckboxItem>
				<MenuCheckboxItem
					checked={settings.filesPreviewTabs}
					onCheckedChange={(checked) => setSetting("filesPreviewTabs", checked)}
				>
					Preview tabs
				</MenuCheckboxItem>
				<MenuCheckboxItem
					checked={settings.filesHideIgnored}
					onCheckedChange={(checked) => setSetting("filesHideIgnored", checked)}
				>
					Hide ignored files
				</MenuCheckboxItem>
				<MenuSeparator />
				<MenuCheckboxItem
					checked={settings.filesWordWrap}
					onCheckedChange={(checked) => setSetting("filesWordWrap", checked)}
				>
					Word wrap
				</MenuCheckboxItem>
				<MenuSub>
					<MenuSubTrigger value={normalizeFileTabSize(settings.filesTabSize)}>Tab size</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup
							value={normalizeFileTabSize(settings.filesTabSize)}
							onValueChange={(value: unknown) =>
								setSetting("filesTabSize", normalizeFileTabSize(Number(value)))
							}
						>
							{FILE_TAB_SIZES.map((size) => (
								<MenuRadioItem key={size} value={size}>
									{size}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger>Show files from</MenuSubTrigger>
					<MenuSubContent>
						{FILE_SOURCE_OPTIONS.map((option) => (
							<MenuCheckboxItem
								key={option.key}
								checked={sources.sourceSelection[option.key]}
								onCheckedChange={(checked) => sources.onSourceSelectedChange(option.key, checked)}
							>
								{option.label} ({sources.counts[option.key]})
							</MenuCheckboxItem>
						))}
						<MenuSeparator />
						<MenuItem onSelect={sources.onUnselectAll}>Unselect all</MenuItem>
					</MenuSubContent>
				</MenuSub>
			</MenuContent>
		</Menu>
	);
}

function FilesEmpty({hasTree, tabCount}: {hasTree: boolean; tabCount: number}) {
	const copy = filesEmptyState(hasTree, tabCount);
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
			<Folder aria-hidden="true" className="size-7 text-t6" />
			<div className="flex flex-col items-center gap-1">
				<p className="max-w-[36ch] text-pretty break-words text-body text-primary">{copy.title}</p>
				<p className="max-w-[36ch] text-pretty break-words text-footnote text-t6">{copy.detail}</p>
			</div>
		</div>
	);
}

type FilesListMode = "workspace" | "session";

const FILES_LIST_MODES: ReadonlyArray<{mode: FilesListMode; label: string}> = [
	{mode: "workspace", label: "Workspace"},
	{mode: "session", label: "Session"},
];

function FilesModeSwitch({mode, onModeChange}: {mode: FilesListMode; onModeChange: (mode: FilesListMode) => void}) {
	return (
		<div className="shrink-0 px-2 pt-1.5">
			<div
				role="radiogroup"
				aria-label="File list"
				className="flex h-6 items-center gap-0.5 rounded-r5 bg-fill-control p-0.5"
			>
				{FILES_LIST_MODES.map((option) => (
					<button
						key={option.mode}
						type="button"
						role="radio"
						aria-checked={mode === option.mode}
						onClick={() => onModeChange(option.mode)}
						className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-r3 text-footnote text-secondary transition-colors hover:text-primary aria-checked:bg-surface-0 aria-checked:text-primary aria-checked:shadow-sm"
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

interface WorkspaceOrSessionListProps {
	sessionId: string;
	mode: FilesListMode;
	onModeChange: (mode: FilesListMode) => void;
	query: string;
	onQueryChange: (query: string) => void;
	filterRef: RefObject<HTMLInputElement | null>;
	sessionList: ReactNode;
	onOpenFile: (relPath: string, options: ContentMatchOpenOptions) => void;
	activeRelPath: string | null;
	pinnedRelPaths: ReadonlySet<string>;
	cwd: string | undefined;
	onAttachContext: AttachContextHandler | undefined;
	onAsk: ((prompt: string) => void) | undefined;
}

/**
 * The tree column with a working directory to list: a Workspace | Session
 * switch over the workspace tree or the session's files. A session without a
 * working directory only has the Session list.
 */
function WorkspaceOrSessionList({
	sessionId,
	mode,
	onModeChange,
	query,
	onQueryChange,
	filterRef,
	sessionList,
	onOpenFile,
	activeRelPath,
	pinnedRelPaths,
	cwd,
	onAttachContext,
	onAsk,
}: WorkspaceOrSessionListProps) {
	const {settings} = useSettings();
	// Same key as the tree's root listing, so this shares its request.
	const root = useQuery(
		sessionFilesQueryOptions(sessionId, {
			dir: "",
			query: "",
			hideIgnored: settings.filesHideIgnored,
		}),
	);
	if (root.data?.kind === "no-cwd") return sessionList;
	return (
		<>
			<FilesModeSwitch mode={mode} onModeChange={onModeChange} />
			<div className="min-h-0 flex-1">
				{mode === "session" ? (
					sessionList
				) : (
					<FilesTree
						sessionId={sessionId}
						filterRef={filterRef}
						query={query}
						onQueryChange={onQueryChange}
						onOpenFile={onOpenFile}
						activeRelPath={activeRelPath}
						pinnedRelPaths={pinnedRelPaths}
						cwd={cwd}
						onAttachContext={onAttachContext}
						onAsk={onAsk}
					/>
				)}
			</div>
		</>
	);
}

/**
 * The pane's open tabs, persisted per session in the pane layout store once
 * hydrated. The layout store drops them when the Files pane closes.
 */
function useFileTabs(sessionId: string | undefined): [FileTabsState, (action: FileTabsAction) => void] {
	const {settings} = useSettings();
	const previewTabs = settings.filesPreviewTabs;
	const [entry, setEntry] = useState<{key: string | null; tabs: FileTabsState}>({
		key: null,
		tabs: EMPTY_FILE_TABS,
	});
	const loadedRef = useRef<FileTabsState | null>(null);
	const key = sessionId ?? "";

	useEffect(() => {
		const tabs = sessionId === undefined ? EMPTY_FILE_TABS : loadFileTabs(sessionId);
		loadedRef.current = tabs;
		setEntry({key: sessionId ?? "", tabs});
	}, [sessionId]);

	useEffect(() => {
		if (sessionId === undefined || entry.key !== sessionId || entry.tabs === loadedRef.current) {
			return;
		}
		saveFileTabs(sessionId, entry.tabs);
	}, [entry, sessionId]);

	const dispatch = useCallback(
		(action: FileTabsAction) =>
			setEntry((prev) => {
				const tabs = fileTabsReducer(prev.tabs, action, {previewTabs});
				return tabs === prev.tabs ? prev : {...prev, tabs};
			}),
		[previewTabs],
	);

	return [entry.key === key ? entry.tabs : EMPTY_FILE_TABS, dispatch];
}

/**
 * Wraps the tab dispatch with the unsaved-changes guard: an action that would
 * leave or close the tab being edited waits on "Discard unsaved changes?".
 */
function useEditGuard(
	tabs: FileTabsState,
	dispatchTabs: (action: FileTabsAction) => void,
): {
	dispatch: (action: FileTabsAction) => void;
	reportDirty: (path: string, dirty: boolean) => void;
	dialog: ReactNode;
} {
	const [guard, setGuard] = useState(EMPTY_EDIT_GUARD);
	const guardRef = useRef(guard);
	const tabsRef = useRef(tabs);
	useEffect(() => {
		tabsRef.current = tabs;
	}, [tabs]);

	const apply = useCallback(
		(event: EditGuardEvent) => {
			const {state, forward} = editGuardReducer(guardRef.current, event);
			guardRef.current = state;
			setGuard(state);
			if (forward !== null) dispatchTabs(forward);
		},
		[dispatchTabs],
	);
	const dispatch = useCallback(
		(action: FileTabsAction) => apply({type: "request", action, tabs: tabsRef.current}),
		[apply],
	);
	const reportDirty = useCallback((path: string, dirty: boolean) => apply({type: "dirty", path, dirty}), [apply]);

	const dirtyName = guard.dirtyPath?.slice(guard.dirtyPath.lastIndexOf("/") + 1) ?? "";
	const dialog = (
		<ConfirmDialog
			open={guard.pending !== null}
			onOpenChange={(open) => {
				if (!open && guardRef.current.pending !== null) apply({type: "keepEditing"});
			}}
			title="Discard unsaved changes?"
			body={`Your edits to ${dirtyName} have not been saved. Leaving this tab discards them.`}
			cancelLabel="Keep editing"
			confirmLabel="Discard"
			variant="danger"
			onConfirm={() => apply({type: "discard"})}
		/>
	);
	return {dispatch, reportDirty, dialog};
}

function absoluteFromCwd(cwd: string, relPath: string): string {
	return `${cwd.replace(/\/+$/, "")}/${relPath}`;
}

/** A tab's path relative to the working directory, or null outside it. */
function relativeToCwd(cwd: string | undefined, path: string): string | null {
	const label = sessionFileLabel(path, cwd);
	return label === path ? null : label;
}

interface FilesPaneViewProps {
	chrome: PaneChrome;
	/**
	 * Lists the session's working directory in the tree column. Without it, or
	 * when the session has no working directory, the column shows the files the
	 * session touched.
	 */
	sessionId?: string;
	/** The session's working directory; Session rows are shown relative to it. */
	cwd?: string;
	sessionFiles: SessionFiles;
	/** JSONL records before the loaded window, which extraction never saw. */
	unscannedRecordCount: number;
}

/**
 * The Files pane surface, header included: tree toggle · "Files" · Move ·
 * Search files · Files settings · Expand · Close, over the tree column (the
 * workspace tree) and the viewer column.
 */
export function FilesPaneView({chrome, sessionId, cwd, sessionFiles, unscannedRecordCount}: FilesPaneViewProps) {
	const host = usePaneHost();
	const [treeShown, setTreeShown] = useState(true);
	const [focusRequest, setFocusRequest] = useState(0);
	const [mode, setMode] = useState<FilesListMode>("workspace");
	const [query, setQuery] = useState("");
	const [fileTabs, dispatchTabs] = useFileTabs(sessionId);
	const editGuard = useEditGuard(fileTabs, dispatchTabs);
	const dispatchFileTabs = editGuard.dispatch;
	const openPath = fileTabs.active;
	const pinnedRelPaths = new Set(
		fileTabs.tabs.flatMap((tab) => {
			const relPath = tab.preview ? null : relativeToCwd(cwd, tab.path);
			return relPath === null ? [] : [relPath];
		}),
	);
	const [lineTarget, setLineTarget] = useState<(FileRef & {findQuery?: string}) | null>(null);
	const openFile = (path: string, options: {pin: boolean}): void =>
		dispatchFileTabs({type: "open", path, pin: options.pin});
	const target = lineTarget !== null && lineTarget.path === openPath ? lineTarget : null;

	// Transcript file refs open as a preview tab, including one clicked while
	// the pane was closed. Declared after useFileTabs so a restored tab set
	// lands before the requested open.
	useEffect(() => {
		if (sessionId === undefined) return undefined;
		const openRef = (ref: FileRef): void => {
			dispatchFileTabs({type: "open", path: ref.path, pin: false});
			setLineTarget(ref);
		};
		const pending = takePendingFileOpen(sessionId);
		if (pending !== null) openRef(pending);
		return onFileOpenRequest(sessionId, openRef);
	}, [sessionId, dispatchFileTabs]);
	const filterRef = useRef<HTMLInputElement>(null);
	const {sourceSelection, setSourceSelected, unselectAllSources} = useFileSourceSelection();
	const sessionFilesList = (
		<SessionFilesList
			sessionFiles={sessionFiles}
			unscannedRecordCount={unscannedRecordCount}
			sourceSelection={sourceSelection}
			cwd={cwd}
			query={query}
			onQueryChange={setQuery}
			filterRef={filterRef}
			openPath={openPath}
			onOpenFile={openFile}
		/>
	);

	useShortcut(
		"toggle_changes_file_list",
		() => {
			if (host.layout.focused !== "files") return false;
			setTreeShown((shown) => !shown);
			return true;
		},
		{priority: 1},
	);

	useEffect(() => {
		if (consumePendingFilterFocus()) filterRef.current?.focus();
	}, []);

	useEffect(() => {
		if (focusRequest === 0) return;
		filterRef.current?.focus();
		filterRef.current?.select();
	}, [focusRequest]);

	const attachToChat: AttachContextHandler | undefined =
		sessionId === undefined
			? undefined
			: (attachment) => {
					attachContext(sessionId, attachment);
				};
	const askInChat =
		sessionId === undefined
			? undefined
			: (prompt: string) => {
					requestComposerInsert(sessionId, prompt);
				};

	function revealInTree(path: string): void {
		const relPath = relativeToCwd(cwd, path);
		if (relPath === null) return;
		const lastSlash = relPath.lastIndexOf("/");
		setTreeShown(true);
		setMode("workspace");
		setQuery(lastSlash === -1 ? "" : `${relPath.slice(0, lastSlash)}/`);
	}

	function searchFiles(): void {
		setTreeShown(true);
		setFocusRequest((request) => request + 1);
	}

	return (
		<>
			<div data-files-header className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<TreeToggle shown={treeShown} onToggle={() => setTreeShown((shown) => !shown)} />
					{fileTabs.tabs.length === 0 ? (
						<span data-pane-title className="truncate text-body text-secondary select-none">
							Files
						</span>
					) : (
						<FileTabsStrip
							state={fileTabs}
							dispatch={dispatchFileTabs}
							cwd={cwd}
							onAttachContext={attachToChat}
							onRevealInTree={revealInTree}
						/>
					)}
					{chrome.moveHandle}
				</div>
				<div className="relative flex shrink-0 items-center gap-0.5">
					<Tooltip content="Search files">
						<button
							type="button"
							aria-label="Search files"
							onClick={searchFiles}
							className={GHOST_ICON_BUTTON}
						>
							<Search aria-hidden="true" className="size-4" />
						</button>
					</Tooltip>
					<FilesSettingsMenu
						treeShown={treeShown}
						onTreeShownChange={setTreeShown}
						sources={{
							counts: sessionFiles.counts,
							sourceSelection,
							onSourceSelectedChange: setSourceSelected,
							onUnselectAll: unselectAllSources,
						}}
					/>
					{chrome.controls}
				</div>
			</div>
			<div className="flex min-h-0 flex-1 overflow-hidden rounded-b-[inherit]">
				{treeShown && (
					<FilesTreeColumn>
						{sessionId === undefined ? (
							sessionFilesList
						) : (
							<WorkspaceOrSessionList
								sessionId={sessionId}
								mode={mode}
								onModeChange={setMode}
								query={query}
								onQueryChange={setQuery}
								filterRef={filterRef}
								sessionList={sessionFilesList}
								onOpenFile={(relPath, {pin, line, findQuery}) => {
									if (cwd === undefined) return;
									const path = absoluteFromCwd(cwd, relPath);
									openFile(path, {pin});
									if (line !== undefined) {
										setLineTarget({
											path,
											line,
											...(findQuery === undefined ? {} : {findQuery}),
										});
									}
								}}
								activeRelPath={openPath === null ? null : relativeToCwd(cwd, openPath)}
								pinnedRelPaths={pinnedRelPaths}
								cwd={cwd}
								onAttachContext={attachToChat}
								onAsk={askInChat}
							/>
						)}
					</FilesTreeColumn>
				)}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{openPath === null ? (
						<FilesEmpty hasTree={treeShown} tabCount={fileTabs.tabs.length} />
					) : (
						<FileView
							key={openPath}
							path={openPath}
							cwd={cwd}
							line={target?.line}
							endLine={target?.endLine}
							findQuery={target?.findQuery}
							onOpenFile={(path) => openFile(path, {pin: false})}
							onAttachContext={attachToChat}
							onEditStart={() => dispatchTabs({type: "pin", path: openPath})}
							onDirtyChange={(dirty) => editGuard.reportDirty(openPath, dirty)}
						/>
					)}
				</div>
			</div>
			{editGuard.dialog}
		</>
	);
}

interface FilesPaneProps {
	sessionId: string;
	/** The session's working directory, when known. */
	cwd: string | undefined;
	chrome: PaneChrome;
	/** Extraction over the loaded transcript window, used until the full-session scan lands. */
	windowFiles: SessionFiles;
	/** JSONL records before the loaded window. */
	windowStartIndex: number;
	jumpTargetWindow: JumpTargetWindow;
}

function FilesPane({sessionId, cwd, chrome, windowFiles, windowStartIndex, jumpTargetWindow}: FilesPaneProps) {
	// A whole-session inventory costs a full pass over the JSONL, so only an
	// open Files pane asks for it.
	const resources = useQuery(sessionResourcesQueryOptions(sessionId, true)).data;
	return (
		<JumpTargetProvider value={jumpTargetWindow}>
			<FilesPaneView
				chrome={chrome}
				sessionId={sessionId}
				{...(cwd === undefined ? {} : {cwd})}
				sessionFiles={resources?.files ?? windowFiles}
				unscannedRecordCount={resources === undefined ? windowStartIndex : 0}
			/>
		</JumpTargetProvider>
	);
}

/** Registers the `files` pane kind for this session while mounted. */
export function useRegisterFilesPane({
	sessionId,
	cwd,
	windowFiles,
	windowStartIndex,
	jumpTargetWindow,
}: Omit<FilesPaneProps, "chrome">): void {
	useEffect(
		() =>
			registerPane("files", {
				title: "Files",
				header: "custom",
				render: (chrome) => (
					<FilesPane
						sessionId={sessionId}
						cwd={cwd}
						chrome={chrome}
						windowFiles={windowFiles}
						windowStartIndex={windowStartIndex}
						jumpTargetWindow={jumpTargetWindow}
					/>
				),
			}),
		[sessionId, cwd, windowFiles, windowStartIndex, jumpTargetWindow],
	);
}

/** Binds ⇧⌘F: toggle the Files pane, focusing its filter when it opens. */
export function FilesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_files", () => {
		pendingFilterFocus = !host.isOpen("files");
		host.togglePane("files");
	});
	return null;
}
