import {getSingularPatch} from "@pierre/diffs";
import type {FileDiffLoadedFiles, FileDiffMetadata, GetHoveredLineResult} from "@pierre/diffs";
import {FileDiff, GutterUtilitySlotStyles} from "@pierre/diffs/react";
import type {FileDiffOptions} from "@pierre/diffs/react";
import {ArrowUpRight, ChevronDown, ChevronRight, Plus} from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	createContext,
	isValidElement,
	use,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {useCodeThemeBackground} from "../../hooks/use-code-theme-background";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {LazyFileTypeIcon} from "../lazy-file-type-icon";
import {useFizzyLake} from "../../lib/fizzy-lake";
import {
	DIFFS_HOST_CLASS,
	DIFFS_STYLE_OVERRIDES,
	DIFFS_WRAP_STYLE,
	changesDiffMetrics,
	diffLineHeightStyle,
	diffsInjectedCss,
} from "./diffs-config";
import {adoptHunkHeadingCss, decorateHunkHeadings} from "./diff-hunk-heading";
import {railsPostRender} from "./diff-rails";
import {type FileSides, loadWithRetry, toLoadedFiles} from "./diff-file-lines";
import {SHOW_MORE_LINES, expandSeparatorFromClick, relabelTrailingSeparator} from "./diff-separators";
import {Icon} from "../ui/icon";
import {DisabledReason} from "../ui/disabled-reason";
import {IndicatorSlot, Pulse} from "../ui/pulse";
import type {DiffFileMark} from "../../lib/diff-file-marks";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuTrigger} from "../ui/menu";
import {createMenuHandle, type MenuHandle} from "../ui/menu-handle";
import {Tooltip} from "../ui/tooltip";
import {type DiffStyle, useSettings} from "../settings-context";
import {useResolvedTheme} from "../theme-context";

export type {DiffStyle};

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
	/** The file menu (`DiffFileMenuItems`) the header's right-click opens. */
	headerMenu?: ReactNode;
	/** Adds the header's "…" More actions dropdown for `headerMenu` (see `diffFileMenuButtonShown`). */
	headerMenuButton?: boolean;
	/** The file's viewed mark: adds the header's Viewed check. */
	mark?: DiffFileMark | undefined;
	annotations?: readonly DiffFileAnnotation[];
	/** Enables the hovered line's gutter "+" that opens a comment card on that line. */
	onRequestChanges?: (target: DiffLineRange) => void;
	/**
	 * Reads both sides of the file (upstream `td`), `fresh` on a retry. With it the hunk separators expand, loading
	 * the file once on the first expansion; without it (session edits: no checkout) they stay plain.
	 */
	loadFileSides?: ((fresh: boolean) => Promise<FileSides>) | undefined;
	/** Called once when the loader gives up (unreadable after every retry, or drifted since the patch). */
	onLoaderGaveUp?: (() => void) | undefined;
	/** Shows every unchanged line, loading the file first; ignored for a patch without `loadFileSides`. */
	expandUnchanged?: boolean | undefined;
	/** Called after each render of the diff, as upstream's CodeView rechecks a pending scroll anchor (`xn`). */
	onRendered?: (() => void) | undefined;
}

/** One diff line: its number on the old (`deletions`) or new (`additions`) side. */
export interface DiffLineRange {
	side: "additions" | "deletions";
	line: number;
}

/**
 * Upstream's 16px accent "+" (`Zc`) in the hovered line's gutter: the library's absolute slot style, centred
 * on the line. The injected `Ca` moves the slot to the number column's left edge (`left:5px`).
 */
const GUTTER_BUTTON_STYLE: CSSProperties = {
	...GutterUtilitySlotStyles,
	top: "calc((var(--diffs-line-height, 1lh) - 1rem) / 2)",
	bottom: "auto",
};

