import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {Maximize2, Minimize2, X} from "lucide-react";

import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {
	closePane,
	collapsePane,
	defaultPaneLayout,
	dropPreview,
	expandPane,
	focusPane,
	loadPaneLayout,
	minTileSize,
	movePane,
	movePaneTo,
	movePreview,
	openPane,
	parseTileId,
	resizeDivider,
	savePaneLayout,
	type Direction,
	type LayoutNode,
	type MoveDirection,
	type MovePreview,
	type PaneKind,
	type PaneLayoutState,
	type StackNode,
	type TileId,
} from "../../lib/pane-layout";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";
import {type PaneDefinition, usePaneDefinitions} from "./pane-registry";

/** Upstream `--tiles-gap`, mirrored by the reducer's gap maths. */
const TILE_GAP_PX = 12;
const RESIZE_STEP_PX = 16;
const RESIZE_STEP_LARGE_PX = 64;
/** A Move grip press becomes a drag once the pointer travels this far. */
const DRAG_THRESHOLD_PX = 4;
/** Below 640px a side pane covers the viewport instead of squeezing beside the chat. */
const PHONE_SLOT_CLASSES = "fixed inset-0 z-40 w-full h-dvh";
/** Upstream's expanded pane: maximised over the sidebar and titlebar, 9px in from the window edge. */
const EXPANDED_SLOT_CLASSES = "fixed inset-[9px] z-40";

type LayoutUpdate = (state: PaneLayoutState) => PaneLayoutState;

export interface PaneHostApi {
	layout: PaneLayoutState;
	isOpen: (kind: PaneKind) => boolean;
	openPane: (kind: PaneKind) => void;
	closePane: (kind: PaneKind) => void;
	togglePane: (kind: PaneKind) => void;
}

const PaneHostContext = createContext<PaneHostApi | null>(null);

export function usePaneHost(): PaneHostApi {
	const host = useContext(PaneHostContext);
	if (host === null) throw new Error("usePaneHost must be used inside <TileHost>");
	return host;
}

/** The pane host, or null outside a `<TileHost>` (e.g. a transcript shown on its own). */
export function useOptionalPaneHost(): PaneHostApi | null {
	return useContext(PaneHostContext);
}

interface PendingMove {
	tileId: TileId;
	direction: MoveDirection;
}

/** Where a pointer drag on Move would drop `tileId`: the `side` half of `targetId`. */
interface PointerDrop {
	tileId: TileId;
	targetId: TileId;
	side: MoveDirection;
}

interface InternalHost {
	definitions: ReadonlyMap<PaneKind, PaneDefinition>;
	layout: PaneLayoutState;
	update: (fn: LayoutUpdate) => void;
	/** The perpendicular move waiting for Enter, and the outline it draws. */
	pendingMove: PendingMove | null;
	preview: MovePreview | null;
	setPendingMove: (move: PendingMove | null) => void;
	setPointerDrop: (drop: PointerDrop | null) => void;
	expanded: PaneKind | null;
	phone: boolean;
	/** The root row, measured when a pane opens so Changes can be sized to its minimum. */
	rootRef: RefObject<HTMLDivElement | null>;
	/** The pane just collapsed, whose Expand button takes focus back. */
	collapsedRef: RefObject<PaneKind | null>;
	collapse: () => void;
}

function tileIdsOf(node: LayoutNode): TileId[] {
	return node.kind === "tile" ? [node.tileId] : node.children.flatMap(tileIdsOf);
}

function isPaneKind(tileId: TileId): tileId is PaneKind {
	return tileId !== "chat";
}

/** Drops panes whose kind has no registered renderer, e.g. a persisted pane not ported yet. */
function pruneUnregistered(
	state: PaneLayoutState,
	definitions: ReadonlyMap<PaneKind, PaneDefinition>,
): PaneLayoutState {
	return tileIdsOf(state.root)
		.filter(isPaneKind)
		.filter((kind) => !definitions.has(kind))
		.reduce(closePane, state);
}

function nodeTitle(node: LayoutNode, definitions: ReadonlyMap<PaneKind, PaneDefinition>): string {
	return tileIdsOf(node)
		.map((tileId) => (tileId === "chat" ? "Chat" : (definitions.get(tileId)?.title ?? tileId)))
		.join(", ");
}

