import {z} from "zod";

import {parseDiffScope} from "./api/session-diff";
import {EMPTY_FILE_TABS, type FileTabsState, FileTabsStateSchema} from "./file-tabs";

/**
 * Pure layout engine for the session tiling pane host, modelled on
 * claude.ai/code's tile tree. The root is always a row stack holding the chat
 * tile; side panes are placed the way upstream places them: the 1st splits the
 * row 2:3, the 2nd stacks under the side column, the 3rd opens a new column,
 * and Changes always opens as its own narrow column at the far right.
 * Expand is an overlay mode that hides the chat tile without touching the tree.
 */

const PANE_KINDS = [
	"files",
	"links",
	"changes",
	"terminal",
	"background-tasks",
	"plan",
	"artifacts",
	"subagents",
	"side-chat",
	"session-details",
] as const;

export const PaneKindSchema = z.enum(PANE_KINDS);
const TileIdSchema = z.enum(["chat", ...PANE_KINDS]);
const DirectionSchema = z.enum(["row", "column"]);

export type PaneKind = z.infer<typeof PaneKindSchema>;
export type TileId = z.infer<typeof TileIdSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type MoveDirection = "left" | "right" | "top" | "bottom";

export interface TileNode {
	kind: "tile";
	tileId: TileId;
	flex: number;
}

export interface StackNode {
	kind: "stack";
	direction: Direction;
	flex: number;
	children: LayoutNode[];
}

export type LayoutNode = TileNode | StackNode;

export interface PaneLayoutState {
	root: StackNode;
	expanded: PaneKind | null;
	focused: TileId;
}

/** Gap between tiles (upstream `--tiles-gap`). */
const TILE_GAP_PX = 12;
/** Minimum tile sizes along either axis. */
const MIN_TILE_SIZE_PX = {chat: 320, pane: 280} as const;

const FlexSchema = z.number().positive().finite();

const TileNodeSchema = z.strictObject({
	kind: z.literal("tile"),
	tileId: TileIdSchema,
	flex: FlexSchema,
});

const StackNodeSchema: z.ZodType<StackNode> = z.strictObject({
	kind: z.literal("stack"),
	direction: DirectionSchema,
	flex: FlexSchema,
	children: z.array(z.lazy(() => LayoutNodeSchema)).min(1),
});

const LayoutNodeSchema: z.ZodType<LayoutNode> = z.union([TileNodeSchema, StackNodeSchema]);

const PaneLayoutShape = {
	root: StackNodeSchema,
	expanded: PaneKindSchema.nullable(),
	focused: TileIdSchema,
};

function checkLayout(state: PaneLayoutState, ctx: z.RefinementCtx): void {
	const ids = tileIds(state.root);
	if (new Set(ids).size !== ids.length) ctx.addIssue({code: "custom", message: "duplicate tile"});
	if (!ids.includes("chat")) ctx.addIssue({code: "custom", message: "missing chat tile"});
	if (state.expanded !== null && !ids.includes(state.expanded)) {
		ctx.addIssue({code: "custom", message: "expanded pane is not open"});
	}
	if (!ids.includes(state.focused)) {
		ctx.addIssue({code: "custom", message: "focused tile is not open"});
	}
}

export const PaneLayoutStateSchema = z.strictObject(PaneLayoutShape).superRefine(checkLayout);

/** The Changes pane scope, a formatted `SessionDiffScope` such as `branch` or `commit:<sha>`. */
const ChangesScopeSchema = z.string().refine((value) => parseDiffScope(value) !== null);

/**
 * One session's stored entry: its layout plus the Changes pane scope, the
 * Files pane's open tabs (upstream's `fileTabsBySession`) and the agent the
 * Subagent pane is focused on.
 */
const PaneLayoutEntrySchema = z
	.strictObject({
		...PaneLayoutShape,
		changesScope: ChangesScopeSchema.optional(),
		fileTabs: FileTabsStateSchema.optional(),
		subagentId: z.string().min(1).optional(),
	})
	.superRefine(checkLayout);

type PaneLayoutEntry = z.infer<typeof PaneLayoutEntrySchema>;

const DEFAULT_CHANGES_SCOPE = "branch";

const PaneLayoutStoreSchema = z.record(z.string(), PaneLayoutEntrySchema);

export const PANE_LAYOUT_STORAGE_KEY = "ccb.paneLayout.v1";