export function AddCommentGutterButton({
	getHoveredLine,
	onAddComment,
}: {
	getHoveredLine: () => GetHoveredLineResult<"diff"> | undefined;
	onAddComment: (target: DiffLineRange) => void;
}) {
	return (
		<button
			type="button"
			aria-label="Add comment on this line"
			onClick={() => {
				const hovered = getHoveredLine();
				if (hovered !== undefined) {
					onAddComment({side: hovered.side, line: hovered.lineNumber});
				}
			}}
			className="flex size-4 cursor-pointer items-center justify-center rounded bg-fill-accent text-on-accent hover:bg-fill-accent-hover"
			style={GUTTER_BUTTON_STYLE}
		>
			<Plus aria-hidden="true" className="size-3" strokeWidth={2.5} />
		</button>
	);
}

function countChanges(fileDiff: FileDiffMetadata): {added: number; removed: number} {
	let added = 0;
	let removed = 0;
	for (const hunk of fileDiff.hunks) {
		added += hunk.additionLines;
		removed += hunk.deletionLines;
	}
	return {added, removed};
}

function splitPath(path: string): {name: string; dir: string} {
	const slash = path.lastIndexOf("/");
	if (slash === -1) return {name: path, dir: ""};
	return {name: path.slice(slash + 1), dir: path.slice(0, slash)};
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
	/** The file menu (`DiffFileMenuItems`): upstream wraps the whole header in a ContextMenu holding it. */
	menu?: ReactNode;
	/**
	 * Adds the "…" More actions dropdown holding `menu`. Upstream's gate: a viewed mark exists, or the whole-file
	 * toggle is offered on a real (not `isSyntheticDiffRow`) file.
	 */
	showMenuButton?: boolean | undefined;
	/** The file's viewed mark (upstream `Bs`): adds the Viewed check and, when stale, the changed-since label. */
	mark?: DiffFileMark | undefined;
}

const OPEN_FILE_BUTTON_CLASS =
	"flex size-5 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary";
const HOVER_REVEAL_CLASS =
	"opacity-0 transition-opacity group-hover/diff-file:opacity-100 group-focus-within/diff-file:opacity-100 pointer-coarse:opacity-100";

interface MoreMenuHost {
	handle: MenuHandle<ReactNode>;
	armed: boolean;
	arm: () => void;
	/** The trigger whose dropdown is open, by its `id`. */
	openTriggerId: string | null;
}

const MoreMenuHostContext = createContext<MoreMenuHost | null>(null);

/**
 * Upstream `ic`'s lazy dropdown root (`BK`), shared by every file header beneath it through one handle, with each
 * trigger passing its file menu as the payload. It mounts on the first hover (not touch), focus, press or key on any
 * trigger. It sits outside the headers' and the diff body's context menus: Base UI treats a Menu rendered inside a
 * ContextMenu as that menu's child, and Escape then stops closing it after a submenu has opened.
 */
export function DiffFileMenuHost({children}: {children: ReactNode}) {
	const [handle] = useState(() => createMenuHandle<ReactNode>());
	const [armed, setArmed] = useState(false);
	const [openTriggerId, setOpenTriggerId] = useState<string | null>(null);
	const host = useMemo<MoreMenuHost>(
		() => ({
			handle,
			armed,
			arm: () => {
				setArmed(true);
			},
			openTriggerId,
		}),
		[handle, armed, openTriggerId],
	);
	return (
		<MoreMenuHostContext value={host}>
			{children}
			{armed && (
				<Menu
					handle={handle}
					onOpenChange={(open, details) => {
						setOpenTriggerId(open ? (details.trigger?.id ?? null) : null);
					}}
				>
					{({payload}) => <MenuContent align="end">{isValidElement(payload) ? payload : null}</MenuContent>}
				</Menu>
			)}
		</MoreMenuHostContext>
	);
}

/**
 * Upstream `rc`: a ghost xs DotsHorizontal button with the tooltip "More actions" below it (closed while its menu is
 * open), opening the host's dropdown aligned to its end.
 */