function nodeKey(node: LayoutNode): string {
	return node.kind === "tile" ? node.tileId : `stack:${tileIdsOf(node).join(",")}`;
}

function usePersistedLayout(
	sessionId: string,
	definitions: ReadonlyMap<PaneKind, PaneDefinition>,
): [PaneLayoutState, (fn: LayoutUpdate) => void, boolean] {
	const [entry, setEntry] = useState<{
		sessionId: string | null;
		layout: PaneLayoutState;
	}>(() => ({
		sessionId: null,
		layout: defaultPaneLayout(),
	}));
	const loadedRef = useRef<PaneLayoutState | null>(null);

	useEffect(() => {
		const layout = loadPaneLayout(sessionId);
		loadedRef.current = layout;
		setEntry({sessionId, layout});
	}, [sessionId]);

	useEffect(() => {
		if (entry.sessionId === null || entry.layout === loadedRef.current) return;
		savePaneLayout(entry.sessionId, entry.layout);
	}, [entry]);

	const update = useCallback(
		(fn: LayoutUpdate) =>
			setEntry((prev) => {
				if (prev.sessionId !== sessionId) return prev;
				const next = fn(pruneUnregistered(prev.layout, definitions));
				return next === prev.layout ? prev : {sessionId, layout: next};
			}),
		[sessionId, definitions],
	);

	const loaded = entry.sessionId === sessionId;
	const current = loaded ? entry.layout : defaultPaneLayout();
	const layout = useMemo(() => pruneUnregistered(current, definitions), [current, definitions]);
	return [layout, update, loaded];
}