export function defaultPaneLayout(): PaneLayoutState {
	return {
		root: {kind: "stack", direction: "row", flex: 1, children: [tile("chat", 1)]},
		expanded: null,
		focused: "chat",
	};
}

function tile(tileId: TileId, flex: number): TileNode {
	return {kind: "tile", tileId, flex};
}

function round(value: number): number {
	return Math.round(value * 1e6) / 1e6;
}

function sumFlex(nodes: LayoutNode[]): number {
	return nodes.reduce((total, node) => total + node.flex, 0);
}

function tileIds(node: LayoutNode): TileId[] {
	return node.kind === "tile" ? [node.tileId] : node.children.flatMap(tileIds);
}

function isOpen(state: PaneLayoutState, tileId: TileId): boolean {
	return tileIds(state.root).includes(tileId);
}

function isChat(node: LayoutNode): boolean {
	return node.kind === "tile" && node.tileId === "chat";
}

/** Drops empty stacks, collapses single-child stacks and flattens same-direction nesting. */
function normalizeChildren(stack: StackNode): LayoutNode[] {
	const result: LayoutNode[] = [];
	for (const child of stack.children) {
		if (child.kind === "tile") {
			result.push(child);
			continue;
		}
		const inner = normalizeChildren(child);
		const [only] = inner;
		if (only === undefined) continue;
		if (inner.length === 1) {
			result.push({...only, flex: child.flex});
		} else if (child.direction === stack.direction) {
			const total = sumFlex(inner);
			result.push(...inner.map((node) => ({...node, flex: round((node.flex / total) * child.flex)})));
		} else {
			result.push({...child, children: inner});
		}
	}
	return result;
}

function normalizeRoot(root: StackNode): StackNode {
	const children = normalizeChildren(root);
	const [only] = children;
	if (children.length === 1 && only !== undefined) {
		return {...root, children: [{...only, flex: 1}]};
	}
	return {...root, children};
}

function withoutTile(stack: StackNode, tileId: TileId): StackNode {
	return {
		...stack,
		children: stack.children
			.filter((child) => child.kind !== "tile" || child.tileId !== tileId)
			.map((child) => (child.kind === "stack" ? withoutTile(child, tileId) : child)),
	};
}

function nodeAt(root: StackNode, path: readonly number[]): LayoutNode | undefined {
	let node: LayoutNode | undefined = root;
	for (const index of path) {
		if (node?.kind !== "stack") return undefined;
		node = node.children[index];
	}
	return node;
}

function replaceAt(root: StackNode, path: readonly number[], replacement: StackNode): StackNode {
	const [head, ...rest] = path;
	if (head === undefined) return replacement;
	return {
		...root,
		children: root.children.map((child, index) =>
			index === head && child.kind === "stack" ? replaceAt(child, rest, replacement) : child,
		),
	};
}

function pathTo(node: LayoutNode, tileId: TileId): number[] | undefined {
	if (node.kind === "tile") return node.tileId === tileId ? [] : undefined;
	for (const [index, child] of node.children.entries()) {
		const rest = pathTo(child, tileId);
		if (rest !== undefined) return [index, ...rest];
	}
	return undefined;
}

/** Upstream's first split: chat 2 : pane 3, so a lone pane takes about 60% of the row. */
const FIRST_SPLIT = {chat: 2, pane: 3} as const;
/** Without a measured row, Changes takes this share of what is already open. */
const CHANGES_FALLBACK_SHARE = 0.25;

function containsTile(node: LayoutNode, tileId: TileId): boolean {
	return tileIds(node).includes(tileId);
}

/** Flex that gives a new far-right Changes column its 280px minimum in a row of `rowSizePx`. */
function changesFlex(root: StackNode, rowSizePx: number | undefined): number {
	const total = sumFlex(root.children);
	const rest = (rowSizePx ?? 0) - TILE_GAP_PX * root.children.length - MIN_TILE_SIZE_PX.pane;
	if (rest < minTileSize(root, "row")) return round(total * CHANGES_FALLBACK_SHARE);
	return round((total * MIN_TILE_SIZE_PX.pane) / rest);
}

/**
 * Opens a pane the way upstream does. Changes always gets its own column at
 * the far right, sized to its minimum against `rowSizePx` (the measured row
 * width). Other panes split the row 2:3 when they are the first side pane,
 * then stack under / add columns before the Changes column, never inside it.
 */