function MoreActionsButton({menu}: {menu: ReactNode}) {
	const host = use(MoreMenuHostContext);
	const id = useId();
	if (host === null) return null;
	const arm = host.armed ? undefined : host.arm;
	return (
		<span className="pointer-events-auto flex">
			<Tooltip content="More actions" side="bottom">
				<MenuTrigger
					id={id}
					handle={host.handle}
					payload={menu}
					aria-label="More actions"
					aria-haspopup="menu"
					aria-expanded={host.openTriggerId === id}
					data-cds="Button"
					data-cds-ghost=""
					data-cds-icon-only=""
					data-size="xs"
					onPointerEnter={(event) => {
						if (event.pointerType !== "touch") arm?.();
					}}
					onFocus={arm}
					onPointerDown={arm}
					onMouseDown={arm}
					onKeyDown={arm}
					onClick={arm}
					className="flex size-6 cursor-pointer items-center justify-center rounded-r5 bg-transparent text-secondary hover:bg-fill-ghost-hover hover:text-primary data-[popup-open]:bg-fill-ghost-hover"
				>
					<Icon name="DotsHorizontal" size="sm" />
				</MenuTrigger>
			</Tooltip>
		</span>
	);
}

const VIEWED_UNAVAILABLE = "This file can’t be marked as viewed. Later changes to it wouldn’t be detected.";
const VIEWED_STALE = "Changed since you viewed it";

/**
 * Upstream cds Button xs ghost iconOnly, whose paint sits on a `[data-cds-part=paint]` layer, plus `Fs` (was `lo`)
 * verbatim: a pressed check draws no selected paint, only the filled glyph, and keeps the ghost hover.
 */
const VIEWED_BUTTON_CLASS =
	"cds-reset group/btn relative isolate flex size-6 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:text-primary hide-focus-ring focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-disabled aria-pressed:[&_[data-cds-part=paint]]:bg-transparent aria-pressed:hover:[&_[data-cds-part=paint]]:bg-fill-ghost-hover aria-pressed:hover:[&_[data-cds-part=paint]]:bg-none";
const PAINT_LAYER_CLASS = "absolute -z-[1] rounded-[inherit] inset-0";
const VIEWED_PAINT_CLASS = "absolute inset-0 rounded-[inherit] bg-transparent group-hover/btn:bg-fill-ghost-hover";

/** Upstream `Mo`: the header's Viewed check, with the Pulse indicator and a hidden description when stale. */
function ViewedButton({mark}: {mark: DiffFileMark}) {
	const staleId = useId();
	const marked = mark.status === "marked";
	const stale = mark.status === "stale";
	return (
		<span className="pointer-events-auto flex">
			<DisabledReason reason={mark.canMark ? undefined : VIEWED_UNAVAILABLE} side="bottom">
				<Tooltip
					content={marked ? "Mark as not viewed" : "Mark as viewed"}
					detail={stale ? VIEWED_STALE : undefined}
					side="bottom"
					openWhen={() => mark.canMark}
				>
					<button
						type="button"
						aria-label="Viewed"
						aria-pressed={marked}
						aria-describedby={stale ? staleId : undefined}
						disabled={!mark.canMark}
						data-cds="Button"
						data-cds-ghost=""
						data-cds-icon-only=""
						data-size="xs"
						onClick={() => {
							mark.setMarked(!marked);
						}}
						className={VIEWED_BUTTON_CLASS}
					>
						<span aria-hidden="true" className={PAINT_LAYER_CLASS}>
							<span data-cds-part="paint" className={VIEWED_PAINT_CLASS} />
						</span>
						<IndicatorSlot
							icon={<Icon name={marked ? "CheckCircleFilled" : "CheckCircle"} size="sm" />}
							indicator={stale ? <Pulse animate={false} /> : undefined}
						/>
					</button>
				</Tooltip>
			</DisabledReason>
			{stale && (
				<span id={staleId} hidden>
					{VIEWED_STALE}
				</span>
			)}
		</span>
	);
}

