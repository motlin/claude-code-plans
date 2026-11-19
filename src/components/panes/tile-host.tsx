import
{
	Component,
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {createPortal} from "react-dom";
import {Maximize2, Minimize2, X} from "lucide-react";

import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {FIZZY_LAKE_PANELS} from "../../lib/fizzy-lake";
import {codeSurfaceStyle} from "./code-surface";
import {PaneChromeHeader} from "./deferred-pane-status";
import {PANE_CLOSE_CONTROL_CLASS, PaneHeaderRow} from "./pane-header-row";
import {PaneCrashBoundary} from "./pane-crash-boundary";
import
{
	closePane,
	chatGutters,
	chatShellPadding,
	CHAT_OVERFLOW_MIN_PX,
	collapsePane,
	defaultPaneLayout,
	expandPane,
	fitPhoneLayout,
	focusNeighbour,
	focusPane,
	hiddenWhileExpanded,
	isNodeHidden,
	leftEdgeTiles,
	loadLastPaneFlex,
	loadPaneLayout,
	minTileSize,
	openPane,
	overlayTile,
	parseTileId,
	rememberPaneFlex,
	resizeDivider,
	resolveFlexes,
	resolveTileLayout,
	saveLastPaneFlex,
	savePaneLayout,
	settleOverlay,
	syncOverlayPaneFlex,
	tileFloor,
	rowEndOnlyTileIds,
	tileShellEdges,
	togglePane,
	topEdgeTiles,
	updatePhoneView,
	wideRowTopPadding,
	type Direction,
	type LayoutNode,
	type OpenPaneOptions,
	type PaneKind,
	type PaneLayoutState,
	type ResolvedNode,
	type StackNode,
	type TileId,
	type TileShellEdges,
} from "../../lib/pane-layout";
import {OVERLAY_SPLIT, overlayFit, overlaySpareWidth} from "../../lib/pane-overlay-fit";
import {siblingMovedAhead, TileContentHosts} from "../../lib/tile-content-hosts";
import
{
	applyTileDrop,
	dropIndicatorOutset,
	KEYBOARD_MOVE_KEYS,
	keyboardTileMove,
	stackDropFeedback,
	stackRectKey,
	wrapDropEdge,
	type DropEdge,
	type KeyboardPreviewSide,
	type TileDropTarget,
} from "../../lib/tile-drop";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {WIDE_TITLE_ROW, type WideTitleRowVariant} from "../../lib/wide-title-row";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";
import
{
	ChatGutterContext,
	PaneExpandToggleContext,
	PaneHostContext,
	chatGutterAttributes,
	type ChatGutterAttributes,
	type PaneHostApi,
} from "./pane-host-context";
import {type PaneDefinition, usePaneDefinitions} from "./pane-registry";
import {TileRowEndContext} from "./tile-row-end-context";
import {TILE_DRAG_LIFT_PX, useTileDrag} from "./use-tile-drag";
import {WideTitleRowContext, type WideTitleRowSlot} from "./wide-title-row-context";

/** Upstream `--tiles-gap`, mirrored by the reducer's gap maths. */
const TILE_GAP_PX = 12;
const RESIZE_STEP_PX = 16;
const RESIZE_STEP_LARGE_PX = 64;
/**
 * Below 640px upstream keeps the split: a side pane holds its 280px minimum
 * beside the chat, which squeezes down to 100px (measured at 386x741, 2026-10-30).
 */
const PHONE_PANE_MIN_CLASS = "min-w-[280px]";
const PHONE_CHAT_MIN_CLASS = "min-w-[100px]";
/** Upstream `Ae` with no measured box: min(minTileBasePx, Infinity − 1). */
const UNMEASURED_MIN_HEIGHT_PX = 100;
/** Below 640px an expanded pane covers the viewport. */
const PHONE_EXPANDED_SLOT_CLASSES = "fixed inset-0 z-40 w-full h-dvh";
/** Upstream's expanded pane: maximised over the sidebar and titlebar, 9px in from the window edge. */
const EXPANDED_SLOT_CLASSES = "fixed inset-[9px] z-40";
/**
 * Upstream ca67f2c9d `rt`: a tile kept mounted while another is expanded leaves the flow but keeps its box,
 * and content-visibility keeps its rendering state (scroll offsets) without painting it.
 */
const HIDDEN_TILE_STYLE =
{
	position: "absolute",
	inset: 0,
	visibility: "hidden",
	contentVisibility: "hidden",
	pointerEvents: "none",
} as const satisfies CSSProperties;

type LayoutUpdate = (state: PaneLayoutState) => PaneLayoutState;

/** Upstream's hide hand-off entry `He`: the hidden tile focus left, and where it landed. */
interface FocusReturn
{
	from: TileId;
	landedOn: Element | null;
}

/** Upstream `kt`: keys that alone are not input. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/** Upstream `At`: a key press that counts as the user's input. */
function isUserInputKey(event: KeyboardEvent): boolean
{
	return !event.ctrlKey && !event.metaKey && !event.altKey && !MODIFIER_KEYS.has(event.key);
}

/** Upstream `keyboardPreview`: a perpendicular Move key waiting for Enter, and the split it would make. */
interface KeyboardPreview
{
	tileId: TileId;
	side: KeyboardPreviewSide;
	target: TileDropTarget;
}

/** Upstream `lastKeyboardMove`: re-keyed per move so a repeat announces again. */
interface KeyboardMoveNotice
{
	position: number;
	total: number;
	seq: number;
}

/**
 * Upstream `VPe`'s result: the pane an unprompted open draws over the lone chat, measured (`drawn`) once its layout
 * effect fits it, or still pending.
 */
interface HostOverlay
{
	tileId: PaneKind;
	drawn: DrawnOverlay | null;
}

interface DrawnOverlay
{
	tileId: PaneKind;
	openedAt: number;
	width: number;
	reservePx: number;
	/** The tile root's width when drawn; a 1px change settles it. */
	containerWidth: number;
}

interface InternalHost
{
	definitions: ReadonlyMap<PaneKind, PaneDefinition>;
	layout: PaneLayoutState;
	update: (fn: LayoutUpdate) => void;
	/** The perpendicular Move key waiting for Enter. */
	keyboardPreview: KeyboardPreview | null;
	setKeyboardPreview: (preview: KeyboardPreview | null) => void;
	announceMove: (position: number, total: number) => void;
	lastKeyboardMove: KeyboardMoveNotice | null;
	/** Upstream `dropFeedback.target`: the pointer drag's target, else the keyboard preview's. */
	dropTarget: TileDropTarget | null;
	/** Upstream's per-root content-host registry: each tile's content lives in a host its shell adopts. */
	contentHosts: TileContentHosts;
	/** Upstream `interaction.mode === "dragging-tile"`: the tile a Move grip drag is carrying, or null. */
	dragging: TileId | null;
	/** Upstream `dragVisualTileId`: the lifted tile, held until it settles; drives `data-tiles-moving`. */
	movingTile: TileId | null;
	startDrag: (tileId: TileId, event: ReactPointerEvent<HTMLElement>) => void;
	/** Each non-root stack's element by `stackRectKey`, which the drag measures. */
	stackElements: Map<string, HTMLElement>;
	expanded: PaneKind | null;
	/** Upstream `hiddenTileIds`: kept tiles other than the expanded one, mounted but inert and hidden. */
	hidden: ReadonlySet<TileId>;
	/** Upstream `data-tiles-mounted`: the tiles the viewport renders, hidden ones included. */
	mountedCount: number;
	/** Each shell's line-mode edge attributes; empty outside line mode and while a tile is expanded. */
	shellEdges: ReadonlyMap<TileId, TileShellEdges>;
	/** Upstream's `rowEndIds`: the tiles whose panes get the row-end context (Automatic file column on the right). */
	rowEnd: ReadonlySet<TileId>;
	/** The pane drawn (or about to be) over the lone chat, or null. */
	overlay: HostOverlay | null;
	/** The tiles in the flow: the layout without an overlaid pane, which the chat's gutters and grip follow. */
	flowRoot: StackNode;
	/** Upstream `tFe`'s `under`: the wide title row's variant while the header is lifted into it, else null. */
	under: WideTitleRowVariant | null;
	/** Upstream's `hQ` slot for the chat tile while the wide title row is on, else null. */
	wideRow: WideTitleRowSlot | null;
	phone: boolean;
	/** The root row, measured when a pane opens so Changes can be sized to its minimum. */
	rootRef: RefObject<HTMLDivElement | null>;
	rootSize:
	{
		width: number;
		height: number;
	};
	/**
	 * Upstream's render map (`walkResolvedFlexes` over the measured tile container): each child's resolved
	 * flex and floors by path ("0", "1.0"). Null before the first measurement and on a phone.
	 */
	resolved: ReadonlyMap<string, ResolvedNode> | null;
	/** The pane just collapsed, whose Expand button takes focus back. */
	collapsedRef: RefObject<PaneKind | null>;
	collapse: () => void;
}

function tileIdsOf(node: LayoutNode): TileId[]
{
	return node.kind === "tile" ? [node.tileId] : node.children.flatMap(tileIdsOf);
}

function isPaneKind(tileId: TileId): tileId is PaneKind
{
	return tileId !== "chat";
}

/** Drops panes whose kind has no registered renderer, e.g. a persisted pane not ported yet. */
function pruneUnregistered(state: PaneLayoutState, definitions: ReadonlyMap<PaneKind, PaneDefinition>): PaneLayoutState
{
	return tileIdsOf(state.root)
		.filter(isPaneKind)
		.filter((kind) => !definitions.has(kind))
		.reduce(
			(acc, kind) =>
				closePane(
					acc,
					kind,
					{
						unprompted: true,
					},
				),
			state,
		);
}

/**
 * Upstream `setTileLayout(layout, resizedIds)` → `ps`: records the resized
 * root-row tiles' flex per kind (global, not per session) and passes the
 * layout through unchanged.
 */
function rememberResize(resizedIds: readonly TileId[]): LayoutUpdate
{
	return (state) =>
	{
		const lastFlex = loadLastPaneFlex();
		const next = rememberPaneFlex(state.root, resizedIds, lastFlex);
		if (next !== lastFlex) saveLastPaneFlex(next);
		return state;
	};
}

/**
 * Opens a pane, with the first split taking the kind's remembered flex. Given the tile root's measured
 * width, the result makes room for the chat (upstream `tileHost.fitOpenedLayout`).
 */
function openWithMemory(kind: PaneKind, widthPx: number | undefined, options?: OpenPaneOptions): LayoutUpdate
{
	return (state) =>
		openPane(
			state,
			kind,
			loadLastPaneFlex(),
			widthPx === undefined
				? undefined
				:
					{
						widthPx,
					},
			options,
		);
}

/** Upstream `BPe`: the transcript scroller's scrollbar width, else a probe's. */
function scrollbarWidth(root: HTMLElement): number
{
	const scroller = root.querySelector<HTMLElement>("[data-session-scrollport]");
	if (scroller !== null) return scroller.offsetWidth - scroller.clientWidth;
	const probe = root.ownerDocument.createElement("div");
	probe.style.cssText =
		"position:absolute;top:0;left:0;width:100px;height:50px;overflow-y:auto;scrollbar-gutter:stable both-edges;visibility:hidden;pointer-events:none";
	root.append(probe);
	const width = probe.offsetWidth - probe.clientWidth;
	probe.remove();
	return width;
}

/** Upstream `VPe`: how far a docked session rail overhangs its parent, which the chat column's width adds. */
function railOverhang(root: HTMLElement): number
{
	const rail = root.querySelector("[data-epitaxy-rail-column]");
	const parent = rail?.parentElement ?? null;
	if (rail === null || parent === null) return 0;
	const railRect = rail.getBoundingClientRect();
	const parentRect = parent.getBoundingClientRect();
	return Math.max(0, Math.round(Math.min(parentRect.right - railRect.left, railRect.right - parentRect.left)));
}

/** Upstream `z9(reserve, 0)`: the centred column moves half the reserve; the titlebar end and rail all of it. */
function overlayShiftVars(reservePx: number): CSSProperties
{
	return {
		"--epitaxy-overlay-column-shift": `${-reservePx / 2}px`,
		"--epitaxy-overlay-docked-column-shift": `${-reservePx / 2}px`,
		"--epitaxy-overlay-titlebar-shift": `${-reservePx}px`,
		"--epitaxy-overlay-rail-titlebar-shift": `${-reservePx}px`,
	};
}

function nodeTitle(node: LayoutNode, definitions: ReadonlyMap<PaneKind, PaneDefinition>): string
{
	return tileIdsOf(node)
		.map((tileId) => (tileId === "chat" ? "Chat" : (definitions.get(tileId)?.title ?? tileId)))
		.join(", ");
}

function nodeKey(node: LayoutNode): string
{
	return node.kind === "tile" ? node.tileId : `stack:${tileIdsOf(node).join(",")}`;
}

/** The layout's shape without its flexes: a change re-parents or reorders tiles (upstream `Ct`'s structureKey). */
function structureKey(node: LayoutNode): string
{
	return node.kind === "tile" ? node.tileId : `${node.direction}(${node.children.map(structureKey).join(",")})`;
}

function usePersistedLayout(
	sessionId: string,
	definitions: ReadonlyMap<PaneKind, PaneDefinition>,
): [PaneLayoutState, (fn: LayoutUpdate) => void, boolean]
{
	const [entry, setEntry] = useState<
	{
		sessionId: string | null;
		layout: PaneLayoutState;
	}>(() => (
	{
		sessionId: null,
		layout: defaultPaneLayout(),
	}));
	const loadedRef = useRef<PaneLayoutState | null>(null);

	useEffect(() =>
	{
		const layout = loadPaneLayout(sessionId);
		loadedRef.current = layout;
		setEntry(
			{
				sessionId,
				layout,
			},
		);
	}, [sessionId]);

	useEffect(() =>
	{
		if (entry.sessionId === null || entry.layout === loadedRef.current) return;
		savePaneLayout(entry.sessionId, entry.layout);
	}, [entry]);

	const update = useCallback(
		(fn: LayoutUpdate) =>
		{
			setEntry((prev) =>
			{
				if (prev.sessionId !== sessionId) return prev;
				const next = fn(pruneUnregistered(prev.layout, definitions));
				return next === prev.layout
					? prev
					:
						{
							sessionId,
							layout: next,
						};
			});
		},
		[sessionId, definitions],
	);

	const loaded = entry.sessionId === sessionId;
	const current = loaded ? entry.layout : defaultPaneLayout();
	const layout = useMemo(() => pruneUnregistered(current, definitions), [current, definitions]);
	return [layout, update, loaded];
}

function useElementSize(ref: RefObject<HTMLElement | null>):
{
	width: number;
	height: number;
}
{
	const [size, setSize] = useState(
		{
			width: 0,
			height: 0,
		},
	);
	useEffect(() =>
	{
		const element = ref.current;
		if (!element) return undefined;
		const measure = () =>
		{
			const {width, height} = element.getBoundingClientRect();
			setSize((prev) =>
				prev.width === width && prev.height === height
					? prev
					:
						{
							width,
							height,
						},
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () =>
		{
			observer.disconnect();
		};
	}, [ref]);
	return size;
}

function sizeAlong(element: HTMLElement | null, direction: Direction): number
{
	if (!element) return 0;
	const rect = element.getBoundingClientRect();
	return direction === "row" ? rect.width : rect.height;
}

function stackAt(root: StackNode, path: readonly number[]): StackNode | null
{
	let node: LayoutNode = root;
	for (const index of path)
	{
		const child: LayoutNode | undefined = node.kind === "stack" ? node.children[index] : undefined;
		if (child === undefined) return null;
		node = child;
	}
	return node.kind === "stack" ? node : null;
}

function isRowStack(stack: StackNode): boolean
{
	return stack.direction === "row";
}

/**
 * Upstream `Xt`: a divider starts from the stack's resolved flexes (`xe` over its children with the reachable
 * floors and line-mode 1px gaps), or null on a phone or before the stack is measured.
 */
function dividerStartFlexes(stack: StackNode, sizePx: number, host: InternalHost): number[] | null
{
	if (host.phone || host.resolved === null || sizePx <= 0) return null;
	return resolveFlexes(
		stack.children.map((child) => child.flex),
		stack.children.map((child) => tileFloor(child, stack.direction)),
		sizePx - (stack.children.length - 1),
	);
}

function Divider({
	stack,
	path,
	index,
	sizePx,
	stackRef,
	corners,
	isDropTarget,
	host,
}: {
	stack: StackNode;
	path: readonly number[];
	index: number;
	sizePx: number;
	stackRef: RefObject<HTMLDivElement | null>;
	/** Root dividers beside this column divider, keyed by the side they meet it on. */
	corners: Partial<Record<"left" | "right", number>>;
	/** Upstream `Ot` `isDropTarget`: a drop between these children turns the grip into a full-length accent bar. */
	isDropTarget: boolean;
	host: InternalHost;
})
{
	const before = stack.children[index];
	const after = stack.children[index + 1];
	const dragRef = useRef<number | null>(null);
	const movedRef = useRef(false);
	// Upstream's `is-active`: lights the line for the whole drag (pointerdown's preventDefault rules out :active).
	const [dragging, setDragging] = useState(false);
	if (before === undefined || after === undefined) return null;

	// Upstream `Xt`: the divider works from the rendered (resolved) flexes, so the first drag pixel never jumps.
	const startFlexes = dividerStartFlexes(stack, sizePx, host);
	const flexes = startFlexes ?? stack.children.map((child) => child.flex);
	const total = flexes.reduce((sum, flex) => sum + flex, 0);
	const prefixFlex = flexes.slice(0, index).reduce((sum, flex) => sum + flex, 0);
	const beforeFlex = flexes[index] ?? before.flex;
	const afterFlex = flexes[index + 1] ?? after.flex;
	const now = Math.round(((prefixFlex + beforeFlex) / total) * 100);
	// Upstream's line mode (always on once a pane opens): 1px hairlines with an 8px hit zone, not the 12px gap.
	const gapPx = 1;
	const available = sizePx - gapPx * (stack.children.length - 1);
	// The keyboard's floors (upstream `Se` without options: chat 320 along a row) bound the value; a phone keeps
	// the reducer's 320/280 floors.
	const floorOf = (node: LayoutNode) =>
		startFlexes === null
			? minTileSize(node, stack.direction)
			: node.kind === "tile" && node.tileId === "chat" && isRowStack(stack)
				? CHAT_OVERFLOW_MIN_PX
				: tileFloor(node, stack.direction);
	const bounds =
		available > 0
			?
				{
					"aria-valuemin": Math.round(
						(((prefixFlex / total) * available + floorOf(before)) / available) * 100,
					),
					"aria-valuemax": Math.round(
						((((prefixFlex + beforeFlex + afterFlex) / total) * available - floorOf(after)) / available) *
							100,
					),
				}
			: {};
	const isRow = stack.direction === "row";
	// Upstream's `isDisabled: isDraggingTile`: no divider takes focus or a pointer while a tile is carried.
	const disabled = host.dragging !== null;
	const resizedIds = [...tileIdsOf(before), ...tileIdsOf(after)];

	function resizeBy(deltaPx: number, remember = false)
	{
		const measured = sizeAlong(stackRef.current, stack.direction);
		if (measured <= 0) return;
		// A pointer drag floors the chat at its reachable 100px, a key step at its full 320px (upstream `Xt`).
		const measuredStart = dividerStartFlexes(stack, measured, host);
		const request =
			measuredStart === null
				? // The phone reducer subtracts 12px gaps; hand it the size those gaps would leave.
					{
						path,
						index,
						deltaPx,
						sizePx: measured + (TILE_GAP_PX - gapPx) * (stack.children.length - 1),
					}
				:
					{
						path,
						index,
						deltaPx,
						sizePx: measured,
						startFlexes: measuredStart,
						floor: remember ? ("full" as const) : ("reachable" as const),
					};
		host.update((state) =>
		{
			const next = resizeDivider(state, request);
			return remember ? rememberResize(resizedIds)(next) : next;
		});
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>)
	{
		if (disabled) return;
		const decrease = isRow ? "ArrowLeft" : "ArrowUp";
		const increase = isRow ? "ArrowRight" : "ArrowDown";
		if (event.key !== decrease && event.key !== increase) return;
		event.preventDefault();
		const step = event.shiftKey ? RESIZE_STEP_LARGE_PX : RESIZE_STEP_PX;
		resizeBy(event.key === increase ? step : -step, true);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>)
	{
		if (disabled) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = isRow ? event.clientX : event.clientY;
		setDragging(true);
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>)
	{
		if (dragRef.current === null) return;
		const position = isRow ? event.clientX : event.clientY;
		const delta = position - dragRef.current;
		if (delta === 0) return;
		dragRef.current = position;
		movedRef.current = true;
		resizeBy(delta);
	}

	function onPointerUp(event: ReactPointerEvent<HTMLDivElement>)
	{
		if (movedRef.current) host.update(rememberResize(resizedIds));
		movedRef.current = false;
		dragRef.current = null;
		setDragging(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
	}

	// Upstream's line-mode tiles-handle sits at z-index 4 + depth (a column's divider above the root's), so
	// neighbouring tiles never paint over the hairline or its hit zone. Its `::after` hit zone is asymmetric:
	// 1px before and 6px after a column hairline, 6px above a row hairline. Mid-move the hairline drops and the
	// 1px gap takes the pane ground, as upstream's after-line shell border paints it.
	return (
		<div
			role="separator"
			tabIndex={disabled ? -1 : 0}
			{...(disabled
				?
					{
						"aria-disabled": true,
					}
				: {})}
			style={
			{
				zIndex: 4 + path.length,
				...(disabled
					?
						{
							pointerEvents: "none" as const,
						}
					: {}),
			}}
			{...(corners.left === undefined
				? {}
				:
					{
						"data-starts-at-divider": "",
					})}
			data-tile-divider
			{...(dragging
				?
					{
						"data-dragging": "",
					}
				: {})}
			aria-orientation={isRow ? "vertical" : "horizontal"}
			aria-valuenow={now}
			{...bounds}
			aria-label={`Resize ${nodeTitle(before, host.definitions)} and ${nodeTitle(after, host.definitions)}`}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className={`group/divider relative flex shrink-0 touch-none items-center justify-center outline-none [[data-tiles-line][data-tiles-moving]_&]:bg-surface-2 ${
				isRow
					? "w-px cursor-col-resize bg-seam before:absolute before:inset-y-0 before:-left-px before:-right-1.5 before:content-['']"
					: "h-px cursor-row-resize bg-border-line before:absolute before:inset-x-0 before:-top-1.5 before:bottom-0 before:content-['']"
			}`}
		>
			{/* Upstream's tiles-handle-line: a 2px accent line centred on the hairline, lit on hover after 100ms and at once
			    while dragging. A drop target renders none. */}
			{!isDropTarget && (
				<span
					aria-hidden
					data-tile-divider-line
					className={`pointer-events-none absolute ${
						isRow ? "inset-y-0 left-[-0.5px] w-[2px]" : "inset-x-0 top-[-0.5px] h-[2px]"
					} bg-fill-accent opacity-0 transition-opacity duration-200 delay-100 group-hover/divider:opacity-100 group-data-dragging/divider:opacity-100 group-data-dragging/divider:duration-[120ms] group-data-dragging/divider:delay-0 group-focus-visible/divider:opacity-0`}
				/>
			)}
			{/* Upstream's tiles-handle-affordance: absolutely centred 3x56 so the 1px divider cannot shrink it; in line mode
			    only keyboard focus shows it, in --tile-resize-color-focus. As a drop target it runs the full length in
			    --tile-indicator-color at opacity 1. */}
			<span
				aria-hidden
				data-tile-divider-grip
				{...(isDropTarget
					?
						{
							"data-tile-divider-drop-target": "",
						}
					: {})}
				className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fill-accent ${
					isDropTarget ? "opacity-100" : "opacity-0"
				} transition-opacity duration-[120ms] ${
					isDropTarget
						? isRow
							? "h-full w-[3px]"
							: "h-[3px] w-full"
						: `group-focus-visible/divider:opacity-100 ${isRow ? "h-14 w-[3px]" : "h-[3px] w-14"}`
				}`}
			/>
			{Object.entries(corners).map(([side, rootIndex]) => (
				<TileCorner
					key={side}
					side={side === "left" ? "left" : "right"}
					rootIndex={rootIndex}
					columnPath={path}
					columnIndex={index}
					columnRef={stackRef}
					host={host}
				/>
			))}
		</div>
	);
}

/**
 * Upstream's `tiles-handle-corner`: a 12x12 all-scroll grip where a column's
 * divider meets the root divider beside it, resizing both axes at once.
 */
function TileCorner({
	side,
	rootIndex,
	columnPath,
	columnIndex,
	columnRef,
	host,
}: {
	side: "left" | "right";
	rootIndex: number;
	columnPath: readonly number[];
	columnIndex: number;
	columnRef: RefObject<HTMLDivElement | null>;
	host: InternalHost;
})
{
	const dragRef = useRef<
	{
		x: number;
		y: number;
	} | null>(null);

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>)
	{
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current =
		{
			x: event.clientX,
			y: event.clientY,
		};
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>)
	{
		const drag = dragRef.current;
		if (drag === null) return;
		event.stopPropagation();
		const deltaX = event.clientX - drag.x;
		const deltaY = event.clientY - drag.y;
		if (deltaX === 0 && deltaY === 0) return;
		dragRef.current =
		{
			x: event.clientX,
			y: event.clientY,
		};
		const rowPx = sizeAlong(host.rootRef.current, "row");
		const columnPx = sizeAlong(columnRef.current, "column");
		if (rowPx <= 0 || columnPx <= 0) return;
		const column = stackAt(host.layout.root, columnPath);
		const rowStart = dividerStartFlexes(host.layout.root, rowPx, host);
		const columnStart = column === null ? null : dividerStartFlexes(column, columnPx, host);
		// Both axes start from the rendered flexes, as a divider drag does (upstream `Xt`).
		const resolvedRequest = (startFlexes: number[] | null) =>
			startFlexes === null
				? {}
				:
					{
						startFlexes,
						floor: "reachable" as const,
					};
		host.update((state) =>
			resizeDivider(
				resizeDivider(
					state,
					{
						path: [],
						index: rootIndex,
						deltaPx: deltaX,
						sizePx: rowPx,
						...resolvedRequest(rowStart),
					},
				),
				{
					path: columnPath,
					index: columnIndex,
					deltaPx: deltaY,
					sizePx: columnPx,
					...resolvedRequest(columnStart),
				},
			),
		);
	}

	function onPointerUp(event: ReactPointerEvent<HTMLDivElement>)
	{
		event.stopPropagation();
		if (dragRef.current !== null)
		{
			host.update((state) =>
			{
				const row = state.root.children;
				const ids = [row[rootIndex], row[rootIndex + 1]].flatMap((node) => (node ? tileIdsOf(node) : []));
				return rememberResize(ids)(state);
			});
		}
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}

	return (
		<div
			aria-hidden
			data-tile-corner={side}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className={`absolute top-0 z-10 size-3 cursor-all-scroll touch-none ${side === "left" ? "-left-3" : "-right-3"}`}
		/>
	);
}

const MOVE_HINT =
	"Arrow keys move the tile. Perpendicular arrows preview a split; press Enter to commit or Escape to cancel.";

/** Upstream `bt`: the Move grip's label while a keyboard split preview waits. */
const PREVIEW_LABELS: Readonly<Record<KeyboardPreviewSide, string>> =
{
	left: "Move left",
	right: "Move right",
	up: "Move up",
	down: "Move down",
};

/**
 * Upstream's Move grip `Tt`. A press starts a tile drag at once. Arrows, Home and End along the tile's stack move it
 * straight away; perpendicular arrows preview a split of the parent stack, Enter or Space commits and Escape cancels.
 */
function MoveHandle({tileId, host}: {tileId: TileId; host: InternalHost})
{
	const hintId = `pane-move-hint-${tileId}`;
	const preview = host.keyboardPreview?.tileId === tileId ? host.keyboardPreview : null;
	const active = host.dragging === tileId;

	function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>)
	{
		if (host.dragging !== null) return;
		if (event.key === "Enter" || event.key === " " || event.key === "Escape")
		{
			if (preview === null) return;
			event.preventDefault();
			event.stopPropagation();
			host.setKeyboardPreview(null);
			if (event.key !== "Escape") host.update((state) => applyTileDrop(state, tileId, preview.target));
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey || !KEYBOARD_MOVE_KEYS.has(event.key)) return;
		event.preventDefault();
		const move = keyboardTileMove(host.layout.root, tileId, event.key);
		if (move?.kind === "preview")
		{
			host.setKeyboardPreview(
				{
					tileId,
					side: move.side,
					target: move.target,
				},
			);
			return;
		}
		host.setKeyboardPreview(null);
		if (move === null) return;
		host.update((state) => applyTileDrop(state, tileId, move.target));
		host.announceMove(move.position, move.total);
	}

	const label = preview === null ? "Move" : PREVIEW_LABELS[preview.side];
	return (
		<div className="absolute top-0 left-1/2 z-10 flex -translate-x-1/2">
			<Tooltip
				content={label}
				side="bottom"
				{...(preview === null
					? {}
					:
						{
							shortcut: "enter",
							forceOpen: true,
						})}
			>
				<button
					type="button"
					aria-label={label}
					aria-describedby={hintId}
					{...(preview === null
						? {}
						:
							{
								"data-pane-editor": "",
							})}
					{...(active
						?
							{
								"data-active": "",
							}
						: {})}
					onKeyDown={onKeyDown}
					onPointerDown={(event) =>
					{
						host.setKeyboardPreview(null);
						host.startDrag(tileId, event);
					}}
					onBlur={() =>
					{
						if (preview !== null) host.setKeyboardPreview(null);
					}}
					className="group/move flex h-4 w-11 cursor-move touch-none items-center justify-center outline-none"
				>
					{/* Upstream's tiles-drag-handle-affordance: --tile-drag-color, focus in accent, and --tile-drag-color-active
					    (fill-primary) on the grip of the tile being dragged. */}
					<span className="h-[3px] w-8 rounded-full bg-fill-grip opacity-0 transition-opacity group-hover/move:opacity-100 group-focus-visible/move:bg-accent-100 group-focus-visible/move:opacity-100 group-data-[active]/move:bg-fill-primary group-data-[active]/move:opacity-100" />
					<span id={hintId} className="sr-only">
						{MOVE_HINT}
					</span>
				</button>
			</Tooltip>
		</div>
	);
}

/**
 * Upstream's viewport status: during a keyboard split preview it tells how to commit; after a keyboard move it reads
 * the tile's new position, re-keyed so a repeat announces again.
 */
function MoveStatus({host}: {host: InternalHost})
{
	const preview = host.keyboardPreview;
	const notice = host.lastKeyboardMove;
	return (
		<span role="status" className="sr-only">
			{preview === null
				? notice !== null && (
						<span key={notice.seq}>{`Tile moved to position ${notice.position} of ${notice.total}`}</span>
					)
				: `Press Enter to move ${preview.side}, or Escape to cancel.`}
		</span>
	);
}

/**
 * Upstream `kt`: a 3px accent bar on one edge of a stack or tile, `outset` outside it, above every tile and divider.
 */
function TileDropIndicator({edge, outset}: {edge: DropEdge; outset: number})
{
	const vertical = edge === "left" || edge === "right";
	return (
		<div
			aria-hidden
			data-tile-drop-indicator={edge}
			className="pointer-events-none absolute z-30 rounded-full bg-fill-accent"
			style={
			{
				[edge]: -outset,
				...(vertical
					?
						{
							top: 0,
							bottom: 0,
							width: 3,
						}
					:
						{
							left: 0,
							right: 0,
							height: 3,
						}),
			}}
		/>
	);
}

function PaneSurface({kind, definition, host}: {kind: PaneKind; definition: PaneDefinition; host: InternalHost})
{
	const expandKeys = useShortcutKeys("expand_collapse_pane");
	const closeKeys = useShortcutKeys("close_pane");
	const isExpanded = host.expanded === kind;
	const toggleRef = useRef<HTMLButtonElement>(null);

	useEffect(() =>
	{
		if (isExpanded || host.collapsedRef.current !== kind) return;
		host.collapsedRef.current = null;
		// Only when focus fell to the body: a return to the tile the expand took focus from, or a field, keeps it.
		const active = document.activeElement;
		if (active === null || active === document.body) toggleRef.current?.focus();
	}, [isExpanded, kind, host.collapsedRef]);

	// Upstream renders no drag-line affordance on a hidden tile.
	const moveHandle = isExpanded || host.hidden.has(kind) ? null : <MoveHandle tileId={kind} host={host} />;
	// Upstream joins the pane's target ids into `resetOn`, so pointing the pane elsewhere clears a crash.
	const crashResetKey = `${kind}:${definition.resetKey ?? ""}`;

	const controls = (
		<>
			<Tooltip content={isExpanded ? "Collapse" : "Expand"} shortcut={expandKeys.keys}>
				<button
					ref={toggleRef}
					type="button"
					aria-label={isExpanded ? "Collapse" : "Expand"}
					aria-keyshortcuts={expandKeys.ariaKeyShortcuts}
					{...(isExpanded
						? {}
						:
							{
								"aria-haspopup": "dialog" as const,
							})}
					onClick={() =>
					{
						if (isExpanded) host.collapse();
						else host.update((state) => expandPane(state, kind));
					}}
					className={PANE_HEADER_ICON_BUTTON_CLASS}
				>
					{isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
				</button>
			</Tooltip>
			<Tooltip content="Close" shortcut={closeKeys.keys}>
				<button
					type="button"
					aria-label="Close"
					aria-keyshortcuts={closeKeys.ariaKeyShortcuts}
					onMouseDown={(event) =>
					{
						event.preventDefault();
					}}
					onClick={() =>
					{
						host.update((state) => closePane(state, kind));
					}}
					className={`${PANE_HEADER_ICON_BUTTON_CLASS} ${PANE_CLOSE_CONTROL_CLASS}`}
				>
					<X className="h-4 w-4" />
				</button>
			</Tooltip>
		</>
	);

	return (
		<section
			data-pane-root
			data-pane-kind={kind}
			data-perf-region="side_pane"
			data-perf-screen={kind}
			data-focus-region="pane"
			aria-label={definition.title}
			className={`relative isolate flex h-full min-w-0 flex-col bg-surface-2 ${
				// Upstream's line-mode tiles are flat: no radius, no card shadow (measured at 386px and 1032px, 2026-10-30).
				// Only the desktop expanded overlay, floating 9px inside the window, keeps its card.
				isExpanded && !host.phone ? "rounded-r7 shadow-panel-sm" : ""
			}`}
			style={codeSurfaceStyle(kind)}
		>
			{definition.header === "custom" ? (
				<PaneCrashBoundary
					resetKey={crashResetKey}
					header={
						<PaneChromeHeader
							title={definition.title}
							chrome={
							{
								moveHandle,
								controls,
							}}
						/>
					}
				>
					{definition.render(
						{
							moveHandle,
							controls,
						},
					)}
				</PaneCrashBoundary>
			) : (
				<>
					<PaneHeaderRow
						label={definition.title}
						title={
							<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
								{definition.title}
							</span>
						}
						actions={
							<>
								{definition.headerActions}
								{controls}
							</>
						}
						moveHandle={moveHandle}
					/>
					<div data-pane-body className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
						<div className="h-full scroll-py-2.5 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
							<PaneCrashBoundary resetKey={crashResetKey}>
								{definition.render(
									{
										moveHandle,
										controls,
									},
								)}
							</PaneCrashBoundary>
						</div>
					</div>
				</>
			)}
		</section>
	);
}

/**
 * Root dividers that meet a column divider: a column that is a root child
 * touches the divider before it (on its left) and after it (on its right).
 */
function cornersOf(path: readonly number[], host: InternalHost): Partial<Record<"left" | "right", number>>
{
	const [rootIndex, ...rest] = path;
	if (rootIndex === undefined || rest.length > 0) return {};
	const corners: Partial<Record<"left" | "right", number>> = {};
	if (rootIndex > 0) corners.left = rootIndex - 1;
	if (rootIndex < host.layout.root.children.length - 1) corners.right = rootIndex;
	return corners;
}

/**
 * Upstream `ft`'s child keys: each child's orderKey is its parent's plus a level listing every sibling's id, and its
 * aheadKey its parent's plus a level listing the siblings before it (upstream `pt`, the URI-encoded node id; a local
 * stack has no id, so its React key stands in).
 */
function childSlotKeys(stack: StackNode, orderKey: string, aheadKey: string)
{
	const ids = stack.children.map((child) => encodeURIComponent(nodeKey(child)));
	return {
		orderKey: `${orderKey}/${ids.join(",")}`,
		aheadKeys: ids.map((_, index) => `${aheadKey}/${ids.slice(0, index).join(",")}`),
	};
}

function StackView({
	stack,
	path,
	orderKey,
	aheadKey,
	host,
}: {
	stack: StackNode;
	path: readonly number[];
	orderKey: string;
	aheadKey: string;
	host: InternalHost;
})
{
	const localRef = useRef<HTMLDivElement>(null);
	const isRoot = path.length === 0;
	const ref = isRoot ? host.rootRef : localRef;
	const localSize = useElementSize(localRef);
	const size = isRoot ? host.rootSize : localSize;
	const sizePx = stack.direction === "row" ? size.width : size.height;

	const key = stackRectKey(path);
	const {stackElements} = host;
	useLayoutEffect(() =>
	{
		const element = localRef.current;
		if (isRoot || element === null) return undefined;
		stackElements.set(key, element);
		return () =>
		{
			if (stackElements.get(key) === element) stackElements.delete(key);
		};
	}, [isRoot, key, stackElements]);
	const feedback = stackDropFeedback(stack, path, host.dropTarget);

	const childKeys = childSlotKeys(stack, orderKey, aheadKey);
	const items: ReactNode[] = [];
	// Keep the expanded pane and chat on their keyed paths so their reader state survives.
	stack.children.forEach((child, index) =>
	{
		if (host.expanded === null && host.overlay === null && index > 0)
		{
			items.push(
				<Divider
					key={`divider:${nodeKey(stack.children[index - 1] ?? child)}|${nodeKey(child)}`}
					stack={stack}
					path={path}
					index={index - 1}
					sizePx={sizePx}
					stackRef={ref}
					corners={cornersOf(path, host)}
					isDropTarget={feedback.dividerIndex === index - 1}
					host={host}
				/>,
			);
		}
		items.push(
			<NodeView
				key={nodeKey(child)}
				node={child}
				path={[...path, index]}
				orderKey={childKeys.orderKey}
				aheadKey={childKeys.aheadKeys[index] ?? ""}
				parentDirection={stack.direction}
				host={host}
				isRootChild={isRoot}
			/>,
		);
	});

	return (
		<div
			ref={ref}
			data-tile-stack={stack.direction}
			// Upstream's tiles viewport is `data-tiles-line` (shared-20 `pU(true)`) under the panels flag, with the chat
			// alone too; without panels local falls back to line mode only once a pane opens.
			{...(isRoot
				?
					{
						"data-tiles-viewport": "",
						"data-tiles-mounted": String(host.mountedCount),
					}
				: {})}
			{...(isRoot && (FIZZY_LAKE_PANELS || tileIdsOf(stack).length > 1)
				?
					{
						"data-tiles-line": "",
					}
				: {})}
			{...(isRoot && host.movingTile !== null
				?
					{
						"data-tiles-moving": "",
					}
				: {})}
			className={`relative flex h-full min-h-0 min-w-0 items-stretch ${stack.direction === "row" ? "flex-row" : "flex-col"}${
				isRoot && host.dragging !== null ? " tiles-dragging" : ""
			}`}
			style={
				isRoot
					? undefined
					:
						{
							flex: `${stack.flex} 1 0`,
						}
			}
		>
			{items}
			{feedback.edge !== null && (
				<TileDropIndicator
					edge={feedback.edge}
					outset={dropIndicatorOutset(host.layout.root, path, feedback.edge)}
				/>
			)}
		</div>
	);
}

function NodeView({
	node,
	path,
	orderKey,
	aheadKey,
	host,
	isRootChild,
	parentDirection,
}: {
	node: LayoutNode;
	path: readonly number[];
	/** Upstream's slot keys: the tile's sibling ids at every level, and the ones ahead of it. */
	orderKey: string;
	aheadKey: string;
	host: InternalHost;
	isRootChild: boolean;
	parentDirection: Direction;
})
{
	const style = host.phone
		?
			{
				flex: `${node.flex} 1 0`,
			}
		: resolvedStyle(node, path, parentDirection, host.resolved);
	const phone = isRootChild && host.phone;
	const holdsChat = tileIdsOf(node).includes("chat");
	const phoneMin = holdsChat ? PHONE_CHAT_MIN_CLASS : PHONE_PANE_MIN_CLASS;
	// On desktop the inline min-width (the resolved floor) replaces min-w-0; the inline min-height overrides min-h-0.
	const slotClass = `relative min-h-0 ${phone ? phoneMin : host.phone ? "min-w-0" : ""}`.trimEnd();
	// Upstream tile `Q` layers: the chat wrap at z-index 0 under its overflowing shell, panes at 1 above it.
	const layered = !host.phone && tileIdsOf(host.layout.root).length > 1;
	if (node.kind === "stack")
	{
		// Upstream ft's `P`: a stack whose every tile is hidden or dropped merges rt; no `inert`, its tiles carry their own.
		const hidden =
			host.expanded !== null &&
			isNodeHidden(node, host.hidden, (id) => id === host.expanded || host.hidden.has(id));
		return (
			<div
				className={`flex ${slotClass}`}
				style={
					hidden
						?
							{
								...style,
								...HIDDEN_TILE_STYLE,
							}
						: style
				}
				{...(phone
					?
						{
							"data-pane-phone": "",
						}
					: {})}
			>
				<StackView stack={node} path={path} orderKey={orderKey} aheadKey={aheadKey} host={host} />
			</div>
		);
	}
	if (node.tileId === "chat")
	{
		const hidden = host.hidden.has("chat");
		// Upstream's line-mode tile shell (shared-20 `it`): 8px at the bottom, and 8px on a side the chat touches
		// without a gutter attribute, so the chat alone is `0 0 8 8` with its end bleeding. Not on a phone until a
		// live 390px read shows upstream insets there.
		const gutters = lineShell(host) ? chatGutters(host.flowRoot) : null;
		// Upstream's `.tiles-shell[data-tile-overflow-anchor]`: pinned to the chat's outer edge at the full slot
		// width but never under 320px, so a narrower slot slides the shell under the neighbouring pane.
		const anchor = leftEdgeTiles(host.flowRoot).has("chat") ? "left" : "right";
		// Upstream `vFe`/ca67f2c9d: under a drawn overlay the chat carries the shift vars and its shell is clipped.
		const drawn = host.overlay?.drawn ?? null;
		const reserve =
			drawn === null
				? undefined
				:
					{
						"--tile-overlay-reserve": `${drawn.reservePx}px`,
					};
		return (
			<TileSlot
				tileId="chat"
				path={path}
				host={host}
				orderKey={orderKey}
				aheadKey={aheadKey}
				className={gutters === null ? slotClass : `${slotClass} @container/tile-slot z-0`}
				style={
					gutters === null
						? style
						:
							{
								...style,
								"--tiles-padding": "8px",
								"--tile-shell-ground": "var(--color-page)",
								...(drawn === null ? {} : overlayShiftVars(drawn.reservePx)),
							}
				}
				hidden={hidden}
				shellClassName={
					gutters === null
						? "contents"
						: `absolute inset-y-0 w-full min-w-[320px] bg-[var(--tile-shell-ground)]${
								drawn === null ? "" : " tiles-under-overlay"
							}`
				}
				shellStyle={
					gutters === null
						? undefined
						:
							{
								[anchor]: 0,
								padding: chatShellPadding(gutters),
								"--tile-overflow-min": `${CHAT_OVERFLOW_MIN_PX}px`,
								...reserve,
							}
				}
				{...(drawn === null
					? {}
					:
						{
							"data-pane-overlay": "",
						})}
				{...(gutters === null
					? {}
					:
						{
							overflowAnchor: anchor,
						})}
				{...chatGutterAttributes(gutters)}
			/>
		);
	}
	const expanded = host.expanded === node.tileId;
	const hidden = host.hidden.has(node.tileId);
	// Upstream's solo layout drops every tile that is neither expanded nor kept (`q9`), so it unmounts.
	if (host.expanded !== null && !expanded && !hidden) return null;
	const definition = host.definitions.get(node.tileId);
	if (definition === undefined) return null;
	const overlay = host.overlay?.tileId === node.tileId ? host.overlay : null;
	// Upstream shared-20 `it`'s `top`: while the header is lifted, a pane on the top edge starts below the wide row.
	// An expanded pane covers the row, so it keeps its full height.
	const paddingTop = expanded ? undefined : wideRowTopPadding(node.tileId, host.layout.root, host.under);
	const shellStyle: CSSProperties | undefined = overlay?.drawn
		?
			{
				"--tile-overlay-reserve": `${overlay.drawn.reservePx}px`,
				padding: 0,
				"--tiles-padding": "8px",
				"--tile-shell-ground": "var(--color-page)",
				...(paddingTop === undefined
					? {}
					:
						{
							paddingTop,
						}),
			}
		: paddingTop === undefined
			? undefined
			:
				{
					paddingTop,
				};
	return (
		<TileSlot
			tileId={node.tileId}
			path={path}
			host={host}
			orderKey={orderKey}
			aheadKey={aheadKey}
			shellClassName={overlay?.drawn ? "h-full tiles-overlay-shell" : "h-full"}
			shellStyle={shellStyle}
			className={
				expanded
					? `min-h-0 min-w-0 ${host.phone ? PHONE_EXPANDED_SLOT_CLASSES : EXPANDED_SLOT_CLASSES}`
					: layered
						? `${slotClass} z-[1]`
						: slotClass
			}
			style={expanded ? undefined : overlay === null ? style : overlaySlotStyle(style, overlay.drawn)}
			hidden={hidden}
			phone={expanded ? host.phone : phone}
			{...(expanded
				?
					{
						"data-pane-expanded": true,
					}
				: {})}
		/>
	);
}

/**
 * Upstream ca67f2c9d `pt`: the overlaid pane's wrap leaves the flow, pinned to the row's end at its fitted width
 * above the chat. Until the fit is measured it stays out of the flow unseen, so the chat measures as if alone.
 */
function overlaySlotStyle(style: CSSProperties, drawn: DrawnOverlay | null): CSSProperties
{
	if (drawn === null)
	{
		return {
			...style,
			...HIDDEN_TILE_STYLE,
		};
	}
	return {
		...style,
		position: "absolute",
		top: 0,
		bottom: 0,
		insetInlineEnd: OVERLAY_SPLIT.padding,
		width: drawn.width,
		zIndex: 2,
	};
}

/**
 * Upstream's tile wrap and stack styles from the render map: the resolved flex, the row floor clamped to the
 * allocation as min-width (0 for a stack inside a column) and a tile's min-height. Before the first measurement
 * the flex stays raw and min-width is the bare floor (upstream `Ve`), min-height upstream `Ae`'s 100px.
 */
function resolvedStyle(
	node: LayoutNode,
	path: readonly number[],
	parentDirection: Direction,
	resolved: ReadonlyMap<string, ResolvedNode> | null,
): CSSProperties
{
	const entry = resolved?.get(path.join("."));
	const isTile = node.kind === "tile";
	const bareFloor = isTile || parentDirection === "row" ? tileFloor(node, "row") : 0;
	const minHeight = entry === undefined ? UNMEASURED_MIN_HEIGHT_PX : entry.minHeightPx;
	return {
		// Six decimals, as the live upstream values were read; browsers serialise fewer digits anyway.
		flex: `${entry === undefined ? node.flex : Math.round(entry.flex * 1e6) / 1e6} 1 0px`,
		minWidth: `${entry?.minWidthPx ?? bareFloor}px`,
		...(isTile && minHeight !== null
			?
				{
					minHeight: `${minHeight}px`,
				}
			: {}),
	};
}

/**
 * Upstream `wt`: the tile wrap (layout classes, flex and floors, the hide) around its `.tiles-shell`, which adopts the
 * tile's persistent content host. The wrap and shell may remount when the layout re-parents the tile; the content,
 * portalled into the host, does not.
 */
function TileSlot({
	tileId,
	host,
	orderKey,
	aheadKey,
	className,
	style,
	hidden,
	phone = false,
	shellClassName,
	shellStyle,
	overflowAnchor,
	path,
	...data
}:
{
	tileId: TileId;
	host: InternalHost;
	/** The slot's sibling ids at every level; when they change, the host is snapshotted and restored around the move. */
	orderKey: string;
	/** The siblings ahead of the slot at every level. */
	aheadKey: string;
	className?: string;
	style?: CSSProperties | undefined;
	/** Kept mounted while another tile is expanded: `inert` plus upstream's `rt` hide, never `display: none`. */
	hidden?: boolean;
	phone?: boolean;
	shellClassName: string;
	shellStyle?: CSSProperties | undefined;
	overflowAnchor?: "left" | "right";
	/** The tile's path in the layout, which places a wrap drop indicator's outset. */
	path: readonly number[];
	"data-pane-expanded"?: boolean;
	"data-pane-overlay"?: "";
} & ChatGutterAttributes)
{
	const {contentHosts} = host;
	const edges = host.shellEdges.get(tileId);
	const lifted = host.movingTile === tileId;
	const wrapEdge = wrapDropEdge(tileId, host.dropTarget);
	const cellRef = useRef<HTMLDivElement | null>(null);
	// Upstream's shell ref: adopt the host on mount; the cleanup snapshots and parks it if it is still here.
	const adopt = useCallback(
		(cell: HTMLDivElement | null) =>
		{
			cellRef.current = cell;
			if (cell === null) return undefined;
			const release = contentHosts.adopt(tileId, cell);
			return () =>
			{
				cellRef.current = null;
				release();
			};
		},
		[contentHosts, tileId],
	);
	// Upstream's orderKey effect: React moves a reordered shell with insertBefore, which resets scroll and focus.
	const nextAheadKey = useEffectEvent(() => aheadKey);
	useLayoutEffect(() =>
	{
		const cell = cellRef.current;
		if (cell === null) return undefined;
		contentHosts.slotMoved(tileId, cell);
		return () =>
		{
			contentHosts.slotWillMove(tileId, cell, siblingMovedAhead(orderKey, aheadKey, nextAheadKey()));
		};
	}, [contentHosts, tileId, orderKey, aheadKey]);
	return (
		<div
			data-tile-slot={tileId}
			className={className}
			// Upstream wt: the hide merges after the flex and floors, with the solo layout's min-width 0.
			style={
				hidden
					?
						{
							...style,
							minWidth: 0,
							...HIDDEN_TILE_STYLE,
						}
					: lifted
						?
							{
								...style,
								...LIFTED_TILE_STYLE,
							}
						: style
			}
			inert={hidden}
			{...(phone
				?
					{
						"data-pane-phone": "",
					}
				: {})}
			{...(host.movingTile === tileId
				?
					{
						"data-tile-moving": "",
					}
				: {})}
			{...data}
		>
			<div
				ref={adopt}
				className={`tiles-shell ${shellClassName}`}
				style={shellStyle}
				{...(overflowAnchor === undefined
					? {}
					:
						{
							"data-tile-overflow-anchor": overflowAnchor,
						})}
				{...(edges?.afterLineX === true
					?
						{
							"data-after-line-x": "",
						}
					: {})}
				{...(edges?.afterLineY === true
					?
						{
							"data-after-line-y": "",
						}
					: {})}
				{...(edges?.stripOverStart === true
					?
						{
							"data-strip-over-start": "",
						}
					: {})}
				{...(edges?.stripOverFoot === true
					?
						{
							"data-strip-over-foot": "",
						}
					: {})}
				{...(edges?.stripOverEnd === true
					?
						{
							"data-strip-over-end": "",
						}
					: {})}
			/>
			{wrapEdge !== null && (
				<TileDropIndicator edge={wrapEdge} outset={dropIndicatorOutset(host.layout.root, path, wrapEdge)} />
			)}
		</div>
	);
}

/**
 * Upstream's dragged tile wrap: it follows the pointer (`--tile-drag-x/y`, written by the drag) lifted by dragLift.
 * Local tiles share no 3D context, so z-index orders it above the other tiles and dividers.
 */
const LIFTED_TILE_STYLE =
{
	transform: `translate3d(var(--tile-drag-x, 0px), var(--tile-drag-y, 0px), ${TILE_DRAG_LIFT_PX}px)`,
	zIndex: 30,
} as const satisfies CSSProperties;

const CONTENTS_STYLE =
{
	display: "contents",
} as const satisfies CSSProperties;

const WIDE_ROW_STYLE =
{
	zIndex: 2,
} as const satisfies CSSProperties;

const BELOW_WIDE_ROW_STYLE =
{
	top: "var(--wide-title-row-h)",
} as const satisfies CSSProperties;

/** Whether the chat gets upstream's line-mode shell: on desktop under panels, else once a pane shares the layout. */
function lineShell(host: InternalHost): boolean
{
	return !host.phone && (FIZZY_LAKE_PANELS || tileIdsOf(host.layout.root).length > 1);
}

/** The chat tile's content: its Move grip (once a pane shares the row) above the transcript. */
function ChatTileContent({host, chat}: {host: InternalHost; chat: ReactNode})
{
	const tiles = tileIdsOf(host.flowRoot).length;
	const line = lineShell(host);
	const root = host.flowRoot;
	const attributes = useMemo(() => chatGutterAttributes(line ? chatGutters(root) : null), [line, root]);
	// Upstream `Fp` keeps the chat's drag handle in the chat, below the spacer the lifted header leaves.
	const belowRow = host.under !== null && host.wideRow?.overChat === true;
	return (
		<>
			{!host.hidden.has("chat") && tiles > 1 && (
				// Keep the chat's Move grip above its titlebar while the transcript scrolls.
				<div className="sticky top-0 z-20 h-0" style={belowRow ? BELOW_WIDE_ROW_STYLE : undefined}>
					<MoveHandle tileId="chat" host={host} />
				</div>
			)}
			<WideTitleRowContext.Provider value={host.wideRow}>
				<ChatGutterContext.Provider value={attributes}>{chat}</ChatGutterContext.Provider>
			</WideTitleRowContext.Provider>
		</>
	);
}

/**
 * Upstream `Tt`: a tile's content, portalled into its persistent host in a display:contents wrapper. Focus and presses
 * inside the host reach the focused-tile state through the registry's host listeners.
 */
function TileContent({tileId, host, chat}: {tileId: TileId; host: InternalHost; chat: ReactNode})
{
	const definition = isPaneKind(tileId) ? host.definitions.get(tileId) : undefined;
	if (isPaneKind(tileId) && definition === undefined) return null;
	return createPortal(
		<div style={CONTENTS_STYLE}>
			{isPaneKind(tileId) && definition !== undefined ? (
				<TileRowEndContext value={host.expanded !== tileId && host.rowEnd.has(tileId)}>
					<PaneSurface kind={tileId} definition={definition} host={host} />
				</TileRowEndContext>
			) : (
				<ChatTileContent host={host} chat={chat} />
			)}
		</div>,
		host.contentHosts.host(tileId),
	);
}

/**
 * Upstream `Ct`: before a structural change commits, freeze every host's scrolls and box (a detached cell reads 0);
 * thaw once the new tree is in place.
 */
class ScrollFreezer extends Component<
{
	contentHosts: TileContentHosts;
	structureKey: string;
	liveTileIds: ReadonlySet<TileId>;
}>
{
	override getSnapshotBeforeUpdate(
		previous: Readonly<
		{
			structureKey: string;
		}>,
	): null
	{
		if (previous.structureKey !== this.props.structureKey)
			this.props.contentHosts.freezeScrolls(this.props.liveTileIds);
		return null;
	}

	override componentDidMount(): void
	{
		this.props.contentHosts.thawScrolls();
	}

	override componentDidUpdate(): void
	{
		this.props.contentHosts.thawScrolls();
	}

	override render(): null
	{
		return null;
	}
}

/**
 * Session tiling pane host modelled on claude.ai/code: the chat tile plus the
 * registered side panes laid out by the pure reducers in `lib/pane-layout`.
 * ⌘\ closes the focused pane; ⇧⌘\ expands or collapses it, falling back to
 * `onExpandWithoutPane` when no pane is open. `requestedPane` (the `?pane=`
 * deep link) opens once the saved layout loads, if that kind is registered.
 */
export function TileHost({
	sessionId,
	onExpandWithoutPane,
	requestedPane,
	onRequestedPaneHandled,
	wideTitleRow = WIDE_TITLE_ROW,
	children,
}: {
	sessionId: string;
	onExpandWithoutPane?: () => void;
	requestedPane?: PaneKind | undefined;
	onRequestedPaneHandled?: (() => void) | undefined;
	/** The wide title row variant (upstream `__gb__2285377532`); defaults to the local switch. */
	wideTitleRow?: WideTitleRowVariant | null;
	children: ReactNode;
})
{
	const definitions = usePaneDefinitions();
	const [savedLayout, saveUpdate, loaded] = usePersistedLayout(sessionId, definitions);
	const phone = usePhoneSheet();
	// A phone shows saved desktop columns stacked in one side column, and edits made there keep the saved columns.
	const layout = useMemo(() => (phone ? fitPhoneLayout(savedLayout) : savedLayout), [phone, savedLayout]);
	const update = useCallback(
		(fn: LayoutUpdate) =>
		{
			saveUpdate(phone ? (state) => updatePhoneView(state, fn) : fn);
		},
		[phone, saveUpdate],
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const rootSize = useElementSize(rootRef);
	const resolved = useMemo(
		() => (rootSize.width > 0 && !phone ? resolveTileLayout(layout.root, rootSize) : null),
		[rootSize, phone, layout.root],
	);
	// Upstream fits only user-initiated opens; a phone skips it, since its edits keep the saved desktop columns.
	const fitWidth = useCallback(
		(): number | undefined => (phone ? undefined : rootRef.current?.getBoundingClientRect().width),
		[phone],
	);
	const collapsedRef = useRef<PaneKind | null>(null);
	const collapse = useCallback(() =>
	{
		collapsedRef.current = layout.expanded;
		update(collapsePane);
	}, [layout.expanded, update]);

	useEffect(() =>
	{
		if (requestedPane === undefined || !loaded) return;
		if (definitions.has(requestedPane)) update(openWithMemory(requestedPane, fitWidth()));
		onRequestedPaneHandled?.();
	}, [requestedPane, loaded, definitions, update, onRequestedPaneHandled, fitWidth]);
	const openKinds = useMemo(() => tileIdsOf(layout.root).filter(isPaneKind), [layout.root]);

	const [contentHosts] = useState(() => new TileContentHosts(document));
	const hidden = useMemo(() => hiddenWhileExpanded(layout.root, layout.expanded), [layout.root, layout.expanded]);
	// Upstream's solo layout keeps only the expanded tile and the kept (`q9`) tiles mounted.
	const mountedTiles = useMemo(
		() =>
			tileIdsOf(layout.root).filter(
				(tileId) => layout.expanded === null || tileId === layout.expanded || hidden.has(tileId),
			),
		[layout.root, layout.expanded, hidden],
	);
	const liveTileIds = useMemo(() => new Set(mountedTiles), [mountedTiles]);

	// Upstream `VPe`: an unprompted open beside the lone chat is drawn over the chat's empty end while there is room,
	// and settles into the split on the next press, key, wheel or resize. A phone has no side panes to overlay.
	const overlaid = phone ? null : overlayTile(layout);
	const overlayOpenedAt = overlaid === null ? null : (layout.overlay?.openedAt ?? null);
	const [measured, setMeasured] = useState<DrawnOverlay | null>(null);
	const drawn = measured?.tileId === overlaid && measured.openedAt === overlayOpenedAt ? measured : null;
	const pendingOverlay = drawn === null ? overlaid : null;
	const settle = useCallback(() =>
	{
		update(settleOverlay);
	}, [update]);
	useLayoutEffect(() =>
	{
		if (pendingOverlay === null || overlayOpenedAt === null) return;
		const root = rootRef.current;
		const column = root?.querySelector("[data-epitaxy-chat-column]") ?? null;
		if (root === null || column === null)
		{
			settle();
			return;
		}
		const containerWidth = root.getBoundingClientRect().width;
		const fit = overlayFit(
			{
				root: layout.root,
				tileId: pendingOverlay,
				containerWidth,
				spareWidth: overlaySpareWidth(
					{
						containerWidth,
						chatColumnWidth: column.getBoundingClientRect().width + railOverhang(root),
						scrollbarWidth: scrollbarWidth(root),
					},
				),
			},
		);
		if (fit === null)
		{
			settle();
			return;
		}
		update((state) => syncOverlayPaneFlex(state, pendingOverlay, fit.paneFlex));
		setMeasured(
			{
				tileId: pendingOverlay,
				openedAt: overlayOpenedAt,
				width: fit.width,
				reservePx: fit.reservePx,
				containerWidth,
			},
		);
	}, [pendingOverlay, overlayOpenedAt, layout.root, settle, update]);
	const drawnKey = drawn === null ? null : `${drawn.tileId}\0${drawn.openedAt}`;
	const drawnWidth = drawn?.containerWidth ?? null;
	useEffect(() =>
	{
		const root = rootRef.current;
		if (drawnKey === null || drawnWidth === null || root === null) return undefined;
		const doc = root.ownerDocument;
		const passive =
		{
			capture: true,
			passive: true,
		};
		doc.addEventListener("pointerdown", settle, true);
		doc.addEventListener("keydown", settle, true);
		doc.addEventListener("wheel", settle, passive);
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() =>
					{
						if (Math.abs(root.getBoundingClientRect().width - drawnWidth) >= 1) settle();
					});
		observer?.observe(root);
		return () =>
		{
			doc.removeEventListener("pointerdown", settle, true);
			doc.removeEventListener("keydown", settle, true);
			doc.removeEventListener("wheel", settle, passive);
			observer?.disconnect();
		};
	}, [drawnKey, drawnWidth, settle]);
	const overlay = useMemo<HostOverlay | null>(
		() =>
			overlaid === null
				? null
				:
					{
						tileId: overlaid,
						drawn,
					},
		[overlaid, drawn],
	);
	const flowRoot = useMemo<StackNode>(
		() =>
			overlaid === null
				? layout.root
				:
					{
						...layout.root,
						children: layout.root.children.filter(
							(child) => child.kind !== "tile" || child.tileId !== overlaid,
						),
					},
		[layout.root, overlaid],
	);

	// Upstream recomputes the edges against out-of-flow neighbours, so an expanded tile leaves every shell without them.
	const shellEdges = useMemo(
		() =>
			layout.expanded === null && tileIdsOf(flowRoot).length > 1
				? tileShellEdges(flowRoot)
				: new Map<TileId, TileShellEdges>(),
		[flowRoot, layout.expanded],
	);
	const rowEnd = useMemo(() => rowEndOnlyTileIds(layout.root), [layout.root]);
	// Upstream `tFe`: `Pe = wd(eligible)`, the row element, and the lift the header reports. The phone sheet stands in
	// for upstream's ineligible layouts (tabbed side panel, pop-out).
	const wideVariant = phone ? null : wideTitleRow;
	const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
	const [rowLifted, setRowLifted] = useState(false);
	const under = rowLifted ? wideVariant : null;
	const overChat = wideVariant !== null && topEdgeTiles(layout.root).has("chat");
	const wideRow = useMemo<WideTitleRowSlot | null>(
		() =>
			wideVariant === null
				? null
				:
					{
						el: rowEl,
						overChat,
						onRowLifted: setRowLifted,
					},
		[wideVariant, rowEl, overChat],
	);
	// Upstream `setInteractHandler(onTileInteract)`: focus entering a tile, or a press in it, makes it the focused tile.
	useLayoutEffect(() =>
	{
		contentHosts.setInteractHandler((id) =>
		{
			const tileId = parseTileId(id);
			if (tileId !== null) update((state) => focusPane(state, tileId));
		});
	}, [contentHosts, update]);
	const focusScopeRef = useRef(
		{
			sessionId,
			root: layout.root,
		},
	);
	// Upstream's retain effect: when the tile holding focus closes and focus fell to the body, hand focus to the nearest
	// neighbour with a focus target (usually the composer) and make the nearest neighbour the focused tile.
	useLayoutEffect(() =>
	{
		const previous = focusScopeRef.current;
		focusScopeRef.current =
		{
			sessionId,
			root: layout.root,
		};
		const closed = parseTileId(contentHosts.retain(liveTileIds));
		if (closed === null || previous.sessionId !== sessionId) return;
		const before = new Set(tileIdsOf(previous.root));
		const after = new Set(tileIdsOf(layout.root));
		// Still in the layout while a pane is expanded: hidden or unmounted, not closed (the hide effect owns it).
		if (!before.has(closed) || (layout.expanded !== null && after.has(closed))) return;
		// Upstream's `focusHeirOf` (the tabbed side panel's new front tab) waits for side-panel-tabbed-mode.
		// A tile opened in the same update owns focus.
		if ([...after].some((id) => !before.has(id))) return;
		const eligible = (id: TileId) => liveTileIds.has(id) && !hidden.has(id);
		const nearest = focusNeighbour(previous.root, closed, eligible) ?? mountedTiles.find(eligible) ?? null;
		const target =
			focusNeighbour(previous.root, closed, (id) => eligible(id) && contentHosts.hasFocusTarget(id)) ?? nearest;
		if (target === null || !eligible(target) || !contentHosts.focusTile(target)) return;
		if (nearest !== null && nearest !== target) update((state) => focusPane(state, nearest));
	}, [contentHosts, liveTileIds, sessionId, layout.root, layout.expanded, hidden, mountedTiles, update]);
	const hiddenRef = useRef(hidden);
	const focusReturnRef = useRef<FocusReturn | null>(null);
	// Upstream's hide effect: a tile hidden while it held focus hands it to the first visible tile, and showing it again
	// takes focus back, unless focus moved off where it landed.
	useLayoutEffect(() =>
	{
		const previous = hiddenRef.current;
		hiddenRef.current = hidden;
		const pending = focusReturnRef.current;
		if (pending !== null && !hidden.has(pending.from))
		{
			focusReturnRef.current = null;
			if (document.activeElement === pending.landedOn) contentHosts.focusTile(pending.from);
			return;
		}
		let from: TileId | null = null;
		for (const id of hidden) if (!previous.has(id) && contentHosts.holdsFocus(id)) from = id;
		if (from === null) return;
		const target = mountedTiles.find((id) => !hidden.has(id));
		if (target !== undefined && contentHosts.focusTile(target))
			focusReturnRef.current =
			{
				from,
				landedOn: document.activeElement,
			};
	}, [contentHosts, mountedTiles, hidden]);
	// Upstream `At`/`kt`: a press, or a key that is input (no Ctrl/Meta/Alt, not a lone modifier), cancels the return.
	useEffect(() =>
	{
		const cancel = () =>
		{
			focusReturnRef.current = null;
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (isUserInputKey(event)) cancel();
		};
		document.addEventListener("pointerdown", cancel, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () =>
		{
			document.removeEventListener("pointerdown", cancel, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, []);
	// Passive, so it runs after the unmounting shells parked their hosts and the portals emptied them.
	useEffect(
		() => () =>
		{
			contentHosts.releaseParked();
		},
		[contentHosts],
	);

	const [keyboardPreview, setKeyboardPreview] = useState<KeyboardPreview | null>(null);
	const [lastKeyboardMove, setLastKeyboardMove] = useState<KeyboardMoveNotice | null>(null);
	const announceMove = useCallback((position: number, total: number) =>
	{
		setLastKeyboardMove((previous) => (
		{
			position,
			total,
			seq: (previous?.seq ?? 0) + 1,
		}));
	}, []);
	const [stackElements] = useState(() => new Map<string, HTMLElement>());
	const drag = useTileDrag(rootRef, stackElements, layout, update);
	const dropTarget = drag.target ?? keyboardPreview?.target ?? null;

	const internal = useMemo<InternalHost>(
		() => (
		{
			definitions,
			layout,
			update,
			keyboardPreview,
			setKeyboardPreview,
			announceMove,
			lastKeyboardMove,
			dropTarget,
			contentHosts,
			dragging: drag.dragging,
			movingTile: drag.lifted,
			startDrag: drag.start,
			stackElements,
			expanded: layout.expanded,
			hidden,
			mountedCount: mountedTiles.length,
			shellEdges,
			rowEnd,
			overlay,
			flowRoot,
			under,
			wideRow,
			phone,
			rootRef,
			rootSize,
			resolved,
			collapsedRef,
			collapse,
		}),
		[
			definitions,
			layout,
			update,
			keyboardPreview,
			announceMove,
			lastKeyboardMove,
			dropTarget,
			contentHosts,
			drag.dragging,
			drag.lifted,
			drag.start,
			stackElements,
			hidden,
			mountedTiles,
			shellEdges,
			rowEnd,
			overlay,
			flowRoot,
			under,
			wideRow,
			phone,
			rootSize,
			resolved,
			collapse,
		],
	);

	const api = useMemo<PaneHostApi>(
		() => (
		{
			layout,
			openKinds,
			isOpen: (kind) => openKinds.includes(kind),
			// Upstream fits only user-initiated opens; an unprompted one may draw as an overlay instead.
			openPane: (kind, options) =>
			{
				update(openWithMemory(kind, options?.unprompted === true ? undefined : fitWidth(), options));
			},
			closePane: (kind) =>
			{
				update((state) => closePane(state, kind));
			},
			togglePane: (kind) =>
			{
				const widthPx = fitWidth();
				update((state) => togglePane(state, kind, openWithMemory(kind, widthPx)));
			},
		}),
		[layout, openKinds, update, fitWidth],
	);

	useShortcut("close_pane", () =>
	{
		if (!isPaneKind(layout.focused)) return false;
		const focused = layout.focused;
		update((state) => closePane(state, focused));
		return true;
	});

	// ⇧⌘\ and the palette's Expand/Collapse pane: collapse, else expand the focused pane, else the last open one.
	const toggleExpand = useCallback((): boolean =>
	{
		if (layout.expanded !== null)
		{
			collapse();
			return true;
		}
		const target = isPaneKind(layout.focused) ? layout.focused : openKinds.at(-1);
		if (target === undefined) return false;
		update((state) => expandPane(state, target));
		return true;
	}, [layout.expanded, layout.focused, openKinds, collapse, update]);

	useShortcut("expand_collapse_pane", () =>
	{
		if (toggleExpand()) return true;
		if (onExpandWithoutPane === undefined) return false;
		onExpandWithoutPane();
		return true;
	});

	return (
		<PaneHostContext.Provider value={api}>
			<PaneExpandToggleContext.Provider value={toggleExpand}>
				<ScrollFreezer
					contentHosts={contentHosts}
					structureKey={structureKey(layout.root)}
					liveTileIds={liveTileIds}
				/>
				{/* Upstream `tFe`'s tiles root, marked while the header is lifted, holding the wide row (`z3`) after the tiles. */}
				<div
					{...(under === null
						? {}
						:
							{
								"data-under-wide-title-row": under,
							})}
					className="relative h-full w-full"
				>
					<StackView stack={layout.root} path={[]} orderKey="" aheadKey="" host={internal} />
					{wideVariant !== null && (
						<div
							ref={setRowEl}
							data-wide-title-row=""
							className="absolute inset-x-0 top-0 px-2"
							style={WIDE_ROW_STYLE}
							inert={hidden.has("chat")}
						/>
					)}
				</div>
				<MoveStatus host={internal} />
				{mountedTiles.map((tileId) => (
					<TileContent key={tileId} tileId={tileId} host={internal} chat={children} />
				))}
			</PaneExpandToggleContext.Provider>
		</PaneHostContext.Provider>
	);
}