export function openPane(state: PaneLayoutState, kind: PaneKind, rowSizePx?: number): PaneLayoutState {
	if (isOpen(state, kind)) return focusPane(state, kind);
	const children = [...state.root.children];
	if (kind === "changes") {
		children.push(tile(kind, changesFlex(state.root, rowSizePx)));
		return {root: {...state.root, children}, expanded: null, focused: kind};
	}
	const isSide = (child: LayoutNode): boolean => !isChat(child) && !containsTile(child, "changes");
	const lastSide = children.reduce((last, child, index) => (isSide(child) ? index : last), -1);
	const lastNode = children[lastSide];
	if (lastNode === undefined) {
		const chatIndex = children.findIndex(isChat);
		const chat = children[chatIndex];
		if (chat === undefined) return state;
		const scale = (FIRST_SPLIT.chat + FIRST_SPLIT.pane) / chat.flex;
		const scaled = children.map((child) => ({...child, flex: round(child.flex * scale)}));
		scaled.splice(chatIndex, 1, {...chat, flex: FIRST_SPLIT.chat}, tile(kind, FIRST_SPLIT.pane));
		return {root: {...state.root, children: scaled}, expanded: null, focused: kind};
	}
	if (lastNode.kind === "tile") {
		children[lastSide] = {
			kind: "stack",
			direction: "column",
			flex: lastNode.flex,
			children: [{...lastNode, flex: 1}, tile(kind, 1)],
		};
	} else {
		children.splice(lastSide + 1, 0, tile(kind, 1));
	}
	return {root: normalizeRoot({...state.root, children}), expanded: null, focused: kind};
}

export function closePane(state: PaneLayoutState, kind: PaneKind): PaneLayoutState {
	if (!isOpen(state, kind)) return state;
	return {
		root: normalizeRoot(withoutTile(state.root, kind)),
		expanded: state.expanded === kind ? null : state.expanded,
		focused: state.focused === kind ? "chat" : state.focused,
	};
}

export function focusPane(state: PaneLayoutState, tileId: TileId): PaneLayoutState {
	if (state.focused === tileId || !isOpen(state, tileId)) return state;
	return {...state, focused: tileId};
}

export function expandPane(state: PaneLayoutState, kind: PaneKind): PaneLayoutState {
	if (!isOpen(state, kind)) return state;
	return {...state, expanded: kind, focused: kind};
}

export function collapsePane(state: PaneLayoutState): PaneLayoutState {
	return state.expanded === null ? state : {...state, expanded: null};
}

/** Minimum size of a node along `axis`: sums along a stack's own axis, maxes across it. */
export function minTileSize(node: LayoutNode, axis: Direction): number {
	if (node.kind === "tile") {
		return node.tileId === "chat" ? MIN_TILE_SIZE_PX.chat : MIN_TILE_SIZE_PX.pane;
	}
	const sizes = node.children.map((child) => minTileSize(child, axis));
	return node.direction === axis
		? sizes.reduce((total, size) => total + size, 0) + TILE_GAP_PX * (sizes.length - 1)
		: Math.max(...sizes);
}

export interface ResizeRequest {
	/** Child indices from the root to the stack that owns the divider. */
	path: readonly number[];
	/** The divider sits between `children[index]` and `children[index + 1]`. */
	index: number;
	deltaPx: number;
	/** The stack's measured size along its direction, gaps included. */
	sizePx: number;
}

export function resizeDivider(state: PaneLayoutState, request: ResizeRequest): PaneLayoutState {
	const stack = nodeAt(state.root, request.path);
	if (stack?.kind !== "stack") return state;
	const before = stack.children[request.index];
	const after = stack.children[request.index + 1];
	if (before === undefined || after === undefined) return state;

	const available = request.sizePx - TILE_GAP_PX * (stack.children.length - 1);
	const total = sumFlex(stack.children);
	const pairPx = ((before.flex + after.flex) / total) * available;
	const beforePx = (before.flex / total) * available;
	const maxBefore = pairPx - minTileSize(after, stack.direction);
	const nextBefore = Math.max(minTileSize(before, stack.direction), Math.min(beforePx + request.deltaPx, maxBefore));
	const toFlex = (px: number): number => round((px / available) * total);

	const children = [...stack.children];
	children[request.index] = {...before, flex: toFlex(nextBefore)};
	children[request.index + 1] = {...after, flex: toFlex(pairPx - nextBefore)};
	return {...state, root: replaceAt(state.root, request.path, {...stack, children})};
}

/** Where a split move will land: the half (`side`) of the node at `path` is outlined before Enter commits it. */
export interface MovePreview {
	path: number[];
	side: MoveDirection;
}

