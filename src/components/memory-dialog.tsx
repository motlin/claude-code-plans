import {Dialog} from "@base-ui/react/dialog";
import {useQuery} from "@tanstack/react-query";
import
{
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {CODE_THEME_BG_FALLBACK} from "../hooks/use-code-theme-background";
import {useDebouncedValue} from "../hooks/use-debounced-value";
import {saveMemoryFileText} from "../lib/api/file-edit";
import {memoryFileQueryOptions} from "../lib/api/memory-file";
import {requestFileOpen} from "../lib/file-open-requests";
import
{
	type DiscardGuardState,
	memoryDialogRows,
	memoryDisplayPath,
	memoryFileFacts,
	memoryLineCount,
	type MemoryRow,
	memoryRowNote,
	MEMORY_NOT_CREATED,
	MEMORY_VIEW_ONLY,
	reduceDiscardGuard,
} from "../lib/memory-dialog";
import {useMediaQuery} from "../lib/use-phone-sheet";
import {ConfirmDialog} from "./confirm-dialog";
import {LazySourceEditor} from "./files/lazy-source-editor";
import {SaveErrorBanner} from "./files/save-error-banner";
import type {SourceEditorHandle} from "./files/source-editor";
import {useSourceFileSave} from "./files/use-source-file-save";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {ToastContext} from "./toast-context";
import {cdsButtonClass} from "./ui/cds-button";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DIALOG_BODY_CLASS} from "./ui/dialog-classes";
import {DialogHeader} from "./ui/dialog-header";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";
import {DisabledReason} from "./ui/disabled-reason";
import {useOpenInDefaultApp} from "./use-open-in-default-app";

/** Upstream `Ne`: the file view follows the selection once it has settled this long. */
const FILE_VIEW_SETTLE_MS = 120;
/** Upstream `Ie`: the detail column shows from this width (or while a file is dirty). */
const WIDE_QUERY = "(min-width: 640px)";
/** Upstream `Pe`: Enter on one of these runs it, not the row's primary action. */
const INTERACTIVE = "button, a, [role='button']";
/** Locally the editor is the file's default app. */
const EDITOR_LABEL = "default app";

const UNAVAILABLE = "Couldn’t load this session’s memory files.";
const UNREADABLE = "Couldn’t read this file.";

/** Upstream's three row looks, selected first. */
const ROW_BASE = "hit-row hit-row-main flex h-8 shrink-0 cursor-interactive items-center gap-sm rounded-r4 px-sm";
const ROW_SELECTED = "bg-fill-ghost-selected hover:layers-1-fill-ghost-hover text-primary";
const ROW_UNREADABLE = "text-muted-as-secondary hover:bg-fill-ghost-hover";
const ROW_IDLE = "text-secondary-control hover:bg-fill-ghost-hover";

/** Upstream cds `kV` 2xl. */
const POPUP_CLASS =
	"epitaxy-root break-words fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1024px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100";

/** Why the list has no rows yet: upstream's loading, mid-turn and unavailable states. */
export type MemoryDialogLoad = "ready" | "loading" | "waiting" | "unavailable";

interface Anchor
{
	idx: number;
	path: string;
}

/** Upstream `Ue`: the anchored row, followed by path when rows reorder. */
function anchoredIndex(rows: readonly MemoryRow[], anchor: Anchor): number
{
	if (rows[anchor.idx]?.path === anchor.path) return anchor.idx;
	const index = rows.findIndex((row) => row.path === anchor.path);
	return index >= 0 ? index : anchor.idx;
}