function useElementSize(ref: RefObject<HTMLElement | null>): {
	width: number;
	height: number;
} {
	const [size, setSize] = useState({width: 0, height: 0});
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => {
			const {width, height} = element.getBoundingClientRect();
			setSize((prev) => (prev.width === width && prev.height === height ? prev : {width, height}));
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

function sizeAlong(element: HTMLElement | null, direction: Direction): number {
	if (!element) return 0;
	const rect = element.getBoundingClientRect();
	return direction === "row" ? rect.width : rect.height;
}

function Divider({
	stack,
	path,
	index,
	sizePx,
	stackRef,
	corners,
	host,
}: {
	stack: StackNode;
	path: readonly number[];
	index: number;
	sizePx: number;
	stackRef: RefObject<HTMLDivElement | null>;
	/** Root dividers beside this column divider, keyed by the side they meet it on. */
	corners: Partial<Record<"left" | "right", number>>;
	host: InternalHost;
}) {
	const before = stack.children[index];
	const after = stack.children[index + 1];
	const dragRef = useRef<number | null>(null);
	if (before === undefined || after === undefined) return null;

	const total = stack.children.reduce((sum, child) => sum + child.flex, 0);
	const prefixFlex = stack.children.slice(0, index).reduce((sum, child) => sum + child.flex, 0);
	const now = Math.round(((prefixFlex + before.flex) / total) * 100);
	const available = sizePx - TILE_GAP_PX * (stack.children.length - 1);
	const bounds =
		available > 0
			? {
					"aria-valuemin": Math.round(
						(((prefixFlex / total) * available + minTileSize(before, stack.direction)) / available) * 100,
					),
					"aria-valuemax": Math.round(
						((((prefixFlex + before.flex + after.flex) / total) * available -
							minTileSize(after, stack.direction)) /
							available) *
							100,
					),
				}
			: {};
	const isRow = stack.direction === "row";

	function resizeBy(deltaPx: number) {
		const measured = sizeAlong(stackRef.current, stack.direction);
		if (measured <= 0) return;
		host.update((state) => resizeDivider(state, {path, index, deltaPx, sizePx: measured}));
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		const decrease = isRow ? "ArrowLeft" : "ArrowUp";
		const increase = isRow ? "ArrowRight" : "ArrowDown";
		if (event.key !== decrease && event.key !== increase) return;
		event.preventDefault();
		const step = event.shiftKey ? RESIZE_STEP_LARGE_PX : RESIZE_STEP_PX;
		resizeBy(event.key === increase ? step : -step);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = isRow ? event.clientX : event.clientY;
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		if (dragRef.current === null) return;
		const position = isRow ? event.clientX : event.clientY;
		const delta = position - dragRef.current;
		if (delta === 0) return;
		dragRef.current = position;
		resizeBy(delta);
	}

	function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}

	return (
		<div
			role="separator"
			tabIndex={0}
			data-tile-divider
			aria-orientation={isRow ? "vertical" : "horizontal"}
			aria-valuenow={now}
			{...bounds}
			aria-label={`Resize ${nodeTitle(before, host.definitions)} and ${nodeTitle(after, host.definitions)}`}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className={`group/divider relative flex shrink-0 touch-none items-center justify-center outline-none ${
				isRow ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize"
			}`}
		>
			<span
				aria-hidden
				className={`rounded-full bg-fill-grip opacity-0 transition-opacity duration-[120ms] group-hover/divider:opacity-100 group-focus-visible/divider:bg-accent-100 group-focus-visible/divider:opacity-100 group-active/divider:bg-fill-primary group-active/divider:opacity-100 ${
					isRow ? "h-14 w-[3px]" : "h-[3px] w-14"
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
}) {
	const dragRef = useRef<{x: number; y: number} | null>(null);

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {x: event.clientX, y: event.clientY};
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		const drag = dragRef.current;
		if (drag === null) return;
		event.stopPropagation();
		const deltaX = event.clientX - drag.x;
		const deltaY = event.clientY - drag.y;
		if (deltaX === 0 && deltaY === 0) return;
		dragRef.current = {x: event.clientX, y: event.clientY};
		const rowPx = sizeAlong(host.rootRef.current, "row");
		const columnPx = sizeAlong(columnRef.current, "column");
		if (rowPx <= 0 || columnPx <= 0) return;
		host.update((state) =>
			resizeDivider(resizeDivider(state, {path: [], index: rootIndex, deltaPx: deltaX, sizePx: rowPx}), {
				path: columnPath,
				index: columnIndex,
				deltaPx: deltaY,
				sizePx: columnPx,
			}),
		);
	}

	function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
		event.stopPropagation();
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

function dropSide(rect: DOMRect, clientX: number, clientY: number): MoveDirection {
	const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
	const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
	const edges: Array<[MoveDirection, number]> = [
		["left", x],
		["right", 1 - x],
		["top", y],
		["bottom", 1 - y],
	];
	return edges.reduce((nearest, edge) => (edge[1] < nearest[1] ? edge : nearest))[0];
}

/** The tile under the pointer and the half nearest it, or null over the dragged tile or no tile. */
function dropAt(tileId: TileId, clientX: number, clientY: number): PointerDrop | null {
	const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-tile-host]");
	if (element === null || element === undefined) return null;
	const targetId = parseTileId(element.dataset["tileHost"]);
	if (targetId === null || targetId === tileId) return null;
	return {tileId, targetId, side: dropSide(element.getBoundingClientRect(), clientX, clientY)};
}

const MOVE_KEYS: Readonly<Record<string, MoveDirection>> = {
	ArrowLeft: "left",
	ArrowRight: "right",
	ArrowUp: "top",
	ArrowDown: "bottom",
};

const MOVE_HINT =
	"Arrow keys move the tile. Perpendicular arrows preview a split; press Enter to commit or Escape to cancel.";

/**
 * Upstream's Move grip. Arrows along the tile's stack move it straight away;
 * perpendicular arrows outline the split first, Enter commits and Escape cancels.
 */
function MoveHandle({tileId, host}: {tileId: TileId; host: InternalHost}) {
	const hintId = `pane-move-hint-${tileId}`;
	const pending = host.pendingMove?.tileId === tileId ? host.pendingMove : null;
	const dragRef = useRef<{x: number; y: number; dragging: boolean} | null>(null);

	function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {x: event.clientX, y: event.clientY, dragging: false};
	}

	function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
		const drag = dragRef.current;
		if (drag === null) return;
		if (!drag.dragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
		drag.dragging = true;
		host.setPendingMove(null);
		host.setPointerDrop(dropAt(tileId, event.clientX, event.clientY));
	}

	function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
		const drag = dragRef.current;
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
		host.setPointerDrop(null);
		const drop = drag?.dragging === true ? dropAt(tileId, event.clientX, event.clientY) : null;
		if (drop !== null) host.update((state) => movePaneTo(state, tileId, drop.targetId, drop.side));
	}

	function onPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
		host.setPointerDrop(null);
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
		if (pending !== null && (event.key === "Enter" || event.key === "Escape")) {
			event.preventDefault();
			event.stopPropagation();
			host.setPendingMove(null);
			if (event.key === "Enter") host.update((state) => movePane(state, tileId, pending.direction));
			return;
		}
		const direction = MOVE_KEYS[event.key];
		if (direction === undefined) return;
		event.preventDefault();
		if (movePreview(host.layout, tileId, direction) !== null) {
			host.setPendingMove({tileId, direction});
			return;
		}
		host.setPendingMove(null);
		host.update((state) => movePane(state, tileId, direction));
	}

	return (
		<div className="absolute top-0 left-1/2 z-10 flex -translate-x-1/2">
			<Tooltip content="Move" side="bottom">
				<button
					type="button"
					aria-label="Move"
					aria-describedby={hintId}
					onKeyDown={onKeyDown}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerCancel}
					onBlur={() => {
						if (pending !== null) host.setPendingMove(null);
					}}
					className="group/move flex h-4 w-11 cursor-move touch-none items-center justify-center outline-none"
				>
					<span className="h-[3px] w-8 rounded-full bg-fill-grip opacity-0 transition-opacity group-hover/move:opacity-100 group-focus-visible/move:bg-accent-100 group-focus-visible/move:opacity-100" />
					<span id={hintId} className="sr-only">
						{MOVE_HINT}
					</span>
				</button>
			</Tooltip>
		</div>
	);
}

const PREVIEW_SIDE_CLASSES: Readonly<Record<MoveDirection, string>> = {
	left: "inset-y-0 left-0 w-1/2",
	right: "inset-y-0 right-0 w-1/2",
	top: "inset-x-0 top-0 h-1/2",
	bottom: "inset-x-0 bottom-0 h-1/2",
};

function samePath(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Outlines the half of the node at `path` that a pending split move will take. */
function MovePreviewOutline({path, host}: {path: readonly number[]; host: InternalHost}) {
	const preview = host.preview;
	if (preview === null || !samePath(preview.path, path)) return null;
	return (
		<div
			aria-hidden
			data-tile-move-preview={preview.side}
			className={`pointer-events-none absolute z-20 rounded-r7 border-2 border-accent-100 bg-accent-100/10 ${PREVIEW_SIDE_CLASSES[preview.side]}`}
		/>
	);
}

function PaneSurface({kind, definition, host}: {kind: PaneKind; definition: PaneDefinition; host: InternalHost}) {
	const expandKeys = useShortcutKeys("expand_collapse_pane");
	const closeKeys = useShortcutKeys("close_pane");
	const isExpanded = host.expanded === kind;
	const toggleRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (isExpanded || host.collapsedRef.current !== kind) return;
		host.collapsedRef.current = null;
		toggleRef.current?.focus();
	}, [isExpanded, kind, host.collapsedRef]);

	const moveHandle = isExpanded ? null : <MoveHandle tileId={kind} host={host} />;

	const controls = (
		<>
			<Tooltip content={isExpanded ? "Collapse" : "Expand"} shortcut={expandKeys.keys}>
				<button
					ref={toggleRef}
					type="button"
					aria-label={isExpanded ? "Collapse" : "Expand"}
					aria-keyshortcuts={expandKeys.ariaKeyShortcuts}
					{...(isExpanded ? {} : {"aria-haspopup": "dialog" as const})}
					onClick={() => (isExpanded ? host.collapse() : host.update((state) => expandPane(state, kind)))}
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
					onClick={() => host.update((state) => closePane(state, kind))}
					className={PANE_HEADER_ICON_BUTTON_CLASS}
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
			className="relative isolate flex h-full min-w-0 flex-col rounded-r7 bg-surface-2 shadow-panel-sm"
		>
			{definition.header === "custom" ? (
				definition.render({moveHandle, controls})
			) : (
				<>
					<div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
						<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
							{definition.title}
						</span>
						{moveHandle}
						<div className="relative flex shrink-0 items-center gap-0.5">{controls}</div>
					</div>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
						<div className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]">
							{definition.render({moveHandle, controls})}
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
function cornersOf(path: readonly number[], host: InternalHost): Partial<Record<"left" | "right", number>> {
	const [rootIndex, ...rest] = path;
	if (rootIndex === undefined || rest.length > 0 || host.phone) return {};
	const corners: Partial<Record<"left" | "right", number>> = {};
	if (rootIndex > 0) corners.left = rootIndex - 1;
	if (rootIndex < host.layout.root.children.length - 1) corners.right = rootIndex;
	return corners;
}

function StackView({
	stack,
	path,
	host,
	chat,
}: {
	stack: StackNode;
	path: readonly number[];
	host: InternalHost;
	chat: ReactNode;
}) {
	const localRef = useRef<HTMLDivElement>(null);
	const isRoot = path.length === 0;
	const ref = isRoot ? host.rootRef : localRef;
	const size = useElementSize(ref);
	const sizePx = stack.direction === "row" ? size.width : size.height;

	const items: ReactNode[] = [];
	// Keep the expanded pane and chat on their keyed paths so their reader state survives.
	stack.children.forEach((child, index) => {
		if (host.expanded === null && index > 0 && !(isRoot && host.phone)) {
			items.push(
				<Divider
					key={`divider:${nodeKey(stack.children[index - 1] ?? child)}|${nodeKey(child)}`}
					stack={stack}
					path={path}
					index={index - 1}
					sizePx={sizePx}
					stackRef={ref}
					corners={cornersOf(path, host)}
					host={host}
				/>,
			);
		}
		items.push(
			<NodeView
				key={nodeKey(child)}
				node={child}
				path={[...path, index]}
				host={host}
				chat={chat}
				isRootChild={isRoot}
			/>,
		);
	});

	return (
		<div
			ref={ref}
			data-tile-stack={stack.direction}
			className={`flex h-full min-h-0 min-w-0 items-stretch ${stack.direction === "row" ? "flex-row" : "flex-col"}`}
			style={isRoot ? undefined : {flex: `${stack.flex} 1 0`}}
		>
			{items}
		</div>
	);
}

function NodeView({
	node,
	path,
	host,
	chat,
	isRootChild,
}: {
	node: LayoutNode;
	path: readonly number[];
	host: InternalHost;
	chat: ReactNode;
	isRootChild: boolean;
}) {
	const style = {flex: `${node.flex} 1 0`};
	const phone = isRootChild && host.phone;
	const slotClass = `min-h-0 min-w-0 ${phone ? PHONE_SLOT_CLASSES : "relative"}`;
	if (node.kind === "stack") {
		return (
			<div
				className={`flex ${slotClass}`}
				style={style}
				hidden={host.expanded !== null && !tileIdsOf(node).includes(host.expanded)}
				{...(phone ? {"data-pane-phone": ""} : {})}
			>
				<StackView stack={node} path={path} host={host} chat={chat} />
				<MovePreviewOutline path={path} host={host} />
			</div>
		);
	}
	if (node.tileId === "chat") {
		const hidden = host.expanded !== null;
		return (
			<TileSlot tileId="chat" host={host} className="relative min-h-0 min-w-0" style={style} hidden={hidden}>
				{!hidden && tileIdsOf(host.layout.root).length > 1 && (
					// Keep the chat's Move grip above its titlebar while the transcript scrolls.
					<div className="sticky top-0 z-20 h-0">
						<MoveHandle tileId="chat" host={host} />
					</div>
				)}
				{chat}
				<MovePreviewOutline path={path} host={host} />
			</TileSlot>
		);
	}
	if (host.expanded !== null && host.expanded !== node.tileId) return null;
	const definition = host.definitions.get(node.tileId);
	if (definition === undefined) return null;
	const expanded = host.expanded === node.tileId;
	return (
		<TileSlot
			tileId={node.tileId}
			host={host}
			className={
				expanded ? `min-h-0 min-w-0 ${host.phone ? PHONE_SLOT_CLASSES : EXPANDED_SLOT_CLASSES}` : slotClass
			}
			style={expanded ? undefined : style}
			phone={expanded ? host.phone : phone}
			{...(expanded ? {"data-pane-overlay": true} : {})}
		>
			<PaneSurface kind={node.tileId} definition={definition} host={host} />
			<MovePreviewOutline path={path} host={host} />
		</TileSlot>
	);
}

function TileSlot({
	tileId,
	host,
	className,
	style,
	hidden,
	phone = false,
	children,
	...data
}: {
	tileId: TileId;
	host: InternalHost;
	className?: string;
	style?: CSSProperties | undefined;
	hidden?: boolean;
	phone?: boolean;
	children: ReactNode;
	"data-pane-overlay"?: boolean;
}) {
	const focus = () => host.update((state) => focusPane(state, tileId));
	return (
		<div
			data-tile-host={tileId}
			className={className}
			style={style}
			hidden={hidden}
			onPointerDownCapture={focus}
			onFocusCapture={focus}
			{...(phone ? {"data-pane-phone": ""} : {})}
			{...data}
		>
			{children}
		</div>
	);
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
	children,
}: {
	sessionId: string;
	onExpandWithoutPane?: () => void;
	requestedPane?: PaneKind | undefined;
	onRequestedPaneHandled?: (() => void) | undefined;
	children: ReactNode;
}) {
	const definitions = usePaneDefinitions();
	const [layout, update, loaded] = usePersistedLayout(sessionId, definitions);
	const phone = usePhoneSheet();
	const rootRef = useRef<HTMLDivElement>(null);
	const collapsedRef = useRef<PaneKind | null>(null);
	const collapse = useCallback(() => {
		collapsedRef.current = layout.expanded;
		update(collapsePane);
	}, [layout.expanded, update]);
	const open = useCallback(
		(state: PaneLayoutState, kind: PaneKind) => openPane(state, kind, sizeAlong(rootRef.current, "row")),
		[],
	);

	useEffect(() => {
		if (requestedPane === undefined || !loaded) return;
		if (definitions.has(requestedPane)) update((state) => open(state, requestedPane));
		onRequestedPaneHandled?.();
	}, [requestedPane, loaded, definitions, update, open, onRequestedPaneHandled]);
	const openKinds = useMemo(() => tileIdsOf(layout.root).filter(isPaneKind), [layout.root]);

	const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
	const [pointerDrop, setPointerDrop] = useState<PointerDrop | null>(null);
	const preview = useMemo(() => {
		if (pointerDrop !== null)
			return dropPreview(layout, pointerDrop.tileId, pointerDrop.targetId, pointerDrop.side);
		return pendingMove === null ? null : movePreview(layout, pendingMove.tileId, pendingMove.direction);
	}, [layout, pendingMove, pointerDrop]);

	const internal = useMemo<InternalHost>(
		() => ({
			definitions,
			layout,
			update,
			pendingMove,
			preview,
			setPendingMove,
			setPointerDrop,
			expanded: layout.expanded,
			phone,
			rootRef,
			collapsedRef,
			collapse,
		}),
		[definitions, layout, update, pendingMove, preview, phone, collapse],
	);

	const api = useMemo<PaneHostApi>(
		() => ({
			layout,
			isOpen: (kind) => openKinds.includes(kind),
			openPane: (kind) => update((state) => open(state, kind)),
			closePane: (kind) => update((state) => closePane(state, kind)),
			togglePane: (kind) =>
				update((state) => (tileIdsOf(state.root).includes(kind) ? closePane(state, kind) : open(state, kind))),
		}),
		[layout, openKinds, update, open],
	);

	useShortcut("close_pane", () => {
		if (!isPaneKind(layout.focused)) return false;
		const focused = layout.focused;
		update((state) => closePane(state, focused));
		return true;
	});

	useShortcut("expand_collapse_pane", () => {
		if (layout.expanded !== null) {
			collapse();
			return true;
		}
		const target = isPaneKind(layout.focused) ? layout.focused : openKinds.at(-1);
		if (target !== undefined) {
			update((state) => expandPane(state, target));
			return true;
		}
		if (onExpandWithoutPane === undefined) return false;
		onExpandWithoutPane();
		return true;
	});

	return (
		<PaneHostContext.Provider value={api}>
			<StackView stack={layout.root} path={[]} host={internal} chat={children} />
		</PaneHostContext.Provider>
	);
}
