import {useQuery} from "@tanstack/react-query";
import {Folder, PanelLeft, Search} from "lucide-react";
import {type ReactNode, type Ref, type RefObject, useCallback, useEffect, useRef, useState} from "react";

import {useFilesTreeCanFit} from "../../hooks/use-files-tree-can-fit";
import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {sessionFilesQueryOptions} from "../../lib/api/session-files";
import {sessionResourcesQueryOptions} from "../../lib/api/sessions";
import {EMPTY_FILE_TABS, type FileTabsAction, type FileTabsState, fileTabsReducer} from "../../lib/file-tabs";
import {type AttachContextHandler, attachContext, requestComposerInsert} from "../../lib/context-attach";
import {EMPTY_EDIT_GUARD, type EditGuardEvent, editGuardReducer} from "../../lib/file-edit";
import {onFileOpenRequest, takePendingFileOpen} from "../../lib/file-open-requests";
import type {FileRef} from "../../lib/file-refs";
import {loadFileTabs, saveFileTabs} from "../../lib/pane-layout";
import {SUPPRESS_NATIVE_MENU_POPUP_PROPS} from "../../lib/native-context-menu";
import {isAnotherOverlayOpen} from "../../lib/overlay";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import type {SessionFiles} from "../../lib/session-files";
import {FILE_TAB_SIZES, normalizeFileTabSize} from "../../lib/file-preview";
import {CoachMark} from "../coach-mark";
import {useCoachMarkSeen} from "../../hooks/use-coach-mark-seen";
import {ConfirmDialog} from "../confirm-dialog";
import {FileTypeIconSetContext, useActiveFileTypeIconSet} from "../file-type-icon-set-context";
import type {ContentMatchOpenOptions} from "../files/content-search-results";
import {FileView} from "../files/file-view";
import {FileTabsStrip} from "../files/file-tabs-strip";
import {FileColumnPositionSubmenu} from "../files/file-column-position-menu";
import {useFileColumnOnRight} from "../files/file-column-side";
import {FilesTree, FilesTreeColumn} from "../files/files-tree";
import {FILES_BODY_CLASS} from "../files/files-tree-layout";
import {JumpTargetProvider, type JumpTargetWindow} from "../jump-target-context";
import {useSettings} from "../settings-context";
import
{
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
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";
import {PaneHeaderRow, PaneNameTitle} from "./pane-header-row";
import {consumePendingFilterFocus} from "./files-filter-focus";
import {usePaneHost} from "./pane-host-context";
import type {PaneChrome} from "./pane-registry";
import {filesEmptyState} from "./files-empty-state";
import
{
	FILE_SOURCE_OPTIONS,
	type FileSourceSelection,
	sessionFileLabel,
	useFileSourceSelection,
} from "./session-file-sources";
import {SessionFilesList} from "./session-files-list";

/** The Files tree coach mark's seen flag (upstream's `epitaxy_files_tree_nux`). */
export const FILES_TREE_COACH_MARK_KEY = "ccb.coachmark.filesTree";

/** Upstream's shared-120 `f7`: the PDF and Office viewers keep the files tree coach mark hidden. */
const COACH_MARK_HIDDEN_PATH = /\.(pdf|docx?|pptx?|xlsx?)$/i;

function TreeToggle({ref, shown, onToggle}: {ref?: Ref<HTMLButtonElement>; shown: boolean; onToggle: () => void})
{
	const keys = useShortcutKeys("toggle_changes_file_list");
	const label = shown ? "Hide file tree" : "Show file tree";
	return (
		<Tooltip content={label} shortcut={keys.keys}>
			<button
				ref={ref}
				type="button"
				aria-pressed={shown}
				aria-label={label}
				aria-keyshortcuts={keys.ariaKeyShortcuts}
				onClick={onToggle}
				className={PANE_HEADER_ICON_BUTTON_CLASS}
			>
				<PanelLeft aria-hidden="true" className="size-4" />
			</button>
		</Tooltip>
	);
}

interface FileSourcesMenuProps
{
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
})
{
	const treeKeys = useShortcutKeys("toggle_changes_file_list");
	const {settings, setSetting} = useSettings();
	return (
		<Menu>
			<MenuTrigger aria-label="Files settings" className={PANE_HEADER_ICON_BUTTON_CLASS}>
				<Icon name="DotsVertical" size="sm" />
			</MenuTrigger>
			<MenuContent align="end" popupProps={SUPPRESS_NATIVE_MENU_POPUP_PROPS}>
				<MenuCheckboxItem checked={treeShown} onCheckedChange={onTreeShownChange} shortcut={treeKeys.keys}>
					Show file tree
				</MenuCheckboxItem>
				<FileColumnPositionSubmenu label="File tree position" />
				<MenuSeparator />
				<MenuCheckboxItem
					checked={settings.filesPreviewTabs}
					onCheckedChange={(checked) =>
					{
						setSetting("filesPreviewTabs", checked);
					}}
				>
					Preview tabs
				</MenuCheckboxItem>
				<MenuSeparator />
				<MenuCheckboxItem
					checked={settings.filesWordWrap}
					onCheckedChange={(checked) =>
					{
						setSetting("filesWordWrap", checked);
					}}
				>
					Word wrap
				</MenuCheckboxItem>
				<MenuCheckboxItem
					checked={settings.filesIndentGuides}
					onCheckedChange={(checked) =>
					{
						setSetting("filesIndentGuides", checked);
					}}
				>
					Indent guides
				</MenuCheckboxItem>
				<MenuCheckboxItem
					checked={settings.filesShowWhitespace}
					onCheckedChange={(checked) =>
					{
						setSetting("filesShowWhitespace", checked);
					}}
				>
					Show whitespace
				</MenuCheckboxItem>
				<MenuCheckboxItem
					checked={settings.filesScrollPastEnd}
					onCheckedChange={(checked) =>
					{
						setSetting("filesScrollPastEnd", checked);
					}}
				>
					Scroll past end
				</MenuCheckboxItem>
				<MenuSub>
					<MenuSubTrigger value={normalizeFileTabSize(settings.filesTabSize)}>Tab size</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup
							value={normalizeFileTabSize(settings.filesTabSize)}
							onValueChange={(value: unknown) =>
							{
								setSetting("filesTabSize", normalizeFileTabSize(Number(value)));
							}}
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
				<MenuCheckboxItem
					checked={settings.filesHideIgnored}
					onCheckedChange={(checked) =>
					{
						setSetting("filesHideIgnored", checked);
					}}
				>
					Hide ignored files
				</MenuCheckboxItem>
				<MenuSub>
					<MenuSubTrigger>Show files from</MenuSubTrigger>
					<MenuSubContent>
						{FILE_SOURCE_OPTIONS.map((option) => (
							<MenuCheckboxItem
								key={option.key}
								checked={sources.sourceSelection[option.key]}
								onCheckedChange={(checked) =>
								{
									sources.onSourceSelectedChange(option.key, checked);
								}}
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

function FilesEmpty({hasTree, tabCount, inSession}: {hasTree: boolean; tabCount: number; inSession: boolean})
{
	const copy = filesEmptyState(
		hasTree,
		tabCount,
		{
			inSession,
			treeAvailable: true,
		},
	);
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
			<Folder aria-hidden="true" className="size-7 text-t6" />
			<div className="flex flex-col items-center gap-1">
				<p className="max-w-[36ch] text-pretty break-words text-pane text-secondary">{copy.title}</p>
				<p className="max-w-[36ch] text-pretty break-words text-footnote text-t6">{copy.detail}</p>
			</div>
		</div>
	);
}

type FilesListMode = "workspace" | "session";

const FILES_LIST_MODES: ReadonlyArray<
{
	mode: FilesListMode;
	label: string;
}> = [
	{
		mode: "workspace",
		label: "Workspace",
	},
	{
		mode: "session",
		label: "Session",
	},
];

function FilesModeSwitch({mode, onModeChange}: {mode: FilesListMode; onModeChange: (mode: FilesListMode) => void})
{
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
						onClick={() =>
						{
							onModeChange(option.mode);
						}}
						className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-r3 text-footnote text-secondary transition-colors hover:text-primary aria-checked:bg-surface-0 aria-checked:text-primary aria-checked:shadow-sm"
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

interface WorkspaceOrSessionListProps
{
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
}: WorkspaceOrSessionListProps): ReactNode
{
	const {settings} = useSettings();
	// Same key as the tree's root listing, so this shares its request.
	const root = useQuery(
		sessionFilesQueryOptions(
			sessionId,
			{
				dir: "",
				query: "",
				hideIgnored: settings.filesHideIgnored,
			},
		),
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
/** The pane's tabs, their dispatch, and whether the stored tab set has been restored yet. */
function useFileTabs(sessionId: string | undefined): [FileTabsState, (action: FileTabsAction) => void, boolean]
{
	const {settings} = useSettings();
	const previewTabs = settings.filesPreviewTabs;
	const [entry, setEntry] = useState<
	{
		key: string | null;
		tabs: FileTabsState;
	}>(
		{
			key: null,
			tabs: EMPTY_FILE_TABS,
		},
	);
	const loadedRef = useRef<FileTabsState | null>(null);
	const key = sessionId ?? "";

	useEffect(() =>
	{
		const tabs = sessionId === undefined ? EMPTY_FILE_TABS : loadFileTabs(sessionId);
		loadedRef.current = tabs;
		setEntry(
			{
				key: sessionId ?? "",
				tabs,
			},
		);
	}, [sessionId]);

	useEffect(() =>
	{
		if (sessionId === undefined || entry.key !== sessionId || entry.tabs === loadedRef.current)
		{
			return;
		}
		saveFileTabs(sessionId, entry.tabs);
	}, [entry, sessionId]);

	const dispatch = useCallback(
		(action: FileTabsAction) =>
		{
			setEntry((prev) =>
			{
				const tabs = fileTabsReducer(
					prev.tabs,
					action,
					{
						previewTabs,
					},
				);
				return tabs === prev.tabs
					? prev
					:
						{
							...prev,
							tabs,
						};
			});
		},
		[previewTabs],
	);

	const restored = entry.key === key;
	return [restored ? entry.tabs : EMPTY_FILE_TABS, dispatch, restored];
}

/**
 * Wraps the tab dispatch with the unsaved-changes guard: an action that would
 * leave or close the tab being edited waits on "Discard unsaved changes?".
 */
function useEditGuard(
	tabs: FileTabsState,
	dispatchTabs: (action: FileTabsAction) => void,
):
{
	dispatch: (action: FileTabsAction) => void;
	reportDirty: (path: string, dirty: boolean) => void;
	dialog: ReactNode;
}
{
	const [guard, setGuard] = useState(EMPTY_EDIT_GUARD);
	const guardRef = useRef(guard);
	const tabsRef = useRef(tabs);
	useEffect(() =>
	{
		tabsRef.current = tabs;
	}, [tabs]);

	const apply = useCallback(
		(event: EditGuardEvent) =>
		{
			const {state, forward} = editGuardReducer(guardRef.current, event);
			guardRef.current = state;
			setGuard(state);
			if (forward !== null) dispatchTabs(forward);
		},
		[dispatchTabs],
	);
	const dispatch = useCallback(
		(action: FileTabsAction) =>
		{
			apply(
				{
					type: "request",
					action,
					tabs: tabsRef.current,
				},
			);
		},
		[apply],
	);
	const reportDirty = useCallback(
		(path: string, dirty: boolean) =>
		{
			apply(
				{
					type: "dirty",
					path,
					dirty,
				},
			);
		},
		[apply],
	);

	const dirtyName = guard.dirtyPath?.slice(guard.dirtyPath.lastIndexOf("/") + 1) ?? "";
	const dialog = (
		<ConfirmDialog
			open={guard.pending !== null}
			onOpenChange={(open) =>
			{
				if (!open && guardRef.current.pending !== null)
					apply(
						{
							type: "keepEditing",
						},
					);
			}}
			title="Discard unsaved changes?"
			body={`Your edits to ${dirtyName} have not been saved. Leaving this tab discards them.`}
			cancelLabel="Keep editing"
			confirmLabel="Discard"
			variant="danger"
			onConfirm={() =>
			{
				apply(
					{
						type: "discard",
					},
				);
			}}
		/>
	);
	return {
		dispatch,
		reportDirty,
		dialog,
	};
}

function absoluteFromCwd(cwd: string, relPath: string): string
{
	return `${cwd.replace(/\/+$/, "")}/${relPath}`;
}

/** A tab's path relative to the working directory, or null outside it. */
function relativeToCwd(cwd: string | undefined, path: string): string | null
{
	const label = sessionFileLabel(path, cwd);
	return label === path ? null : label;
}

interface FilesPaneViewProps
{
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
 * The Files pane surface, header included: row 1 "Files" (or the tab strip) · Expand · Close · Move,
 * row 2 the breadcrumb lead · Go to file or search · Hide file tree · Files settings, over the
 * tree column (the workspace tree) and the viewer column.
 */
export function FilesPaneView({chrome, sessionId, cwd, sessionFiles, unscannedRecordCount}: FilesPaneViewProps)
{
	const host = usePaneHost();
	const iconSet = useActiveFileTypeIconSet();
	// Upstream's filesTreeShown, false outside a pop-out; filesTreePeek is the transient tree beside a file opened
	// from the tree column or revealed in it, cleared by any explicit show or hide.
	const [treeShown, setTreeShown] = useState(false);
	const [treePeek, setTreePeek] = useState(false);
	const treeOn = treeShown || treePeek;
	// Upstream's filesTreeHiddenWhileEmpty: the toggle's hide while no tab is open, reset by any open.
	const [hiddenWhileEmpty, setHiddenWhileEmpty] = useState(false);
	// Upstream's treeReturnPath: the file a narrow pane swapped for the full-width tree.
	const [treeReturnPath, setTreeReturnPath] = useState<string | null>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const measuredRef = useRef(false);
	// The file beside which a filter focus peeked the tree before the first measurement, assuming the pane fit.
	const replayFilterFocusRef = useRef<string | null>(null);
	const canFit = useFilesTreeCanFit(bodyRef, (fits) =>
	{
		measuredRef.current = true;
		// Upstream's first-measure replay: a filter focus that peeked the tree beside a file, in a pane too narrow
		// for it, swaps the file for the full-width tree instead.
		if (!fits && openPath !== null && openPath === replayFilterFocusRef.current && treeOn)
		{
			showTreeOverTabs();
			setFocusRequest((request) => request + 1);
		}
		replayFilterFocusRef.current = null;
	});
	const [focusRequest, setFocusRequest] = useState(0);
	const [mode, setMode] = useState<FilesListMode>("workspace");
	const [query, setQuery] = useState("");
	const [fileTabs, dispatchTabs, tabsRestored] = useFileTabs(sessionId);
	const editGuard = useEditGuard(fileTabs, dispatchTabs);
	const dispatchFileTabs = editGuard.dispatch;
	const openPath = fileTabs.active;
	const pinnedRelPaths = new Set(
		fileTabs.tabs.flatMap((tab) =>
		{
			const relPath = tab.preview ? null : relativeToCwd(cwd, tab.path);
			return relPath === null ? [] : [relPath];
		}),
	);
	const [lineTarget, setLineTarget] = useState<
		| (FileRef &
		  {
				findQuery?: string;
		  })
		| null
	>(null);
	const treeOnRight = useFileColumnOnRight();
	const [shownPath, setShownPath] = useState(openPath);
	const [shownRestored, setShownRestored] = useState(tabsRestored);
	if (shownPath !== openPath || shownRestored !== tabsRestored)
	{
		setShownPath(openPath);
		setShownRestored(tabsRestored);
		// Upstream's `El`: the first file opened while the tree fills a fitting pane keeps the tree beside it. A
		// restored tab set is not an open, so it doesn't peek.
		const opened = shownRestored && shownPath === null && openPath !== null;
		if (opened && canFit && !hiddenWhileEmpty && !treeOn) setTreePeek(true);
		if (openPath !== null) setHiddenWhileEmpty(false);
	}
	// Upstream's Wk: under 400px the pane shows the tree OR the file, never both.
	const fileShown = openPath !== null;
	const hiddenEmpty = hiddenWhileEmpty && fileTabs.tabs.length === 0;
	const treeFits = canFit && (!fileShown || treeOn);
	const treeIsShown = fileShown ? treeFits : !hiddenEmpty;
	const treeBesideFile = fileShown && treeOn;
	const treePressed = fileShown ? canFit && treeOn : !hiddenEmpty;
	const [treeToggleButton, setTreeToggleButton] = useState<HTMLButtonElement | null>(null);
	const phone = usePhoneSheet();
	const coachMark = useCoachMarkSeen(FILES_TREE_COACH_MARK_KEY);
	// Upstream's wk: a file open in a fitting pane with the tree hidden, off a phone and outside the PDF/Office viewers.
	const coachMarkOpen =
		openPath !== null &&
		canFit &&
		!treeOn &&
		!phone &&
		!COACH_MARK_HIDDEN_PATH.test(openPath) &&
		!coachMark.hidden &&
		treeToggleButton !== null;

	/** Upstream's showFilesTreeOverTabs: the file gives way to the full-width tree and is remembered. */
	function showTreeOverTabs(): void
	{
		setTreePeek(false);
		setTreeReturnPath(openPath);
		dispatchFileTabs(
			{
				type: "deactivate",
			},
		);
	}

	/**
	 * Upstream's c51596d2b `rt`: the tree toggle, shortcut, menu item, handles and coach mark all land here. Any
	 * route but the coach mark's own action retires the coach mark (`q(J)`).
	 */
	function toggleTree(via: "coachmark" | "other" = "other"): void
	{
		if (via !== "coachmark") coachMark.markSeen();
		if (!fileShown)
		{
			const target = fileTabs.tabs.find((tab) => tab.path === treeReturnPath) ?? fileTabs.tabs.at(-1);
			if (target === undefined)
			{
				setHiddenWhileEmpty((hidden) => !hidden);
				return;
			}
			dispatchFileTabs(
				{
					type: "reveal",
					path: target.path,
				},
			);
			// Accounted for here, so the open doesn't peek: upstream's activate peeks and the hide below clears it.
			setShownPath(target.path);
			if (canFit) setTreeVisible(false);
			return;
		}
		if (canFit) setTreeVisible(!treeOn);
		else showTreeOverTabs();
	}

	/** Upstream's setFilesTreeShown: an explicit show or hide always ends a peek. */
	function setTreeVisible(shown: boolean): void
	{
		setTreeShown(shown);
		setTreePeek(false);
	}

	function setTreePressed(pressed: boolean): void
	{
		if (pressed !== treePressed) toggleTree();
	}

	// Upstream's `Vh`: widening a pane that swapped its file for the tree brings the file back.
	const fitRef = useRef(canFit);
	useEffect(() =>
	{
		const grew = canFit && !fitRef.current;
		fitRef.current = canFit;
		if (!grew || openPath !== null || !fileTabs.tabs.some((tab) => tab.path === treeReturnPath)) return;
		if (treeReturnPath !== null)
			dispatchFileTabs(
				{
					type: "reveal",
					path: treeReturnPath,
				},
			);
	}, [canFit, openPath, treeReturnPath, fileTabs.tabs, dispatchFileTabs]);
	const openFile = (
		path: string,
		options:
		{
			pin: boolean;
		},
	): void =>
	{
		dispatchFileTabs(
			{
				type: "open",
				path,
				pin: options.pin,
			},
		);
	};
	const target = lineTarget?.path === openPath ? lineTarget : null;

	// Transcript file refs open as a preview tab, including one clicked while
	// the pane was closed. Declared after useFileTabs so a restored tab set
	// lands before the requested open.
	useEffect(() =>
	{
		if (sessionId === undefined) return undefined;
		const openRef = (ref: FileRef): void =>
		{
			dispatchFileTabs(
				{
					type: "open",
					path: ref.path,
					pin: false,
				},
			);
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
		() =>
		{
			if (host.layout.focused !== "files") return false;
			toggleTree();
			return true;
		},
		{
			priority: 1,
		},
	);

	// ⇧⌘F opened the pane: once the stored tabs are back, reveal the tree and focus its filter, as upstream's
	// focusFilesTreeFilter does at open. Before the first measurement it assumes the pane fits; see the replay above.
	const pendingFilterFocusRef = useRef(false);
	useEffect(() =>
	{
		pendingFilterFocusRef.current = consumePendingFilterFocus();
	}, []);
	useEffect(() =>
	{
		if (!tabsRestored || !pendingFilterFocusRef.current) return;
		pendingFilterFocusRef.current = false;
		replayFilterFocusRef.current = measuredRef.current ? null : openPath;
		goToFileOrSearch();
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once, when the stored tabs land; the ref guards re-runs
	}, [tabsRestored]);

	const goToFileKeys = useShortcutKeys("go_to_file_in_changes");
	useShortcut(
		"go_to_file_in_changes",
		() =>
		{
			if (host.layout.focused !== "files") return false;
			// Upstream KA's onMatch: consumed, but a no-op while any cds overlay is open (`zI(doc)`).
			if (!isAnotherOverlayOpen(filterRef.current?.ownerDocument)) goToFileOrSearch();
			return true;
		},
		{
			priority: 1,
		},
	);

	useEffect(() =>
	{
		if (focusRequest === 0) return;
		filterRef.current?.focus();
		filterRef.current?.select();
	}, [focusRequest]);

	const attachToChat: AttachContextHandler | undefined =
		sessionId === undefined
			? undefined
			: (attachment) =>
				{
					attachContext(sessionId, attachment);
				};
	const askInChat =
		sessionId === undefined
			? undefined
			: (prompt: string) =>
				{
					requestComposerInsert(sessionId, prompt);
				};

	function revealInTree(path: string): void
	{
		const relPath = relativeToCwd(cwd, path);
		if (relPath === null) return;
		const lastSlash = relPath.lastIndexOf("/");
		showTree();
		setMode("workspace");
		setQuery(lastSlash === -1 ? "" : `${relPath.slice(0, lastSlash)}/`);
	}

	/** Upstream's revealInFilesTree / focusFilesTreeFilter: a narrow pane swaps its file for the tree. */
	function showTree(): void
	{
		setHiddenWhileEmpty(false);
		if (fileShown && !canFit) showTreeOverTabs();
		// Upstream peeks rather than flipping the shown preference.
		else if (fileShown && !treeShown) setTreePeek(true);
	}

	function goToFileOrSearch(): void
	{
		showTree();
		setFocusRequest((request) => request + 1);
	}

	return (
		<FileTypeIconSetContext value={iconSet}>
			<PaneHeaderRow
				label="Files"
				rowAttributes={
				{
					"data-files-header": "",
				}}
				title={
					<div className="relative flex min-w-0 flex-1 items-center gap-1">
						{fileTabs.tabs.length === 0 ? (
							<PaneNameTitle>Files</PaneNameTitle>
						) : (
							<FileTabsStrip
								state={fileTabs}
								dispatch={dispatchFileTabs}
								cwd={cwd}
								onAttachContext={attachToChat}
								onRevealInTree={revealInTree}
							/>
						)}
					</div>
				}
				actions={
					<>
						<Tooltip content="Go to file or search" shortcut={goToFileKeys.keys}>
							<button
								type="button"
								aria-label="Go to file or search"
								aria-keyshortcuts={goToFileKeys.ariaKeyShortcuts}
								onClick={goToFileOrSearch}
								className={PANE_HEADER_ICON_BUTTON_CLASS}
							>
								<Search aria-hidden="true" className="size-4" />
							</button>
						</Tooltip>
						<TreeToggle
							ref={setTreeToggleButton}
							shown={treePressed}
							onToggle={() =>
							{
								toggleTree();
							}}
						/>
						<CoachMark
							open={coachMarkOpen}
							anchor={treeToggleButton}
							side="bottom"
							align="end"
							className="max-w-xs"
							title="Browse the project beside your file"
							message="Show the file tree to jump between files without leaving this pane. Files you open line up here as tabs."
							action={
							{
								label: "Show file tree",
								onClick: () =>
								{
									coachMark.markSeen();
									toggleTree("coachmark");
								},
							}}
							onDismiss={coachMark.markSeen}
							onClose={coachMark.close}
						/>
						<FilesSettingsMenu
							treeShown={treePressed}
							onTreeShownChange={setTreePressed}
							sources={
							{
								counts: sessionFiles.counts,
								sourceSelection,
								onSourceSelectedChange: setSourceSelected,
								onUnselectAll: unselectAllSources,
							}}
						/>
					</>
				}
				controls={chrome.controls}
				secondRowLead={
					// Upstream portals the open file's breadcrumb here (files-pane-breadcrumb-row); local's breadcrumb still
					// sits in the file view's subheader, so the target stays empty.
					<span
						data-files-breadcrumb=""
						className="draggable-none flex min-w-0 items-center gap-1 self-stretch overflow-x-clip px-1.5 -mx-1.5 flex-1"
					/>
				}
				moveHandle={chrome.moveHandle}
			/>
			<div
				data-pane-body
				ref={bodyRef}
				className={`${FILES_BODY_CLASS} overflow-hidden rounded-b-[inherit]${treeOnRight ? " flex-row-reverse" : ""}`}
			>
				<FilesTreeColumn
					fill={treeIsShown && !treeFits}
					besideFile={treeBesideFile}
					canFit={canFit}
					shown={treeIsShown}
					onShownChange={setTreePressed}
				>
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
							onOpenFile={(relPath, {pin, line, findQuery}) =>
							{
								if (cwd === undefined) return;
								const path = absoluteFromCwd(cwd, relPath);
								openFile(
									path,
									{
										pin,
									},
								);
								if (line !== undefined)
								{
									setLineTarget(
										{
											path,
											line,
											...(findQuery === undefined
												? {}
												:
													{
														findQuery,
													}),
										},
									);
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
				{(fileShown || !treeIsShown || treeFits) && (
					<div data-files-preview className="flex min-h-0 min-w-0 flex-1 flex-col">
						{openPath === null ? (
							<FilesEmpty
								hasTree={treeIsShown}
								tabCount={fileTabs.tabs.length}
								inSession={sessionId !== undefined}
							/>
						) : (
							<FileView
								key={openPath}
								path={openPath}
								cwd={cwd}
								line={target?.line}
								endLine={target?.endLine}
								findQuery={target?.findQuery}
								onOpenFile={(path) =>
								{
									openFile(
										path,
										{
											pin: false,
										},
									);
								}}
								onAttachContext={attachToChat}
								onEditStart={() =>
								{
									dispatchTabs(
										{
											type: "pin",
											path: openPath,
										},
									);
								}}
								onDirtyChange={(dirty) =>
								{
									editGuard.reportDirty(openPath, dirty);
								}}
							/>
						)}
					</div>
				)}
			</div>
			{editGuard.dialog}
		</FileTypeIconSetContext>
	);
}

export interface FilesPaneProps
{
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

export function FilesPane({sessionId, cwd, chrome, windowFiles, windowStartIndex, jumpTargetWindow}: FilesPaneProps)
{
	// A whole-session inventory costs a full pass over the JSONL, so only an
	// open Files pane asks for it.
	const resources = useQuery(sessionResourcesQueryOptions(sessionId, true)).data;
	return (
		<JumpTargetProvider value={jumpTargetWindow}>
			<FilesPaneView
				chrome={chrome}
				sessionId={sessionId}
				{...(cwd === undefined
					? {}
					:
						{
							cwd,
						})}
				sessionFiles={resources?.files ?? windowFiles}
				unscannedRecordCount={resources === undefined ? windowStartIndex : 0}
			/>
		</JumpTargetProvider>
	);
}