type MovePlan =
	| {kind: "swap"; ancestorPath: number[]; ancestor: StackNode; branchIndex: number; target: number}
	| {kind: "pop"; ancestorPath: number[]; ancestor: StackNode; branchIndex: number}
	| {kind: "split"; parentPath: number[]; parent: StackNode; index: number; neighbourIndex: number};

function axisOf(direction: MoveDirection): Direction {
	return direction === "left" || direction === "right" ? "row" : "column";
}

function stepOf(direction: MoveDirection): -1 | 1 {
	return direction === "left" || direction === "top" ? -1 : 1;
}

function planMove(state: PaneLayoutState, tileId: TileId, direction: MoveDirection): MovePlan | null {
	const path = pathTo(state.root, tileId);
	if (path === undefined) return null;
	const axis = axisOf(direction);
	const step = stepOf(direction);

	const isAxisStack = (node: LayoutNode | undefined): node is StackNode =>
		node?.kind === "stack" && node.direction === axis;
	let depth = path.length - 1;
	while (depth >= 0 && !isAxisStack(nodeAt(state.root, path.slice(0, depth)))) depth -= 1;
	const ancestorPath = path.slice(0, depth);
	const ancestor = nodeAt(state.root, ancestorPath);
	const branchIndex = path[depth];
	if (isAxisStack(ancestor) && branchIndex !== undefined) {
		if (ancestor.children[branchIndex]?.kind === "stack") return {kind: "pop", ancestorPath, ancestor, branchIndex};
		const target = branchIndex + step;
		if (target < 0 || target >= ancestor.children.length) return null;
		return {kind: "swap", ancestorPath, ancestor, branchIndex, target};
	}

	const parentPath = path.slice(0, -1);
	const parent = nodeAt(state.root, parentPath);
	const index = path.at(-1);
	if (parent?.kind !== "stack" || index === undefined) return null;
	const neighbourIndex = index > 0 ? index - 1 : index + 1;
	if (parent.children[neighbourIndex] === undefined) return null;
	return {kind: "split", parentPath, parent, index, neighbourIndex};
}

/**
 * The outline to show before a move across the tile's stack, or null when the
 * move goes straight through (a swap along the stack) or would do nothing.
 */
export function movePreview(state: PaneLayoutState, tileId: TileId, direction: MoveDirection): MovePreview | null {
	const plan = planMove(state, tileId, direction);
	if (plan === null || plan.kind === "swap") return null;
	if (plan.kind === "pop") return {path: [...plan.ancestorPath, plan.branchIndex], side: direction};
	return {path: [...plan.parentPath, plan.neighbourIndex], side: direction};
}

/**
 * Moves a tile one step. Along its parent stack's axis it swaps with the
 * neighbour; across it, the tile pops out of its column into the nearest
 * ancestor on that axis, taking its share of the column's flex. With no such
 * ancestor it splits its neighbour's slot in half along that axis.
 */
export function movePane(state: PaneLayoutState, tileId: TileId, direction: MoveDirection): PaneLayoutState {
	const plan = planMove(state, tileId, direction);
	if (plan === null) return state;
	const step = stepOf(direction);

	if (plan.kind === "split") {
		const children = [...plan.parent.children];
		const moved = children[plan.index];
		const neighbour = children[plan.neighbourIndex];
		if (moved === undefined || neighbour === undefined) return state;
		const pair = step < 0 ? [moved, neighbour] : [neighbour, moved];
		const split: StackNode = {
			kind: "stack",
			direction: axisOf(direction),
			flex: round(moved.flex + neighbour.flex),
			children: pair.map((node) => ({...node, flex: 1})),
		};
		children.splice(Math.min(plan.index, plan.neighbourIndex), 2, split);
		const root = normalizeRoot(replaceAt(state.root, plan.parentPath, {...plan.parent, children}));
		return {...state, root, focused: tileId};
	}

	const children = [...plan.ancestor.children];
	const branch = children[plan.branchIndex];
	if (branch === undefined) return state;
	if (plan.kind === "swap") {
		const neighbour = children[plan.target];
		if (neighbour === undefined) return state;
		children[plan.branchIndex] = neighbour;
		children[plan.target] = branch;
	} else {
		if (branch.kind !== "stack") return state;
		const moved = branch.children.find((child) => child.kind === "tile" && child.tileId === tileId);
		if (moved === undefined) return state;
		const share = round((branch.flex * moved.flex) / sumFlex(branch.children));
		const remaining = withoutTile(branch, tileId);
		children[plan.branchIndex] = {...remaining, flex: round(branch.flex - share)};
		children.splice(step < 0 ? plan.branchIndex : plan.branchIndex + 1, 0, {...moved, flex: share});
	}
	const root = normalizeRoot(replaceAt(state.root, plan.ancestorPath, {...plan.ancestor, children}));
	return {...state, root, focused: tileId};
}

function browserStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function readStore(storage: Storage): Record<string, PaneLayoutEntry> | undefined {
	const raw = storage.getItem(PANE_LAYOUT_STORAGE_KEY);
	if (raw === null) return {};
	try {
		const parsed = PaneLayoutStoreSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

function writeEntry(
	sessionId: string,
	storage: Storage,
	update: (entry: PaneLayoutEntry | undefined) => PaneLayoutEntry,
): void {
	const store = readStore(storage) ?? {};
	storage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify({...store, [sessionId]: update(store[sessionId])}));
}

export function loadPaneLayout(sessionId: string, storage: Storage | null = browserStorage()): PaneLayoutState {
	try {
		const entry = storage ? readStore(storage)?.[sessionId] : undefined;
		if (entry === undefined) return defaultPaneLayout();
		return {root: entry.root, expanded: entry.expanded, focused: entry.focused};
	} catch {
		// localStorage can be denied even when window exists; layout persistence is best-effort.
		return defaultPaneLayout();
	}
}

export function savePaneLayout(
	sessionId: string,
	state: PaneLayoutState,
	storage: Storage | null = browserStorage(),
): void {
	if (!storage) return;
	try {
		writeEntry(sessionId, storage, (entry) => {
			const next: PaneLayoutEntry = {...state};
			if (entry?.changesScope !== undefined) next.changesScope = entry.changesScope;
			// Closing the Files pane discards the session's tabs, as upstream does.
			if (entry?.fileTabs !== undefined && isOpen(state, "files")) next.fileTabs = entry.fileTabs;
			if (entry?.subagentId !== undefined && isOpen(state, "subagents")) next.subagentId = entry.subagentId;
			return next;
		});
	} catch {
		// localStorage can be denied even when window exists; layout persistence is best-effort.
	}
}

export function loadChangesScope(sessionId: string, storage: Storage | null = browserStorage()): string {
	try {
		return (storage && readStore(storage)?.[sessionId]?.changesScope) ?? DEFAULT_CHANGES_SCOPE;
	} catch {
		return DEFAULT_CHANGES_SCOPE;
	}
}

export function saveChangesScope(sessionId: string, scope: string, storage: Storage | null = browserStorage()): void {
	if (!storage) return;
	try {
		writeEntry(sessionId, storage, (entry) => ({
			...(entry ?? defaultPaneLayout()),
			changesScope: scope,
		}));
	} catch {
		// localStorage can be denied even when window exists; scope persistence is best-effort.
	}
}

export function loadFileTabs(sessionId: string, storage: Storage | null = browserStorage()): FileTabsState {
	try {
		return (storage && readStore(storage)?.[sessionId]?.fileTabs) ?? EMPTY_FILE_TABS;
	} catch {
		return EMPTY_FILE_TABS;
	}
}

export function saveFileTabs(
	sessionId: string,
	fileTabs: FileTabsState,
	storage: Storage | null = browserStorage(),
): void {
	if (!storage) return;
	try {
		writeEntry(sessionId, storage, (entry) => ({
			...(entry ?? defaultPaneLayout()),
			fileTabs,
		}));
	} catch {
		// localStorage can be denied even when window exists; tab persistence is best-effort.
	}
}

/** The agent the Subagent pane shows, or null for its subagents list. */
export function loadSubagentPaneAgent(sessionId: string, storage: Storage | null = browserStorage()): string | null {
	try {
		return (storage && readStore(storage)?.[sessionId]?.subagentId) ?? null;
	} catch {
		return null;
	}
}

export function saveSubagentPaneAgent(
	sessionId: string,
	agentId: string | null,
	storage: Storage | null = browserStorage(),
): void {
	if (!storage) return;
	try {
		writeEntry(sessionId, storage, (entry) => {
			const next: PaneLayoutEntry = {...(entry ?? defaultPaneLayout())};
			if (agentId === null) delete next.subagentId;
			else next.subagentId = agentId;
			return next;
		});
	} catch {
		// localStorage can be denied even when window exists; focus persistence is best-effort.
	}
}