function OpenFileButton({onOpenFile}: {onOpenFile: () => void}) {
	return (
		<button type="button" aria-label="Open file" onClick={onOpenFile} className={OPEN_FILE_BUTTON_CLASS}>
			<ArrowUpRight aria-hidden="true" className="size-3" />
		</button>
	);
}

/** Upstream's 32px Changes file header: chevron, name, dir, "Renamed from", +a −r, hover "Open file". */
export function DiffFileHeader(props: DiffFileHeaderProps) {
	const host = use(MoreMenuHostContext);
	if (host === null && props.showMenuButton === true && props.menu !== undefined) {
		return (
			<DiffFileMenuHost>
				<DiffFileHeaderRow {...props} />
			</DiffFileMenuHost>
		);
	}
	return <DiffFileHeaderRow {...props} />;
}

function DiffFileHeaderRow({
	path,
	prevPath,
	additions,
	deletions,
	collapsed,
	onToggle,
	onOpenFile,
	menu,
	showMenuButton = false,
	mark,
}: DiffFileHeaderProps) {
	const {name, dir} = splitPath(path);
	const menuButton = showMenuButton && menu !== undefined;
	const cluster = menuButton || mark !== undefined;
	const stale = mark?.status === "stale";
	const stats = (
		<>
			<span className="text-diff-added">+{additions}</span>
			<span className="text-diff-removed">−{deletions}</span>
		</>
	);
	const Chevron = collapsed ? ChevronRight : ChevronDown;
	const content = (
		<>
			<button
				type="button"
				aria-expanded={!collapsed}
				onClick={onToggle}
				className="flex h-8 w-full shrink-0 cursor-pointer select-none items-center gap-[4px] bg-surface-2 px-3 text-left font-sans hover:bg-fill-ghost-hover"
			>
				<span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-ink-muted">
					<Chevron className="size-3.5" />
				</span>
				<LazyFileTypeIcon fileName={name} size="xs" className="text-ink-muted" />
				<span className="flex min-w-0 text-body text-secondary">
					<span
						dir="ltr"
						title={stale ? `${path} (changed since you viewed it)` : undefined}
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
				{stale ? (
					// Upstream `go` (`ks`): the label wraps away inside the one-line clip when there's no room for it.
					<span className="flex h-[1lh] min-w-min grow shrink-[1e12] flex-row-reverse flex-wrap items-center justify-end gap-[4px] overflow-clip text-body">
						<span className="grid max-w-max min-w-0 grow basis-[8ch] grid-cols-[minmax(0,max-content)] text-muted-as-secondary">
							<span className="truncate">{VIEWED_STALE}</span>
						</span>
						<span className="order-first ms-auto flex shrink-0 items-center gap-[4px] tabular-nums">
							{stats}
						</span>
					</span>
				) : (
					<span className="ml-auto flex shrink-0 items-center gap-0.5 text-body tabular-nums">{stats}</span>
				)}
				{/* Upstream `go`: one w-control spacer per overlaid action, so the stats never slide under them. */}
				{onOpenFile && (
					<span
						aria-hidden="true"
						data-size="xs"
						className={cluster ? "w-6 shrink-0 @max-[15rem]/diff-file:hidden" : "w-6 shrink-0"}
					/>
				)}
				{mark && <span aria-hidden="true" data-size="xs" className="w-6 shrink-0" />}
				{menuButton && <span aria-hidden="true" data-size="xs" className="w-6 shrink-0" />}
			</button>
			{cluster ? (
				// Upstream `jo`: `pointer-events-none absolute inset-0 flex items-center justify-end gap-[4px] px-md`.
				<span className="pointer-events-none absolute inset-0 flex items-center justify-end gap-[4px] px-3">
					{mark && <ViewedButton mark={mark} />}
					{onOpenFile && (
						<span
							className={`pointer-events-auto flex @max-[15rem]/diff-file:hidden ${HOVER_REVEAL_CLASS}`}
						>
							<OpenFileButton onOpenFile={onOpenFile} />
						</span>
					)}
					{menuButton && <MoreActionsButton menu={menu} />}
				</span>
			) : (
				onOpenFile && (
					<span className={`absolute inset-y-0 right-0 flex items-center pr-3 ${HOVER_REVEAL_CLASS}`}>
						<OpenFileButton onOpenFile={onOpenFile} />
					</span>
				)
			)}
		</>
	);
	const rootClass = "group/diff-file @container/diff-file relative";
	if (menu === undefined) {
		return (
			<div data-diff-file-header={path} className={rootClass}>
				{content}
			</div>
		);
	}
	// Upstream c44d00c7f: `ContextMenu.Trigger className="group/panel-subheader @container/diff-file relative"`.
	// Stopping the event here keeps the body's line menu (DiffContextMenu) from opening too.
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<div data-diff-file-header={path} className={rootClass} />}
				onContextMenu={(event) => {
					event.stopPropagation();
				}}
			>
				{content}
			</ContextMenuTrigger>
			<MenuContent>{menu}</MenuContent>
		</ContextMenu>
	);
}