function baseName(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Upstream `F` (`EpitaxyMemoryDialog`): the session's CLAUDE files, each editable in place with autosave. */
export function MemoryDialog({
	sessionId,
	cwd,
	home,
	memoryFiles,
	load,
	onClose,
}: {
	sessionId: string;
	cwd: string | undefined;
	home: string | undefined;
	/** The session's context-breakdown memory files; undefined until a breakdown is known. */
	memoryFiles:
		| readonly
		  {
				path: string;
				type: string;
		  }[]
		| undefined;
	load: MemoryDialogLoad;
	onClose: () => void;
})
{
	const toast = useContext(ToastContext);
	const paneHost = useOptionalPaneHost();
	const openInDefaultApp = useOpenInDefaultApp();
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();
	const rows = useMemo(
		() =>
			memoryFiles === undefined
				? []
				: memoryDialogRows(
						{
							memoryFiles,
							cwd,
							home,
						},
					),
		[memoryFiles, cwd, home],
	);
	const unavailable = memoryFiles === undefined && load === "unavailable";
	useEffect(() =>
	{
		if (unavailable)
			toast?.(
				{
					kind: "error",
					message: UNAVAILABLE,
				},
			);
	}, [unavailable, toast]);

	// The discard guard: the reducer's state plus its held action, run outside the state update.
	const [guardState, setGuardState] = useState<DiscardGuardState<() => void>>(
		{
			dirtyPath: undefined,
			pending: null,
		},
	);
	const guardRef = useRef(guardState);
	const dispatchGuard = useCallback((event: Parameters<typeof reduceDiscardGuard<() => void>>[1]) =>
	{
		const {state, run} = reduceDiscardGuard(guardRef.current, event);
		guardRef.current = state;
		setGuardState(state);
		run?.();
	}, []);
	const guard = useCallback(
		(action: () => void) =>
		{
			dispatchGuard(
				{
					type: "guard",
					action,
				},
			);
		},
		[dispatchGuard],
	);
	const dirtyPath = guardState.dirtyPath;
	const dirty = dirtyPath !== undefined;

	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const anchorIndex =
		anchor === null
			? Math.max(
					0,
					rows.findIndex((row) => row.readable),
				)
			: anchoredIndex(rows, anchor);
	const selectedIndex = Math.min(anchorIndex, Math.max(rows.length - 1, 0));
	const selected = rows[selectedIndex];
	const anchorTo = useCallback(
		(index: number) =>
		{
			setAnchor(
				{
					idx: index,
					path: rows[index]?.path ?? "",
				},
			);
		},
		[rows],
	);

	const wide = useMediaQuery(WIDE_QUERY);
	const paneShown = wide || dirty;
	const target = dirtyPath ?? (paneShown && selected?.readable === true ? selected.path : undefined);
	const settled = useDebouncedValue(target, FILE_VIEW_SETTLE_MS);
	const shownPath = settled === target ? target : undefined;
	const read = useQuery(
		{
			...memoryFileQueryOptions(sessionId, shownPath ?? ""),
			enabled: shownPath !== undefined,
		},
	);
	const readFailed = shownPath !== undefined && read.isError;
	useEffect(() =>
	{
		if (readFailed)
			toast?.(
				{
					kind: "error",
					message: UNREADABLE,
				},
			);
	}, [readFailed, toast]);

	const onDirtyChange = useCallback(
		(nowDirty: boolean) =>
		{
			if (nowDirty && shownPath !== undefined)
				setAnchor(
					(current) =>
						current ??
						{
							idx: -1,
							path: shownPath,
						},
				);
			dispatchGuard(
				{
					type: "dirty",
					path: shownPath,
					dirty: nowDirty,
				},
			);
		},
		[dispatchGuard, shownPath],
	);

	const close = useCallback(() =>
	{
		guard(onClose);
	}, [guard, onClose]);
	/** Upstream's primary "Open": the file in the side Files pane, then close. */
	const primaryFor = (row: MemoryRow | undefined): (() => void) | null =>
		row?.readable === true && paneHost !== null
			? () =>
				{
					guard(() =>
					{
						requestFileOpen(
							sessionId,
							{
								path: row.path,
							},
						);
						paneHost.openPane("files");
						onClose();
					});
				}
			: null;
	const editorFor = (row: MemoryRow | undefined): (() => void) | null =>
		row?.openable === true
			? () =>
				{
					guard(() =>
					{
						openInDefaultApp(row.path);
						onClose();
					});
				}
			: null;
	/** Upstream `X`: Enter and double-click run the primary action, else open in the editor. */
	const openRow = (row: MemoryRow | undefined) =>
	{
		(primaryFor(row) ?? editorFor(row))?.();
	};
	/** Upstream `Z`: a row with the dirty file's path moves freely; any other goes through the guard. */
	const select = (index: number) =>
	{
		if (index === selectedIndex) return;
		if (rows[index]?.path === selected?.path) anchorTo(index);
		else
			guard(() =>
			{
				anchorTo(index);
			});
	};
	/** Upstream `dt`: with the detail shown a click selects; on a phone a tap selects and opens. */
	const choose = (index: number) =>
	{
		if (paneShown) select(index);
		else if (index === selectedIndex) openRow(selected);
		else
		{
			anchorTo(index);
			openRow(rows[index]);
		}
	};

	const listRef = useRef<HTMLUListElement>(null);
	useEffect(() =>
	{
		listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`)?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [selectedIndex]);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
	{
		const element = event.target instanceof Element ? event.target : null;
		if (
			event.nativeEvent.isComposing ||
			rows.length === 0 ||
			element === null ||
			!event.currentTarget.contains(element) ||
			element.closest("[data-memory-file]") !== null
		)
			return;
		if (event.key === "ArrowDown")
		{
			event.preventDefault();
			select(Math.min(selectedIndex + 1, Math.max(rows.length - 1, 0)));
		}
		else if (event.key === "ArrowUp")
		{
			event.preventDefault();
			select(Math.max(selectedIndex - 1, 0));
		}
		else if (event.key === "Enter" && !event.repeat && element.closest(INTERACTIVE) === null)
		{
			event.preventDefault();
			openRow(selected);
		}
	};
	const keepListFocus = (event: MouseEvent<HTMLUListElement>) =>
	{
		if (event.target !== event.currentTarget)
		{
			event.preventDefault();
			listRef.current?.focus(
				{
					preventScroll: true,
				},
			);
		}
	};

	const detailRow =
		shownPath !== undefined && selected?.path !== shownPath ? rows.find((row) => row.path === shownPath) : selected;
	const listEmpty = rows.length === 0 && !unavailable;
	let emptyState: string;
	if (unavailable) emptyState = UNAVAILABLE;
	else if (load === "waiting") emptyState = "Memory files load once Claude finishes responding.";
	else emptyState = "Loading memory files…";

	return (
		<Dialog.Root
			open
			onOpenChange={(open) =>
			{
				if (!open) close();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<DialogPopup
					initialFocus={listRef}
					aria-label="Memory"
					className={`${POPUP_CLASS} z-50`}
					onKeyDown={onKeyDown}
				>
					<div className={`${DIALOG_BODY_CLASS} ${pad.p} ${bandBody}`}>
						<DialogHeader title="Memory" />
						<div className="flex h-[min(30rem,calc(100dvh-12rem))] min-h-[14rem] gap-md">
							<div className="flex min-w-0 flex-1 flex-col gap-md sm:w-[min(22rem,42%)] sm:flex-none">
								<ul
									ref={listRef}
									role="listbox"
									aria-label="Memory files"
									aria-activedescendant={
										selected === undefined ? undefined : `memory-opt-${selectedIndex}`
									}
									aria-busy={listEmpty}
									tabIndex={0}
									className="flex min-h-0 flex-1 flex-col hit-gap-y-0.5 overflow-y-auto overflow-x-hidden outline-none"
									onMouseDown={keepListFocus}
								>
									{rows.length === 0 ? (
										<li
											role="presentation"
											className="px-sm py-1.25 text-body text-muted-as-secondary italic"
										>
											{unavailable ? <span role="alert">{emptyState}</span> : emptyState}
										</li>
									) : (
										rows.map((row, index) => (
											<MemoryRowItem
												key={`${index}:${row.path}`}
												index={index}
												row={row}
												selected={index === selectedIndex}
												onChoose={choose}
												onPick={
													paneShown
														? () =>
															{
																openRow(selected);
															}
														: undefined
												}
											/>
										))
									)}
								</ul>
							</div>
							{paneShown && (
								<MemoryDetail
									row={detailRow}
									home={home}
									read={
										shownPath !== undefined && detailRow?.path === shownPath ? read.data : undefined
									}
									primary={primaryFor(detailRow)}
									openInEditor={editorFor(detailRow)}
									fileView={
										shownPath === undefined ? null : (
											// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- catches Escape from the editor inside it
											<div
												data-memory-file="true"
												className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border"
												style={
												{
													background: CODE_THEME_BG_FALLBACK,
													"--epitaxy-transcript-surface": "var(--code-theme-bg)",
												}}
												onKeyDownCapture={(event) =>
												{
													const element =
														event.target instanceof Element ? event.target : null;
													if (
														event.key !== "Escape" ||
														!dirty ||
														event.nativeEvent.isComposing ||
														// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
														event.nativeEvent.keyCode === 229 ||
														element?.closest('[contenteditable="true"]') == null
													)
														return;
													const plain =
														!event.repeat &&
														!event.defaultPrevented &&
														!event.metaKey &&
														!event.ctrlKey &&
														!event.shiftKey &&
														!event.altKey;
													event.preventDefault();
													event.stopPropagation();
													if (plain) close();
												}}
											>
												<MemoryFileView
													key={shownPath}
													sessionId={sessionId}
													path={shownPath}
													onDirtyChange={onDirtyChange}
												/>
											</div>
										)
									}
								/>
							)}
						</div>
					</div>
					<ConfirmDialog
						open={guardState.pending !== null}
						onOpenChange={(open) =>
						{
							if (!open)
								dispatchGuard(
									{
										type: "keep",
									},
								);
						}}
						title="Discard unsaved changes?"
						body={`Your edits to ${baseName(dirtyPath ?? "")} haven’t been saved. Leaving now discards them.`}
						cancelLabel="Keep editing"
						confirmLabel="Discard"
						variant="danger"
						onConfirm={() =>
						{
							dispatchGuard(
								{
									type: "discard",
								},
							);
						}}
					/>
				</DialogPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** Upstream `Be`. */
function MemoryRowItem({
	index,
	row,
	selected,
	onChoose,
	onPick,
}: {
	index: number;
	row: MemoryRow;
	selected: boolean;
	onChoose: (index: number) => void;
	onPick: (() => void) | undefined;
})
{
	const note = memoryRowNote(row);
	let look = ROW_IDLE;
	if (selected) look = ROW_SELECTED;
	else if (!row.readable) look = ROW_UNREADABLE;
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox owns the keys (↑/↓/Enter)
		<li
			id={`memory-opt-${index}`}
			data-idx={index}
			role="option"
			aria-selected={selected}
			title={note === undefined ? row.path : `${row.path} · ${note}`}
			onClick={() =>
			{
				onChoose(index);
			}}
			onDoubleClick={onPick}
			className={`${ROW_BASE} ${look}`}
		>
			{row.kind === "imported" && (
				<span aria-hidden="true" className="mb-1 ms-sm size-2 shrink-0 border-b border-s border-strong" />
			)}
			<span className={`min-w-0 text-body ${row.kind === "managed" ? "flex flex-1" : "truncate"}`}>
				{row.label}
			</span>
			{note !== undefined && <span className="sr-only">{` (${note})`}</span>}
		</li>
	);
}

/** Upstream `He`: the selected file's heading, path, facts and actions, above its editor. */
function MemoryDetail({
	row,
	home,
	read,
	primary,
	openInEditor,
	fileView,
}: {
	row: MemoryRow | undefined;
	home: string | undefined;
	read:
		|
		  {
				content: string;
				writable: boolean;
		  }
		| undefined;
	primary: (() => void) | null;
	openInEditor: (() => void) | null;
	fileView: ReactNode;
})
{
	if (row === undefined && fileView === null) return <div className="min-w-0 flex-1" />;
	let disabledReason: string | undefined;
	if (row !== undefined && primary === null)
		disabledReason = row.exists ? (memoryRowNote(row) ?? MEMORY_VIEW_ONLY) : MEMORY_NOT_CREATED;
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-md overflow-hidden border-s ps-lg">
			{row !== undefined && (
				<div className="flex flex-col gap-1">
					<h3 className="truncate text-heading font-semibold text-primary">{row.label}</h3>
					{row.kind !== "managed" && (
						<p className="truncate font-mono-ui text-caption text-secondary" title={row.path}>
							{row.openable ? memoryDisplayPath(row.path, undefined, home) : row.path}
						</p>
					)}
					<p className="min-h-[1lh] text-caption text-muted-as-secondary">
						{memoryFileFacts(
							row,
							read === undefined
								? undefined
								:
									{
										lines: memoryLineCount(read.content),
										writable: read.writable,
									},
						)}
					</p>
				</div>
			)}
			{row !== undefined && (
				<div className="flex items-center gap-sm">
					<DisabledReason reason={disabledReason}>
						<button
							type="button"
							disabled={primary === null}
							onClick={() => primary?.()}
							className={cdsButtonClass("primary", "sm")}
						>
							Open
						</button>
					</DisabledReason>
					{openInEditor !== null && (
						<button type="button" onClick={openInEditor} className={cdsButtonClass("secondary", "sm")}>
							{`Open in ${EDITOR_LABEL}`}
						</button>
					)}
				</div>
			)}
			{fileView}
		</div>
	);
}

/** The in-dialog source view of one memory file: CodeMirror with autosave through the memory-file route. */
function MemoryFileView({
	sessionId,
	path,
	onDirtyChange,
}: {
	sessionId: string;
	path: string;
	onDirtyChange: (dirty: boolean) => void;
})
{
	const options = memoryFileQueryOptions(sessionId, path);
	const file = useQuery(options);
	const editorRef = useRef<SourceEditorHandle>(null);
	const editable = file.data?.writable === true;
	const write = useCallback(
		async (target: string, text: string, etag: string | null) => saveMemoryFileText(sessionId, target, text, etag),
		[sessionId],
	);
	const save = useSourceFileSave(
		{
			path,
			queryKey: options.queryKey,
			file: file.data,
			editable,
			lossy: false,
			editorRef,
			onEditStart: undefined,
			onDirtyChange,
			write,
		},
	);
	if (file.data === undefined) return null;
	return (
		<>
			{editable && save.dirty && save.error !== null && (
				<SaveErrorBanner
					error={save.error}
					busy={save.saving}
					inPaneHeaderLine={false}
					onDiscard={save.discard}
					onRetry={save.retry}
				/>
			)}
			<div className="min-h-0 flex-1 overflow-hidden text-code [&_.cm-editor]:h-full">
				<Suspense fallback={null}>
					<LazySourceEditor
						ref={editorRef}
						className="h-full"
						value={file.data.content}
						readOnly={!editable}
						ariaLabel={baseName(path)}
						autoSave={editable && save.autoSave}
						onChange={save.onChange}
						onSave={save.onSave}
						onDiscard={save.discard}
						language="markdown"
					/>
				</Suspense>
			</div>
		</>
	);
}
