import {z} from "zod";

import {parseDiffScope} from "./api/session-diff";
import {EMPTY_FILE_TABS, type FileTabsState, FileTabsStateSchema} from "./file-tabs";
import type {WideTitleRowVariant} from "./wide-title-row";

/**
 * Pure layout engine for the session tiling pane host, modelled on
 * claude.ai/code's tile tree. The root is always a row stack holding the chat
 * tile; side panes are placed the way upstream places them: the 1st splits the
 * row chat 2 : pane 3 for a wide pane (Files, Changes, Artifacts) and 2:1 for
 * the rest, the 2nd stacks under the side column and the 3rd opens a new
 * column, Changes included (checked live at desktop width, 2026-10-30).
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

/** A `data-tile-slot` value read back from the DOM, or null when it names no tile. */
export function parseTileId(value: unknown): TileId | null
{
	const parsed = TileIdSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export interface TileNode
{
	kind: "tile";
	tileId: TileId;
	flex: number;
}

export interface StackNode
{
	kind: "stack";
	direction: Direction;
	flex: number;
	children: LayoutNode[];
}

export type LayoutNode = TileNode | StackNode;

/**
 * Where a closed pane sat, upstream's `closedPaneSlotsBySession` entry: the
 * tiles of the sibling it sat beside (`anchorIds`), the tiles after it in a
 * row (`otherSideIds`), its parent stack's direction, whether it came before
 * (0) or after (1) the anchor, and its flex over the siblings' total.
 */
export type ClosedPaneSlot = z.infer<typeof ClosedPaneSlotSchema>;

type ClosedPaneSlots = z.infer<typeof ClosedPaneSlotsSchema>;

export interface PaneLayoutState
{
	root: StackNode;
	expanded: PaneKind | null;
	focused: TileId;
	/** Present only while some closed pane has a slot to reopen into. */
	closedSlots?: ClosedPaneSlots;
	/** Upstream `overlayTile`: an unprompted open drawn over the lone chat until it settles. Never persisted. */
	overlay?: PaneOverlay;
}

/**
 * Upstream c03935b01 `overlayTile`: the pane an unprompted open drew over the chat, the layout it was drawn for
 * (any other layout means it settled), and the flex the settled split gives it so the pane keeps its width.
 */
export interface PaneOverlay
{
	tileId: PaneKind;
	root: StackNode;
	openedAt: number;
	paneFlex?: number;
}

/** Upstream's open options: `{unprompted: true}` may overlay; `arrival` (re-showing a pane) never does. */
export interface OpenPaneOptions
{
	unprompted?: boolean;
	arrival?: boolean;
}

/** Gap between tiles (upstream `--tiles-gap`). */
const TILE_GAP_PX = 12;
/** Minimum tile sizes along either axis. */
const MIN_TILE_SIZE_PX =
{
	chat: 320,
	pane: 280,
} as const;
/** Upstream ca67f2c9d `pU(true)`, the line-mode tiles config: `gap`, `minTileBasePx`, `minTileWidthPx`. */
const LINE_TILE_GAP_PX = 1;
const MIN_TILE_BASE_PX = 100;
const MIN_TILE_WIDTH_PX = 280;
/** Upstream cc43287c9's chat tile `overflowMin.width`: its shell keeps this width and slides under a neighbour. */
export const CHAT_OVERFLOW_MIN_PX = 320;

const FlexSchema = z.number().positive();

const TileNodeSchema = z.strictObject(
	{
		kind: z.literal("tile"),
		tileId: TileIdSchema,
		flex: FlexSchema,
	},
);

const StackNodeSchema: z.ZodType<StackNode> = z.strictObject(
	{
		kind: z.literal("stack"),
		direction: DirectionSchema,
		flex: FlexSchema,
		children: z.array(z.lazy(() => LayoutNodeSchema)).min(1),
	},
);

const LayoutNodeSchema: z.ZodType<LayoutNode> = z.union([TileNodeSchema, StackNodeSchema]);

/** Upstream's accepted slot ratio range. */
const SLOT_RATIO_RANGE = [0.001, 1000] as const;

const ClosedPaneSlotSchema = z.strictObject(
	{
		anchorIds: z.array(TileIdSchema),
		otherSideIds: z.array(TileIdSchema),
		direction: DirectionSchema,
		side: z.union([z.literal(0), z.literal(1)]),
		ratio: z.number().min(SLOT_RATIO_RANGE[0]).max(SLOT_RATIO_RANGE[1]),
	},
);

const ClosedPaneSlotsSchema = z.partialRecord(PaneKindSchema, ClosedPaneSlotSchema);

const PaneLayoutShape =
{
	root: StackNodeSchema,
	expanded: PaneKindSchema.nullable(),
	focused: TileIdSchema,
	closedSlots: ClosedPaneSlotsSchema.optional(),
};

function checkLayout(state: Pick<PaneLayoutState, "root" | "expanded" | "focused">, ctx: z.RefinementCtx): void
{
	const ids = tileIds(state.root);
	if (new Set(ids).size !== ids.length)
		ctx.addIssue(
			{
				code: "custom",
				message: "duplicate tile",
			},
		);
	if (!ids.includes("chat"))
		ctx.addIssue(
			{
				code: "custom",
				message: "missing chat tile",
			},
		);
	if (state.expanded !== null && !ids.includes(state.expanded))
	{
		ctx.addIssue(
			{
				code: "custom",
				message: "expanded pane is not open",
			},
		);
	}
	if (!ids.includes(state.focused))
	{
		ctx.addIssue(
			{
				code: "custom",
				message: "focused tile is not open",
			},
		);
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
	.strictObject(
		{
			...PaneLayoutShape,
			changesScope: ChangesScopeSchema.optional(),
			fileTabs: FileTabsStateSchema.optional(),
			subagentId: z.string().min(1).optional(),
		},
	)
	.superRefine(checkLayout);

type PaneLayoutEntry = z.infer<typeof PaneLayoutEntrySchema>;

const DEFAULT_CHANGES_SCOPE = "branch";

const PaneLayoutStoreSchema = z.record(z.string(), PaneLayoutEntrySchema);

export interface ChatGutters
{
	start: "shave" | undefined;
	end: "bleed" | "shave" | undefined;
}

/** Upstream cf53e1812 `ne`: the top-right tile (row → last child, column → first child). */
function topRightTile(node: LayoutNode): TileId
{
	if (node.kind === "tile") return node.tileId;
	const child = node.direction === "row" ? node.children.at(-1) : node.children[0];
	return child === undefined ? "chat" : topRightTile(child);
}

/**
 * Upstream cf53e1812 `Q` (side "start": row → first child) and `Z` (side
 * "end": row → last child); a column puts every child on both edges.
 */
function edgeTiles(node: LayoutNode, side: "start" | "end", into = new Set<TileId>()): Set<TileId>
{
	if (node.kind === "tile") return into.add(node.tileId);
	const children =
		node.direction === "column" ? node.children : [side === "start" ? node.children[0] : node.children.at(-1)];
	for (const child of children) if (child !== undefined) edgeTiles(child, side, into);
	return into;
}

/** Upstream cc43287c9 `HD`/`UD`: the tiles touching the left edge (row → first child, column → every child). */
export function leftEdgeTiles(root: StackNode): Set<TileId>
{
	return edgeTiles(root, "start");
}

/**
 * Upstream cf53e1812 `ie` (`QD`): the tiles on the layout's right edge that are not also on its left
 * edge. "Automatic" puts a pane's file column on the right in these tiles.
 */
export function rowEndOnlyTileIds(root: StackNode): Set<TileId>
{
	const start = edgeTiles(root, "start");
	return new Set([...edgeTiles(root, "end")].filter((tileId) => !start.has(tileId)));
}

/** Upstream cf53e1812 `ae`: the tiles on the layout's top edge (row → every child, column → first child). */
export function topEdgeTiles(root: StackNode): Set<TileId>
{
	const into = new Set<TileId>();
	const walk = (node: LayoutNode) =>
	{
		if (node.kind === "tile")
		{
			into.add(node.tileId);
			return;
		}
		const children = node.direction === "row" ? node.children : node.children.slice(0, 1);
		for (const child of children) walk(child);
	};
	walk(root);
	return into;
}

/**
 * Upstream shared-20 `it`'s `top`: while the header is lifted into the wide title row, every pane on the top edge is
 * padded down by the row's height; the chat keeps its own spacer instead.
 */
export function wideRowTopPadding(
	tileId: TileId,
	root: StackNode,
	under: WideTitleRowVariant | null,
): string | undefined
{
	return under !== null && tileId !== "chat" && topEdgeTiles(root).has(tileId)
		? "var(--wide-title-row-h)"
		: undefined;
}

/**
 * The chat's gutter attributes, from upstream cc43287c9:
 * `mt = Q(tree).has("chat") ? undefined : "shave"` and
 * `ht = ne(tree) === "chat" ? "bleed" : Z(tree).has("chat") ? undefined : "shave"`.
 */
export function chatGutters(root: StackNode): ChatGutters
{
	return {
		start: edgeTiles(root, "start").has("chat") ? undefined : "shave",
		end: topRightTile(root) === "chat" ? "bleed" : edgeTiles(root, "end").has("chat") ? undefined : "shave",
	};
}

/**
 * The chat tile shell's padding, upstream shared-20 `it(end, 8, start, "chat", rtl)`:
 * 8px at the bottom always, 8px on a side the chat touches without a gutter attribute.
 */
export function chatShellPadding(gutters: ChatGutters, rtl = false): string
{
	const end = gutters.end === undefined ? 8 : 0;
	const start = gutters.start === undefined ? 8 : 0;
	return `0px ${rtl ? start : end}px 8px ${rtl ? end : start}px`;
}

export const PANE_LAYOUT_STORAGE_KEY = "ccb.paneLayout.v1";

export function defaultPaneLayout(): PaneLayoutState
{
	return {
		root:
		{
			kind: "stack",
			direction: "row",
			flex: 1,
			children: [tile("chat", 1)],
		},
		expanded: null,
		focused: "chat",
	};
}

function tile(tileId: TileId, flex: number): TileNode
{
	return {
		kind: "tile",
		tileId,
		flex,
	};
}

function round(value: number): number
{
	return Math.round(value * 1e6) / 1e6;
}

function sumFlex(nodes: LayoutNode[]): number
{
	return nodes.reduce((total, node) => total + node.flex, 0);
}

function tileIds(node: LayoutNode): TileId[]
{
	return node.kind === "tile" ? [node.tileId] : node.children.flatMap(tileIds);
}

/**
 * Upstream cc43287c9 `q9` (`file` → files, `diff` → changes): tiles kept mounted,
 * hidden, while another tile is expanded; every other tile unmounts. The tabbed
 * side panel's `Y9` extras (plan, tasks, preview) wait for side-panel-tabbed-mode.
 */
export const TILES_KEPT_WHILE_EXPANDED: ReadonlySet<TileId> = new Set<TileId>(["chat", "files", "terminal", "changes"]);

/** Upstream cc43287c9 `hiddenTileIds`: the kept tiles other than the expanded one. */
export function hiddenWhileExpanded(root: StackNode, expanded: PaneKind | null): ReadonlySet<TileId>
{
	if (expanded === null) return new Set();
	return new Set(tileIds(root).filter((id) => id !== expanded && TILES_KEPT_WHILE_EXPANDED.has(id)));
}

/** Upstream cf53e1812 `z`: a tile is hidden when in `hidden` or unmounted; a stack when every child is. */
export function isNodeHidden(node: LayoutNode, hidden: ReadonlySet<TileId>, mounted: (id: TileId) => boolean): boolean
{
	if (node.kind === "tile") return hidden.has(node.tileId) || !mounted(node.tileId);
	return node.children.every((child) => isNodeHidden(child, hidden, mounted));
}

/** The line-mode shell edge attributes upstream ca67f2c9d `wt` sets on `.tiles-shell`. */
export interface TileShellEdges
{
	/** Not at the left edge (upstream `data-after-line-x`). */
	afterLineX: boolean;
	/** Not at the top edge (`data-after-line-y`). */
	afterLineY: boolean;
	/** After-line-x with a divider on its left (`data-strip-over-start`). */
	stripOverStart: boolean;
	/** A divider below it (`data-strip-over-foot`). */
	stripOverFoot: boolean;
	/** A divider on its right (`data-strip-over-end`). */
	stripOverEnd: boolean;
}

interface EdgeHandles
{
	left: boolean;
	right: boolean;
	top: boolean;
	bottom: boolean;
}

/**
 * Upstream `wt`'s `atEdge`/`edgeHandles` for every tile of an all-in-flow layout: a child inherits its stack's
 * handles on the sides it shares with the stack, and gets the divider between it and a sibling on the others. Every
 * in-flow sibling boundary holds a divider, so a tile is off an edge exactly when a divider sits on that side.
 */
export function tileShellEdges(root: StackNode): Map<TileId, TileShellEdges>
{
	const edges = new Map<TileId, TileShellEdges>();
	const walk = (node: LayoutNode, handles: EdgeHandles) =>
	{
		if (node.kind === "tile")
		{
			edges.set(
				node.tileId,
				{
					afterLineX: handles.left,
					afterLineY: handles.top,
					stripOverStart: handles.left,
					stripOverFoot: handles.bottom,
					stripOverEnd: handles.right,
				},
			);
			return;
		}
		const last = node.children.length - 1;
		node.children.forEach((child, index) =>
		{
			walk(
				child,
				node.direction === "row"
					?
						{
							...handles,
							left: index > 0 || handles.left,
							right: index < last || handles.right,
						}
					:
						{
							...handles,
							top: index > 0 || handles.top,
							bottom: index < last || handles.bottom,
						},
			);
		});
	};
	walk(
		root,
		{
			left: false,
			right: false,
			top: false,
			bottom: false,
		},
	);
	return edges;
}

function isOpen(state: PaneLayoutState, tileId: TileId): boolean
{
	return tileIds(state.root).includes(tileId);
}

function isChat(node: LayoutNode): boolean
{
	return node.kind === "tile" && node.tileId === "chat";
}

/** Drops empty stacks, collapses single-child stacks and flattens same-direction nesting. */
function normalizeChildren(stack: StackNode): LayoutNode[]
{
	const result: LayoutNode[] = [];
	for (const child of stack.children)
	{
		if (child.kind === "tile")
		{
			result.push(child);
			continue;
		}
		const inner = normalizeChildren(child);
		const [only] = inner;
		if (only === undefined) continue;
		if (inner.length === 1)
		{
			result.push(
				{
					...only,
					flex: child.flex,
				},
			);
		}
		else if (child.direction === stack.direction)
		{
			const total = sumFlex(inner);
			result.push(
				...inner.map((node) => (
				{
					...node,
					flex: round((node.flex / total) * child.flex),
				})),
			);
		}
		else
		{
			result.push(
				{
					...child,
					children: inner,
				},
			);
		}
	}
	return result;
}

function normalizeRoot(root: StackNode): StackNode
{
	const children = normalizeChildren(root);
	const [only] = children;
	if (children.length === 1 && only !== undefined)
	{
		return {
			...root,
			children: [
				{
					...only,
					flex: 1,
				},
			],
		};
	}
	return {
		...root,
		children,
	};
}

function withoutTile(stack: StackNode, tileId: TileId): StackNode
{
	return {
		...stack,
		children: stack.children
			.filter((child) => child.kind !== "tile" || child.tileId !== tileId)
			.map((child) => (child.kind === "stack" ? withoutTile(child, tileId) : child)),
	};
}

function nodeAt(root: StackNode, path: readonly number[]): LayoutNode | undefined
{
	let node: LayoutNode | undefined = root;
	for (const index of path)
	{
		if (node?.kind !== "stack") return undefined;
		node = node.children[index];
	}
	return node;
}

function replaceAt(root: StackNode, path: readonly number[], replacement: StackNode): StackNode
{
	const [head, ...rest] = path;
	if (head === undefined) return replacement;
	return {
		...root,
		children: root.children.map((child, index) =>
			index === head && child.kind === "stack" ? replaceAt(child, rest, replacement) : child,
		),
	};
}

function pathTo(node: LayoutNode, tileId: TileId): number[] | undefined
{
	if (node.kind === "tile") return node.tileId === tileId ? [] : undefined;
	for (const [index, child] of node.children.entries())
	{
		const rest = pathTo(child, tileId);
		if (rest !== undefined) return [index, ...rest];
	}
	return undefined;
}

function withClosedSlots(state: PaneLayoutState, slots: ClosedPaneSlots): PaneLayoutState
{
	const {closedSlots: _previous, ...rest} = state;
	return Object.keys(slots).length === 0
		? rest
		:
			{
				...rest,
				closedSlots: slots,
			};
}

function withoutSlot(slots: ClosedPaneSlots | undefined, kind: PaneKind): ClosedPaneSlots
{
	const {[kind]: _closed, ...rest} = slots ?? {};
	return rest;
}

/** Upstream's slot capture: the closing tile's sibling, side and share of its parent stack. */
function captureSlot(root: StackNode, kind: PaneKind): ClosedPaneSlot | null
{
	const path = pathTo(root, kind);
	const index = path?.at(-1);
	const parent = path === undefined ? undefined : nodeAt(root, path.slice(0, -1));
	if (parent?.kind !== "stack" || index === undefined || parent.children.length < 2) return null;
	const side = index > 0 ? 1 : 0;
	const anchor = parent.children[side === 1 ? index - 1 : index + 1];
	const own = parent.children[index];
	if (anchor === undefined || own === undefined) return null;
	const after = side === 1 ? parent.children[index + 1] : undefined;
	const rest = sumFlex(parent.children) - own.flex;
	return {
		anchorIds: tileIds(anchor),
		otherSideIds: after === undefined ? [] : tileIds(after),
		direction: parent.direction,
		side,
		ratio: own.flex > 0 && rest > 0 ? own.flex / rest : 1,
	};
}

function commonPrefix(a: readonly number[], b: readonly number[]): number[]
{
	let length = 0;
	while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
	return a.slice(0, length);
}

/**
 * Upstream's slot restore: puts the pane back beside the smallest node holding
 * the surviving anchors, on its old side and at its old ratio. Returns null
 * when no anchor survives, or when a row slot's far neighbour has changed.
 */
function restoreSlot(state: PaneLayoutState, kind: PaneKind, slot: ClosedPaneSlot): StackNode | null
{
	const root = structuredClone(state.root);
	const present = new Set<TileId>();
	let commonPath: number[] | null = null;
	for (const id of slot.anchorIds)
	{
		const path = pathTo(root, id);
		if (path === undefined) continue;
		present.add(id);
		commonPath = commonPath === null ? path : commonPrefix(commonPath, path);
	}
	if (commonPath === null) return null;
	let node = nodeAt(root, commonPath);
	if (node === undefined) return null;
	if (node.kind === "stack")
	{
		// Anchors that are a contiguous run of this stack's children get their own sub-stack to sit beside.
		const cover = node.children.map((child) =>
		{
			const ids = tileIds(child);
			const count = ids.filter((id) => present.has(id)).length;
			return count === 0 ? "none" : count === ids.length ? "all" : "some";
		});
		const first = cover.indexOf("all");
		const last = cover.lastIndexOf("all");
		if (
			first >= 0 &&
			!cover.includes("some") &&
			cover.includes("none") &&
			cover.slice(first, last + 1).every((entry) => entry === "all")
		)
		{
			const group = node.children.splice(first, last - first + 1);
			const grouped: StackNode =
			{
				kind: "stack",
				direction: node.direction,
				flex: sumFlex(group),
				children: group,
			};
			node.children.splice(first, 0, grouped);
			commonPath = [...commonPath, first];
			node = grouped;
		}
	}
	const index = commonPath.at(-1);
	const parent = index === undefined ? undefined : nodeAt(root, commonPath.slice(0, -1));
	const parentStack = parent?.kind === "stack" ? parent : null;
	const target =
		parentStack?.direction === slot.direction
			? parentStack
			: node.kind === "stack" && node.direction === slot.direction
				? node
				: null;
	if (target !== null)
	{
		const flex = round(slot.ratio * sumFlex(target.children));
		if (!Number.isFinite(flex) || flex <= 0) return null;
		const at =
			target === parentStack && index !== undefined ? index + slot.side : slot.side * target.children.length;
		const beyond =
			target === parentStack && slot.direction === "row"
				? target.children[slot.side === 1 ? at : at - 1]
				: undefined;
		if (beyond !== undefined && !tileIds(beyond).some((id) => slot.otherSideIds.includes(id))) return null;
		target.children.splice(at, 0, tile(kind, flex));
		return normalizeRoot(root);
	}
	const pane = tile(kind, slot.ratio);
	const anchor =
	{
		...node,
		flex: 1,
	};
	const wrapped: StackNode =
	{
		kind: "stack",
		direction: slot.direction,
		flex: node.flex,
		children: slot.side === 0 ? [pane, anchor] : [anchor, pane],
	};
	if (parentStack === null || index === undefined)
	{
		return normalizeRoot(
			{
				kind: "stack",
				direction: "row",
				flex: 1,
				children: [wrapped],
			},
		);
	}
	parentStack.children[index] = wrapped;
	return normalizeRoot(root);
}

/** Upstream's first split: chat 2 : pane 3, so a lone wide pane takes about 60% of the row. */
const FIRST_SPLIT =
{
	chat: 2,
	pane: 3,
} as const;
/** A lone narrow pane's first split, chat 2 : pane 1 (about 33% of the row). */
const NARROW_PANE_FLEX = 1;
/** Upstream's wide kinds (`fs`: diff, file, artifact, preview…), the ones whose first split is 2:3. */
const WIDE_PANE_KINDS: ReadonlySet<PaneKind> = new Set<PaneKind>(["files", "changes", "artifacts"]);

/** Upstream's `lastPaneFlexByKind`: a lone pane's flex beside chat 2, remembered per kind from resizes. */
export type LastPaneFlex = Partial<Record<PaneKind, number>>;

/** A user-initiated open's measured tile root width, for upstream's `fitOpenedLayout`. */
export interface OpenFit
{
	widthPx: number;
}

/**
 * Opens a pane the way upstream does: back in the slot it was closed from
 * while that slot's anchor survives, otherwise the first side pane splits the
 * row (at its remembered flex, else 2:3 wide or 2:1 narrow) and every later
 * one, Changes included, stacks under the root row's last pane, or opens a new
 * column when that last child is a column or the chat itself. With `fit` the
 * result makes room for the chat (`fitOpenedLayout`), root row only after a
 * slot restore.
 */
export function openPane(
	state: PaneLayoutState,
	kind: PaneKind,
	lastFlex: LastPaneFlex = {},
	fit?: OpenFit,
	options: OpenPaneOptions = {},
): PaneLayoutState
{
	if (isOpen(state, kind))
	{
		// Upstream `Tu` → `G` (c03935b01): re-opening a pane hidden behind another's expansion collapses it first.
		const shown = state.expanded !== null && state.expanded !== kind ? collapsePane(state) : state;
		return focusPane(shown, kind);
	}
	const overlay = opensAsOverlay(state, options);
	// Upstream `eu` opens from `Zl`: a drawn overlay's synced flex carries into the next layout.
	const base = withOverlayFlex(state);
	const slot = base.closedSlots?.[kind];
	const restored = slot ? restoreSlot(base, kind, slot) : null;
	const placed = restored ?? stackPane(base.root, kind, lastFlex);
	if (placed === null) return state;
	const root = fit === undefined ? placed : fitOpenedLayout(placed, fit.widthPx, restored !== null);
	const next = withClosedSlots(
		{
			root,
			expanded: null,
			// Upstream skips the focus move (`jl`) for an overlay and for any unprompted open.
			focused: options.unprompted === true ? base.focused : kind,
		},
		withoutSlot(base.closedSlots, kind),
	);
	if (!overlay) return next;
	lastOverlayOpenedAt = Math.max(Date.now(), lastOverlayOpenedAt + 1);
	return {
		...next,
		overlay:
		{
			tileId: kind,
			root,
			openedAt: lastOverlayOpenedAt,
		},
	};
}

/** Upstream `$l`: overlay open stamps stay strictly increasing. */
let lastOverlayOpenedAt = 0;

/** Upstream cf53e1812 `ue`: only an unprompted open (not an arrival) beside a lone chat draws an overlay. */
function opensAsOverlay(state: PaneLayoutState, options: OpenPaneOptions): boolean
{
	if (options.unprompted !== true || options.arrival === true) return false;
	const ids = tileIds(state.root);
	return ids.length === 1 && ids[0] === "chat";
}

/** Upstream `ql`: the overlaid pane while its layout is current and nothing is expanded. */
export function overlayTile(state: PaneLayoutState): PaneKind | null
{
	const {overlay} = state;
	return overlay !== undefined && overlay.root === state.root && state.expanded === null ? overlay.tileId : null;
}

/** Upstream `Zl`: the layout with a drawn overlay's synced flex written into its tile. */
function withOverlayFlex(state: PaneLayoutState): PaneLayoutState
{
	const tileId = overlayTile(state);
	const paneFlex = state.overlay?.paneFlex;
	if (tileId === null || paneFlex === undefined) return state;
	return {
		...state,
		root:
		{
			...state.root,
			children: state.root.children.map((child) =>
				child.kind === "tile" && child.tileId === tileId
					?
						{
							...child,
							flex: paneFlex,
						}
					: child,
			),
		},
	};
}

function withoutOverlay(state: PaneLayoutState): PaneLayoutState
{
	if (state.overlay === undefined) return state;
	const {overlay: _overlay, ...rest} = state;
	return rest;
}

/** Upstream `settleOverlayTile` (`G`): the overlay becomes a real split at its synced flex. */
export function settleOverlay(state: PaneLayoutState): PaneLayoutState
{
	return withoutOverlay(withOverlayFlex(state));
}

/** Upstream `syncOverlayPaneFlex`: the flex the settled split gives the overlaid pane, so it keeps its drawn width. */
export function syncOverlayPaneFlex(state: PaneLayoutState, kind: PaneKind, paneFlex: number): PaneLayoutState
{
	const {overlay} = state;
	if (overlay === undefined || overlayTile(state) !== kind || overlay.paneFlex === paneFlex) return state;
	return {
		...state,
		overlay:
		{
			...overlay,
			paneFlex,
		},
	};
}

function stackPane(stackRoot: StackNode, kind: PaneKind, lastFlex: LastPaneFlex): StackNode | null
{
	const children = [...stackRoot.children];
	if (tileIds(stackRoot).every((id) => id === "chat"))
	{
		const chatIndex = children.findIndex(isChat);
		const chat = children[chatIndex];
		if (chat === undefined) return null;
		const paneFlex = lastFlex[kind] ?? (WIDE_PANE_KINDS.has(kind) ? FIRST_SPLIT.pane : NARROW_PANE_FLEX);
		const scaled = children.map((child) => (
		{
			...child,
			flex: round((child.flex * FIRST_SPLIT.chat) / chat.flex),
		}));
		scaled.splice(
			chatIndex,
			1,
			{
				...chat,
				flex: FIRST_SPLIT.chat,
			},
			tile(kind, paneFlex),
		);
		return {
			...stackRoot,
			children: scaled,
		};
	}
	const last = children.at(-1);
	if (last === undefined) return null;
	if (last.kind === "tile" && !isChat(last))
	{
		children[children.length - 1] =
		{
			kind: "stack",
			direction: "column",
			flex: last.flex,
			children: [
				{
					...last,
					flex: 1,
				},
				tile(kind, 1),
			],
		};
	}
	else
	{
		children.push(tile(kind, 1));
	}
	return normalizeRoot(
		{
			...stackRoot,
			children,
		},
	);
}

export interface ClosePaneOptions
{
	/** An automatic close (upstream `closeSidePane(…, {unprompted: true})`): slots stay untouched. */
	unprompted?: boolean;
}

/**
 * Closes a pane, remembering its slot so reopening puts it back there. Closing
 * the last side pane records none and drops any old one (upstream `Xc`), so it
 * reopens at the default split.
 */
export function closePane(state: PaneLayoutState, kind: PaneKind, options: ClosePaneOptions = {}): PaneLayoutState
{
	if (!isOpen(state, kind)) return state;
	const root = normalizeRoot(withoutTile(state.root, kind));
	let slots = state.closedSlots ?? {};
	if (options.unprompted !== true)
	{
		const slot = tileIds(root).every((id) => id === "chat") ? null : captureSlot(state.root, kind);
		slots = withoutSlot(state.closedSlots, kind);
		if (slot !== null) slots[kind] = slot;
	}
	return withClosedSlots(
		{
			root,
			expanded: state.expanded === kind ? null : state.expanded,
			focused:
				state.focused === kind
					? (focusNeighbour(state.root, kind, (id) => id !== kind) ?? "chat")
					: state.focused,
		},
		slots,
	);
}

/**
 * Upstream `ps`: after a resize, remembers each resized root-row tile's flex
 * scaled to chat 2 (`2 * flex / chatFlex`), so the kind's next lone open on any
 * session reuses it. Tiles nested in a column, or a root row without chat, are
 * ignored. Returns `lastFlex` itself when nothing changed.
 */
export function rememberPaneFlex(root: StackNode, resizedIds: readonly TileId[], lastFlex: LastPaneFlex): LastPaneFlex
{
	const chat = root.children.find(isChat);
	if (chat === undefined || chat.flex <= 0) return lastFlex;
	const changed: LastPaneFlex = {};
	for (const child of root.children)
	{
		if (child.kind !== "tile" || child.tileId === "chat" || !resizedIds.includes(child.tileId)) continue;
		const flex = round((2 * child.flex) / chat.flex);
		if (lastFlex[child.tileId] !== flex) changed[child.tileId] = flex;
	}
	return Object.keys(changed).length === 0
		? lastFlex
		:
			{
				...lastFlex,
				...changed,
			};
}

/** The first leaf of `node`, depth-first in child order, that is `eligible`. */
function firstEligibleLeaf(node: LayoutNode, eligible: (id: TileId) => boolean): TileId | null
{
	if (node.kind === "tile") return eligible(node.tileId) ? node.tileId : null;
	for (const child of node.children)
	{
		const found = firstEligibleLeaf(child, eligible);
		if (found !== null) return found;
	}
	return null;
}

/**
 * Upstream ca67f2c9d `Oe`: the nearest `eligible` tile to `tileId` in `root`. From the tile's parent up to the root, it
 * tries the siblings before the tile (nearest first), then the ones after it, entering a stack by its first leaf.
 */
export function focusNeighbour(root: StackNode, tileId: TileId, eligible: (id: TileId) => boolean): TileId | null
{
	const path = pathTo(root, tileId);
	if (path === undefined) return null;
	for (let depth = path.length; depth > 0; depth--)
	{
		const parent = nodeAt(root, path.slice(0, depth - 1));
		const index = path[depth - 1];
		if (parent?.kind !== "stack" || index === undefined) return null;
		const candidates = [...parent.children.slice(0, index).toReversed(), ...parent.children.slice(index + 1)];
		for (const candidate of candidates)
		{
			const found = firstEligibleLeaf(candidate, eligible);
			if (found !== null) return found;
		}
	}
	return null;
}

export function focusPane(state: PaneLayoutState, tileId: TileId): PaneLayoutState
{
	if (state.focused === tileId || !isOpen(state, tileId)) return state;
	return {
		...state,
		focused: tileId,
	};
}

export type PaneEdge = "left" | "right" | "top" | "bottom";

type EdgeMove =
	|
	  {
			kind: "at-edge";
	  }
	|
	  {
			kind: "split";
			index: number;
	  }
	|
	  {
			kind: "insert";
			index: number;
	  };

/** Upstream c03935b01 `di`: the stack under the root's single-child chain, and its path from the root. */
function edgeStack(root: StackNode):
{
	stack: StackNode;
	path: number[];
}
{
	let stack = root;
	const path: number[] = [];
	let only = stack.children.length === 1 ? stack.children[0] : undefined;
	while (only?.kind === "stack")
	{
		stack = only;
		path.push(0);
		only = stack.children.length === 1 ? stack.children[0] : undefined;
	}
	return {
		stack,
		path,
	};
}

/** Upstream `fi`: whether the tile already holds `edge`, else where moving it there splits or inserts. */
function edgeMove(stack: StackNode, tilePath: readonly number[], edge: PaneEdge): EdgeMove
{
	const leading = edge === "left" || edge === "top";
	const axis: Direction = edge === "left" || edge === "right" ? "row" : "column";
	const lastIndex = stack.children.length - 1;
	if (tilePath.length !== 1 || stack.direction !== axis)
	{
		if (tilePath.length === 1 && stack.children.length === 1)
			return {
				kind: "at-edge",
			};
		return {
			kind: "split",
			index: leading ? 0 : stack.direction === axis ? lastIndex + 1 : 1,
		};
	}
	const index = leading ? 0 : lastIndex;
	return tilePath[0] === index
		?
			{
				kind: "at-edge",
			}
		:
			{
				kind: "insert",
				index,
			};
}

/** Upstream `pi`: whether `tileId` sits flush against `edge` of the layout. A pane that is not open never does. */
export function paneAtEdge(state: PaneLayoutState, tileId: TileId, edge: PaneEdge): boolean
{
	const {stack} = edgeStack(state.root);
	const tilePath = pathTo(stack, tileId);
	return tilePath !== undefined && edgeMove(stack, tilePath, edge).kind === "at-edge";
}

/**
 * Upstream `moveTileToEdge` (c03935b01 + tree op cf53e1812 `j`): moves the tile flush against `edge`. Along the
 * stack's own axis a direct child swaps to the end keeping its flex; otherwise the tile splits in at flex 1, wrapping
 * the stack in a perpendicular one when the axes differ. Like upstream, the move collapses an expansion and clears a
 * drawn overlay; a tile already at the edge leaves the state untouched.
 */
export function movePaneToEdge(state: PaneLayoutState, tileId: TileId, edge: PaneEdge): PaneLayoutState
{
	const {stack, path} = edgeStack(state.root);
	const tilePath = pathTo(stack, tileId);
	if (tilePath === undefined) return state;
	const move = edgeMove(stack, tilePath, edge);
	if (move.kind === "at-edge") return state;
	const moving = nodeAt(stack, tilePath);
	if (moving?.kind !== "tile") return state;
	const rest = withoutTile(stack, tileId);
	const axis: Direction = edge === "left" || edge === "right" ? "row" : "column";
	let moved: StackNode;
	if (move.kind === "split" && rest.direction !== axis)
	{
		const kept =
		{
			...rest,
			flex: 1,
		};
		const added = tile(tileId, 1);
		moved =
		{
			kind: "stack",
			direction: axis,
			flex: rest.flex,
			children: edge === "left" || edge === "top" ? [added, kept] : [kept, added],
		};
	}
	else
	{
		const children = [...rest.children];
		children.splice(move.index, 0, move.kind === "split" ? tile(tileId, 1) : moving);
		moved =
		{
			...rest,
			children,
		};
	}
	return {
		...withoutOverlay(state),
		root: normalizeRoot(replaceAt(state.root, path, moved)),
		expanded: null,
		focused: tileId,
	};
}

export function expandPane(state: PaneLayoutState, kind: PaneKind): PaneLayoutState
{
	if (!isOpen(state, kind)) return state;
	// Upstream `Ql`: expanding settles a drawn overlay first.
	return {
		...settleOverlay(state),
		expanded: kind,
		focused: kind,
	};
}

export function collapsePane(state: PaneLayoutState): PaneLayoutState
{
	return state.expanded === null
		? state
		:
			{
				...state,
				expanded: null,
			};
}

/**
 * The titlebar/shortcut toggle (upstream `toggleSidePane`, c03935b01): opens a
 * closed pane, and closes an open one unless a different pane is expanded, in
 * which case only the expansion collapses (its `H(n)` / `U(n, e)` branch) and
 * the toggled pane stays open. `open` lets the host open with its remembered
 * flex and fit.
 */
export function togglePane(
	state: PaneLayoutState,
	kind: PaneKind,
	open: (state: PaneLayoutState) => PaneLayoutState = (current) => openPane(current, kind),
): PaneLayoutState
{
	if (!isOpen(state, kind)) return open(state);
	if (state.expanded !== null && state.expanded !== kind) return collapsePane(state);
	return closePane(state, kind);
}

/**
 * The layout a phone shows: a saved layout with more than one side column
 * (from desktop) can't fit below 640px, so its panes stack in tree order in
 * one side column beside the chat, the shape opening them fresh on a phone
 * builds. A layout that already fits is returned as is.
 */
export function fitPhoneLayout(state: PaneLayoutState): PaneLayoutState
{
	if (state.root.children.length <= 2) return state;
	const panes = tileIds(state.root).filter((tileId) => tileId !== "chat");
	const side: LayoutNode =
		panes.length === 1 && panes[0] !== undefined
			? tile(panes[0], FIRST_SPLIT.pane)
			:
				{
					kind: "stack",
					direction: "column",
					flex: FIRST_SPLIT.pane,
					children: panes.map((id) => tile(id, 1)),
				};
	return {
		...state,
		root:
		{
			...state.root,
			children: [tile("chat", FIRST_SPLIT.chat), side],
		},
	};
}

/**
 * Applies an update made on the phone view (`fitPhoneLayout`) to the saved
 * layout, so the desktop columns survive a phone visit: focus, expand, open
 * and close carry over by tile, and only a phone resize or move, which
 * rearranges the stacked column itself, saves the phone shape.
 */
export function updatePhoneView(
	state: PaneLayoutState,
	update: (state: PaneLayoutState) => PaneLayoutState,
): PaneLayoutState
{
	const view = fitPhoneLayout(state);
	if (view === state) return update(state);
	const next = update(view);
	if (next === view) return state;
	const viewIds = tileIds(view.root);
	const nextIds = tileIds(next.root);
	const closed = viewIds.filter((id): id is PaneKind => id !== "chat" && !nextIds.includes(id));
	const opened = nextIds.filter((id): id is PaneKind => id !== "chat" && !viewIds.includes(id));
	if (closed.length === 0 && opened.length === 0 && JSON.stringify(next.root) !== JSON.stringify(view.root))
	{
		return next;
	}
	const saved = opened.reduce(
		(acc, kind) => openPane(acc, kind),
		closed.reduce((acc, kind) => closePane(acc, kind), state),
	);
	return {
		...saved,
		expanded: next.expanded,
		focused: next.focused,
	};
}

/** Minimum size of a node along `axis`: sums along a stack's own axis, maxes across it. */
export function minTileSize(node: LayoutNode, axis: Direction): number
{
	if (node.kind === "tile")
	{
		return node.tileId === "chat" ? MIN_TILE_SIZE_PX.chat : MIN_TILE_SIZE_PX.pane;
	}
	const sizes = node.children.map((child) => minTileSize(child, axis));
	return node.direction === axis
		? sizes.reduce((total, size) => total + size, 0) + TILE_GAP_PX * (sizes.length - 1)
		: Math.max(...sizes);
}

/**
 * Upstream ca67f2c9d `Se(node, axis, tileById, cfg, {overflowMinReachable: true})`: along a row the chat
 * tile floors at 100 (its 320 overflow shell slides under a neighbour) and a pane at 280; along a column
 * every tile floors at 100. A stack sums its children plus 1px gaps along its own axis and maxes across it.
 */
export function tileFloor(node: LayoutNode, axis: Direction): number
{
	return floorOf(node, axis, true);
}

/** `tileFloor` without the overflow reach (upstream `Se` with no options): the chat floors at 320 along a row. */
function fullTileFloor(node: LayoutNode, axis: Direction): number
{
	return floorOf(node, axis, false);
}

function floorOf(node: LayoutNode, axis: Direction, reachable: boolean): number
{
	const base = axis === "row" ? MIN_TILE_WIDTH_PX : MIN_TILE_BASE_PX;
	if (node.kind === "tile")
	{
		if (axis !== "row" || node.tileId !== "chat") return base;
		return reachable ? MIN_TILE_BASE_PX : Math.max(CHAT_OVERFLOW_MIN_PX, MIN_TILE_BASE_PX);
	}
	const floors = node.children.map((child) => floorOf(child, axis, reachable));
	return node.direction === axis
		? floors.reduce((total, floor) => total + floor, 0) + LINE_TILE_GAP_PX * Math.max(0, floors.length - 1)
		: Math.max(base, ...floors);
}

/**
 * Upstream ca67f2c9d `xe`: shares `total` px by flex, then pins each child whose share falls under its
 * floor (less half a pixel) and re-shares the rest among the unpinned; when the floors exhaust the space
 * it falls back to floor-proportional. Returns flexes that sum to the child count.
 */
export function resolveFlexes(flexes: readonly number[], mins: readonly number[], total: number): number[]
{
	const count = flexes.length;
	if (count === 0 || total <= 0) return [...flexes];
	const flexSum = flexes.reduce((sum, flex) => sum + flex, 0) || count;
	const pinned = new Set<number>();
	const minAt = (index: number): number => mins[index] ?? 0;
	let px = flexes.map((flex) => (flex / flexSum) * total);
	for (;;)
	{
		const under = px.findIndex((value, index) => !pinned.has(index) && value < minAt(index) - 0.5);
		if (under === -1) break;
		pinned.add(under);
		const pinnedPx = [...pinned].reduce((sum, index) => sum + minAt(index), 0);
		const freeFlex = flexes.reduce((sum, flex, index) => (pinned.has(index) ? sum : sum + flex), 0);
		const left = total - pinnedPx;
		if (freeFlex <= 0 || left <= 0)
		{
			const minSum = mins.reduce((sum, min) => sum + min, 0) || 1;
			px = mins.map((min) => (min / minSum) * total);
			break;
		}
		px = flexes.map((flex, index) => (pinned.has(index) ? minAt(index) : (flex / freeFlex) * left));
	}
	const pxSum = px.reduce((sum, value) => sum + value, 0) || count;
	return px.map((value) => (value * count) / pxSum);
}

/** Splits `usable` px by `flexes` into whole pixels by cumulative rounding, as upstream's walk does. */
function wholePixelSizes(flexes: readonly number[], usable: number): number[]
{
	const flexSum = flexes.reduce((sum, flex) => sum + flex, 0) || 1;
	let running = 0;
	let previous = 0;
	return flexes.map((flex) =>
	{
		running += flex;
		const edge = Math.round((running / flexSum) * usable);
		const size = edge - previous;
		previous = edge;
		return size;
	});
}

/**
 * Upstream cc43287c9 `gFe`/`R9` (withRoomForChat), line mode: when a user opens a pane, a row whose
 * children have spare room over their reachable floors grows the chat (or the child holding it) from
 * its 100px reach toward its full 320px. Panes floor at 280 either way, so they are never grown. A
 * changed row takes the resolved flexes, which sum to its child count. Unless `rootRowOnly` (the open
 * restored a closed slot), nested stacks are fitted with their resolved widths; columns are only
 * descended. Unchanged subtrees keep their identity, and an unchanged root is returned as is.
 */
export function fitOpenedLayout(root: StackNode, widthPx: number, rootRowOnly: boolean): StackNode
{
	if (widthPx <= 0 || root.direction !== "row") return root;
	return fitStack(root, widthPx, !rootRowOnly);
}

function fitStack(stack: StackNode, widthPx: number, recurse: boolean): StackNode
{
	let fitted = stack;
	const usable = Math.max(0, widthPx - LINE_TILE_GAP_PX * Math.max(0, stack.children.length - 1));
	if (stack.direction === "row")
	{
		const floors = stack.children.map((child) => tileFloor(child, "row"));
		const spare = usable - floors.reduce((sum, floor) => sum + floor, 0);
		if (spare > 0)
		{
			const flexes = stack.children.map((child) => child.flex);
			const current = resolveFlexes(flexes, floors, usable);
			const targets = stack.children.map((child, index) =>
				Math.min(fullTileFloor(child, "row"), (floors[index] ?? 0) + spare),
			);
			const target = resolveFlexes(flexes, targets, usable);
			if (!target.every((flex, index) => Math.abs(flex - (current[index] ?? 0)) < 1e-6))
			{
				const children = stack.children.map((child, index) => (
				{
					...child,
					flex: round(target[index] ?? 0),
				}));
				fitted =
				{
					...stack,
					children,
				};
			}
		}
	}
	if (!recurse) return fitted;
	const flexes = fitted.children.map((child) => child.flex);
	const floors = fitted.children.map((child) => tileFloor(child, "row"));
	const widths =
		fitted.direction === "row"
			? wholePixelSizes(resolveFlexes(flexes, floors, usable), usable)
			: fitted.children.map(() => widthPx);
	const children = fitted.children.map((child, index) =>
		child.kind === "stack" ? fitStack(child, widths[index] ?? 0, true) : child,
	);
	return children.every((child, index) => child === fitted.children[index])
		? fitted
		:
			{
				...fitted,
				children,
			};
}

/** One child's rendered geometry from `resolveTileLayout`. */
export interface ResolvedNode
{
	/** The resolved flex; a stack's children sum to the child count. */
	flex: number;
	width: number;
	height: number;
	/** The wrap's `min-width`: the row floor clamped to the allocation (0 for a stack inside a column). */
	minWidthPx: number;
	/** A tile's `min-height` (upstream `Ae`: min(100, height − 1)); null for a stack. */
	minHeightPx: number | null;
}

/**
 * Upstream ca67f2c9d `we` (walkResolvedFlexes) in line mode: resolves each stack's flexes against its
 * measured box with the reachable floors, splits the box into whole pixels by cumulative rounding, and
 * recurses. Keyed by the child's path from the root joined with "." ("0", "1.0").
 */
export function resolveTileLayout(
	root: StackNode,
	box:
	{
		width: number;
		height: number;
	},
): Map<string, ResolvedNode>
{
	const resolved = new Map<string, ResolvedNode>();
	const walk = (
		stack: StackNode,
		stackBox:
		{
			width: number;
			height: number;
		},
		path: readonly number[],
	): void =>
	{
		const isRow = stack.direction === "row";
		const along = isRow ? stackBox.width : stackBox.height;
		const usable = Math.max(0, along - LINE_TILE_GAP_PX * Math.max(0, stack.children.length - 1));
		const floors = stack.children.map((child) => tileFloor(child, stack.direction));
		const rowFloors = isRow ? floors : stack.children.map((child) => tileFloor(child, "row"));
		const flexes = resolveFlexes(
			stack.children.map((child) => child.flex),
			floors,
			usable,
		);
		const sizes = wholePixelSizes(flexes, usable);
		const previous = sizes.reduce((sum, size) => sum + size, 0);
		stack.children.forEach((child, index) =>
		{
			const size = sizes[index] ?? 0;
			const childBox = isRow
				?
					{
						width: size,
						height: stackBox.height,
					}
				:
					{
						width: stackBox.width,
						height: size,
					};
			const childPath = [...path, index];
			const isTile = child.kind === "tile";
			resolved.set(
				childPath.join("."),
				{
					flex: previous > 0 ? (size / previous) * flexes.length : (flexes[index] ?? child.flex),
					width: childBox.width,
					height: childBox.height,
					minWidthPx: isRow || isTile ? Math.min(rowFloors[index] ?? 0, childBox.width) : 0,
					minHeightPx: isTile ? Math.max(0, Math.min(MIN_TILE_BASE_PX, childBox.height - 1)) : null,
				},
			);
			if (child.kind === "stack") walk(child, childBox, childPath);
		});
	};
	walk(root, box, []);
	return resolved;
}

export interface ResizeRequest
{
	/** Child indices from the root to the stack that owns the divider. */
	path: readonly number[];
	/** The divider sits between `children[index]` and `children[index + 1]`. */
	index: number;
	deltaPx: number;
	/** The stack's measured size along its direction, gaps included. */
	sizePx: number;
	/**
	 * The stack's rendered (resolved) flexes, upstream `Xt`: when given the drag starts from them with
	 * line-mode 1px gaps and `tileFloor` floors, and writes every child's flex back.
	 */
	startFlexes?: readonly number[];
	/** With `startFlexes`: a pointer drag floors the chat at 100 ("reachable"), a key step at 320 ("full"). */
	floor?: "reachable" | "full";
}

export function resizeDivider(state: PaneLayoutState, request: ResizeRequest): PaneLayoutState
{
	const stack = nodeAt(state.root, request.path);
	if (stack?.kind !== "stack") return state;
	const before = stack.children[request.index];
	const after = stack.children[request.index + 1];
	if (before === undefined || after === undefined) return state;
	if (request.startFlexes !== undefined) return resizeResolved(state, stack, request, request.startFlexes);

	const available = request.sizePx - TILE_GAP_PX * (stack.children.length - 1);
	const total = sumFlex(stack.children);
	const pairPx = ((before.flex + after.flex) / total) * available;
	const beforePx = (before.flex / total) * available;
	const maxBefore = pairPx - minTileSize(after, stack.direction);
	const nextBefore = Math.max(minTileSize(before, stack.direction), Math.min(beforePx + request.deltaPx, maxBefore));
	const toFlex = (px: number): number => round((px / available) * total);

	const children = [...stack.children];
	children[request.index] =
	{
		...before,
		flex: toFlex(nextBefore),
	};
	children[request.index + 1] =
	{
		...after,
		flex: toFlex(pairPx - nextBefore),
	};
	return {
		...state,
		root: replaceAt(
			state.root,
			request.path,
			{
				...stack,
				children,
			},
		),
	};
}

/**
 * Upstream ca67f2c9d `Xt` + `tn`: moves the boundary from its rendered spot (the resolved flexes), clamps
 * with the reachable or full floors, and replaces every child's flex with the moved set (summing to n).
 */
function resizeResolved(
	state: PaneLayoutState,
	stack: StackNode,
	request: ResizeRequest,
	startFlexes: readonly number[],
): PaneLayoutState
{
	const count = stack.children.length;
	if (startFlexes.length !== count) return state;
	const available = request.sizePx - LINE_TILE_GAP_PX * (count - 1);
	if (available <= 0) return state;
	const floorOf = request.floor === "full" ? fullTileFloor : tileFloor;
	const startSum = startFlexes.reduce((sum, flex) => sum + flex, 0) || count;
	const px = startFlexes.map((flex) => (flex / startSum) * available);
	const beforeNode = stack.children[request.index];
	const afterNode = stack.children[request.index + 1];
	const beforePx = px[request.index];
	const afterPx = px[request.index + 1];
	if (beforeNode === undefined || afterNode === undefined || beforePx === undefined || afterPx === undefined)
		return state;
	const pairPx = beforePx + afterPx;
	const nextBefore = Math.max(
		floorOf(beforeNode, stack.direction),
		Math.min(beforePx + request.deltaPx, pairPx - floorOf(afterNode, stack.direction)),
	);
	px[request.index] = nextBefore;
	px[request.index + 1] = pairPx - nextBefore;
	const children = stack.children.map((child, index) => (
	{
		...child,
		flex: round(((px[index] ?? 0) / available) * count),
	}));
	return {
		...state,
		root: replaceAt(
			state.root,
			request.path,
			{
				...stack,
				children,
			},
		),
	};
}

/** Where a split move will land: the half (`side`) of the node at `path` is outlined before Enter commits it. */
export const PANE_FLEX_STORAGE_KEY = "ccb.lastPaneFlexByKind.v1";

const LastPaneFlexSchema = z.partialRecord(PaneKindSchema, FlexSchema);

export function loadLastPaneFlex(storage: Storage | null = browserStorage()): LastPaneFlex
{
	try
	{
		const raw = storage?.getItem(PANE_FLEX_STORAGE_KEY);
		if (raw === null || raw === undefined) return {};
		const parsed = LastPaneFlexSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : {};
	}
	catch
	{
		return {};
	}
}

export function saveLastPaneFlex(lastFlex: LastPaneFlex, storage: Storage | null = browserStorage()): void
{
	if (!storage) return;
	try
	{
		storage.setItem(PANE_FLEX_STORAGE_KEY, JSON.stringify(lastFlex));
	}
	catch
	{
		// localStorage can be denied even when window exists; ratio memory is best-effort.
	}
}

function browserStorage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

function readStore(storage: Storage): Record<string, PaneLayoutEntry> | undefined
{
	const raw = storage.getItem(PANE_LAYOUT_STORAGE_KEY);
	if (raw === null) return {};
	try
	{
		const parsed = PaneLayoutStoreSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : undefined;
	}
	catch
	{
		return undefined;
	}
}

function writeEntry(
	sessionId: string,
	storage: Storage,
	update: (entry: PaneLayoutEntry | undefined) => PaneLayoutEntry,
): void
{
	const store = readStore(storage) ?? {};
	storage.setItem(
		PANE_LAYOUT_STORAGE_KEY,
		JSON.stringify(
			{
				...store,
				[sessionId]: update(store[sessionId]),
			},
		),
	);
}

export function loadPaneLayout(sessionId: string, storage: Storage | null = browserStorage()): PaneLayoutState
{
	try
	{
		const entry = storage ? readStore(storage)?.[sessionId] : undefined;
		if (entry === undefined) return defaultPaneLayout();
		const layout: PaneLayoutState =
		{
			root: entry.root,
			expanded: entry.expanded,
			focused: entry.focused,
		};
		return entry.closedSlots === undefined
			? layout
			:
				{
					...layout,
					closedSlots: entry.closedSlots,
				};
	}
	catch
	{
		// localStorage can be denied even when window exists; layout persistence is best-effort.
		return defaultPaneLayout();
	}
}

export function savePaneLayout(
	sessionId: string,
	state: PaneLayoutState,
	storage: Storage | null = browserStorage(),
): void
{
	if (!storage) return;
	try
	{
		writeEntry(sessionId, storage, (entry) =>
		{
			const next: PaneLayoutEntry =
			{
				...withoutOverlay(state),
			};
			if (entry?.changesScope !== undefined) next.changesScope = entry.changesScope;
			// Closing the Files pane discards the session's tabs, as upstream does.
			if (entry?.fileTabs !== undefined && isOpen(state, "files")) next.fileTabs = entry.fileTabs;
			if (entry?.subagentId !== undefined && isOpen(state, "subagents")) next.subagentId = entry.subagentId;
			return next;
		});
	}
	catch
	{
		// localStorage can be denied even when window exists; layout persistence is best-effort.
	}
}

export function loadChangesScope(sessionId: string, storage: Storage | null = browserStorage()): string
{
	try
	{
		return (storage && readStore(storage)?.[sessionId]?.changesScope) ?? DEFAULT_CHANGES_SCOPE;
	}
	catch
	{
		return DEFAULT_CHANGES_SCOPE;
	}
}

export function saveChangesScope(sessionId: string, scope: string, storage: Storage | null = browserStorage()): void
{
	if (!storage) return;
	try
	{
		writeEntry(sessionId, storage, (entry) => (
		{
			...(entry ?? defaultPaneLayout()),
			changesScope: scope,
		}));
	}
	catch
	{
		// localStorage can be denied even when window exists; scope persistence is best-effort.
	}
}

export function loadFileTabs(sessionId: string, storage: Storage | null = browserStorage()): FileTabsState
{
	try
	{
		return (storage && readStore(storage)?.[sessionId]?.fileTabs) ?? EMPTY_FILE_TABS;
	}
	catch
	{
		return EMPTY_FILE_TABS;
	}
}

export function saveFileTabs(
	sessionId: string,
	fileTabs: FileTabsState,
	storage: Storage | null = browserStorage(),
): void
{
	if (!storage) return;
	try
	{
		writeEntry(sessionId, storage, (entry) => (
		{
			...(entry ?? defaultPaneLayout()),
			fileTabs,
		}));
	}
	catch
	{
		// localStorage can be denied even when window exists; tab persistence is best-effort.
	}
}

/** The agent the Subagent pane shows, or null for its subagents list. */
export function loadSubagentPaneAgent(sessionId: string, storage: Storage | null = browserStorage()): string | null
{
	try
	{
		return (storage && readStore(storage)?.[sessionId]?.subagentId) ?? null;
	}
	catch
	{
		return null;
	}
}

export function saveSubagentPaneAgent(
	sessionId: string,
	agentId: string | null,
	storage: Storage | null = browserStorage(),
): void
{
	if (!storage) return;
	try
	{
		writeEntry(sessionId, storage, (entry) =>
		{
			const next: PaneLayoutEntry =
			{
				...(entry ?? defaultPaneLayout()),
			};
			if (agentId === null) delete next.subagentId;
			else next.subagentId = agentId;
			return next;
		});
	}
	catch
	{
		// localStorage can be denied even when window exists; focus persistence is best-effort.
	}
}