/** Upstream `Tn`'s WeakMap: each fileDiff's load, kept while pierre (or a remount) holds that fileDiff. */
const loadedFiles = new WeakMap<FileDiffMetadata, Promise<FileDiffLoadedFiles>>();

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
	headerMenu,
	headerMenuButton = false,
	mark,
	annotations,
	onRequestChanges,
	loadFileSides,
	onLoaderGaveUp,
	expandUnchanged = false,
	onRendered,
}: DiffFileProps) {
	const fileDiff = useMemo(() => getSingularPatch(patch), [patch]);
	const loader = useRef({loadFileSides, onLoaderGaveUp, onRendered, fileDiff});
	loader.current = {loadFileSides, onLoaderGaveUp, onRendered, fileDiff};
	const canLoad = loadFileSides !== undefined;
	// Upstream `Cn`/`Tn`: one load per fileDiff, so a remount (new metrics) doesn't read the file again.
	const loadDiffFiles = useMemo(() => {
		if (!canLoad) return undefined;
		return async (target: FileDiffMetadata) => {
			const cached = loadedFiles.get(target);
			if (cached !== undefined) return cached;
			const loading = loadWithRetry(
				async (fresh) => {
					const current = loader.current;
					if (current.fileDiff !== target || current.loadFileSides === undefined) return "park";
					const sides = await current.loadFileSides(fresh);
					if (loader.current.fileDiff !== target) return "park";
					const files = toLoadedFiles(target, {path: target.name, oldPath: target.prevName}, sides);
					return files === "unavailable" ? "retry" : files === "drifted" ? "park" : files;
				},
				() => {
					if (loader.current.fileDiff === target) loader.current.onLoaderGaveUp?.();
				},
			);
			loadedFiles.set(target, loading);
			return loading;
		};
	}, [canLoad]);
	const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
	const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
	const toggle = () => {
		setUncontrolledCollapsed(!collapsed);
		onCollapsedChange?.(!collapsed);
	};
	const resolvedTheme = useResolvedTheme();
	const codeThemes = useCodeThemes();
	const codeThemeBg = useCodeThemeBackground();
	const panels = useFizzyLake("panels");
	const {codeFontSize} = useSettings().settings;
	const metrics = useMemo(() => changesDiffMetrics(codeFontSize), [codeFontSize]);

	const lineAnnotations = useMemo(
		() =>
			annotations?.map(({side, lineNumber, content}) => ({
				side,
				lineNumber,
				metadata: content,
			})),
		[annotations],
	);

	const options = useMemo<FileDiffOptions<ReactNode, undefined>>(() => {
		const drawRails = railsPostRender(onRequestChanges !== undefined);
		return {
			theme: codeThemes,
			themeType: resolvedTheme,
			diffStyle,
			diffIndicators: "classic",
			overflow: wordWrap ? "wrap" : "scroll",
			hunkSeparators: "line-info",
			lineDiffType: wordDiff ? "word-alt" : "none",
			stickyHeader: true,
			collapsed,
			enableGutterUtility: onRequestChanges !== undefined,
			// c44d00c7f Kt/qt: upstream always inlines gaps of up to 3 lines once the whole file is known.
			collapsedContextThreshold: 3,
			// The cds FileDiff gate (`Va`): expandUnchanged only for a diff that is whole or can be loaded.
			expandUnchanged: expandUnchanged && (!fileDiff.isPartial || loadDiffFiles !== undefined),
			...(loadDiffFiles === undefined ? {} : {loadDiffFiles}),
			// Upstream c44d00c7f `xn`: `se.draw(e)` (Q(wordDiff, !readOnly).draw), the partial diff's "Show more
			// lines" relabel (c91a5e4a6 o), then `Bn(e, fileDiff)` (c91a5e4a6 g).
			onPostRender: (node, instance, phase) => {
				drawRails(node, instance, phase);
				if (phase === "unmount") return;
				if (fileDiff.isPartial) relabelTrailingSeparator(node, SHOW_MORE_LINES);
				adoptHunkHeadingCss(node);
				decorateHunkHeadings(node, fileDiff);
				loader.current.onRendered?.();
			},
			unsafeCSS: diffsInjectedCss({
				disableFileHeader: false,
				gutterUtility: onRequestChanges !== undefined,
				panels,
			}),
		};
	}, [
		fileDiff,
		codeThemes,
		resolvedTheme,
		diffStyle,
		wordWrap,
		wordDiff,
		collapsed,
		onRequestChanges,
		panels,
		expandUnchanged,
		loadDiffFiles,
	]);
	// Upstream sets the Changes font from JS: the pane sits outside the CSS hook classes for Code font size.
	const style = useMemo<CSSProperties>(
		() => ({
			...DIFFS_STYLE_OVERRIDES,
			"--cds-filediff-bg": codeThemeBg,
			...(wordWrap ? DIFFS_WRAP_STYLE : {}),
			...diffLineHeightStyle(metrics),
			...(codeFontSize === null ? {} : {"--diffs-font-size": `${codeFontSize / 16}rem`}),
		}),
		[codeThemeBg, wordWrap, metrics, codeFontSize],
	);

	// Pierre 1.6.2 reads `metrics` only when the instance is created, so a new lineHeight remounts (upstream ca817835b key).
	// Upstream's cds FileDiff (`Va`) puts the host style on a wrapping div; the vars inherit into the shadow root.
	// Upstream's diff body (`[data-diff-body-menu-trigger]`) clicks a separator's expand buttons from its label (`Xn`).
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for the separator's expand buttons, which pierre draws as its keyboard controls
		<div
			data-cds="FileDiff"
			dir="ltr"
			className={DIFFS_HOST_CLASS}
			style={style}
			onClick={(event) => {
				expandSeparatorFromClick(event.nativeEvent);
			}}
		>
			<FileDiff<ReactNode>
				key={metrics.lineHeight}
				fileDiff={fileDiff}
				options={options}
				metrics={metrics}
				disableWorkerPool
				{...(lineAnnotations === undefined
					? {}
					: {lineAnnotations, renderAnnotation: (annotation): ReactNode => annotation.metadata})}
				{...(onRequestChanges === undefined
					? {}
					: {
							renderGutterUtility: (getHoveredLine) => (
								<AddCommentGutterButton
									getHoveredLine={getHoveredLine}
									onAddComment={onRequestChanges}
								/>
							),
						})}
				renderCustomHeader={(file) => {
					const {added, removed} = countChanges(file);
					return (
						<DiffFileHeader
							path={file.name}
							prevPath={file.prevName}
							additions={added}
							deletions={removed}
							collapsed={collapsed}
							onToggle={toggle}
							onOpenFile={onOpenFile}
							menu={headerMenu}
							showMenuButton={headerMenuButton}
							mark={mark}
						/>
					);
				}}
			/>
		</div>
	);
}
