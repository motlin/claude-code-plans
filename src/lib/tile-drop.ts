/**
 * Upstream's tile drop model (tile-tree chunk cf53e1812: drop rects `T`, resolver `k`, apply `A`, normalise `j`), ported
 * over local layouts. Upstream stacks carry ids; a local stack is named by its path in the layout being dragged
 * over, so targets carry a `stackPath`.
 */
import type {Direction, LayoutNode, PaneLayoutState, StackNode, TileId} from "./pane-layout";

/** Upstream `y`: the cross-strip depth, the floor of a 1/3 strip, and the start-strip trim. */
const STRIP_PX = 24;
/** Upstream `b`: no feedback until the pointer is this far from where the drag started. */
const FEEDBACK_THRESHOLD_PX = 16;
/** Upstream `e(config)` in line mode: `max(gap, 7)` with the 1px line gap. */
const ROOT_BAND_PX = 7;
/** Upstream `x`: root bands reach this far outside the container. */
const OUTWARD_PX = 1e4;
/** Upstream `Z`: an indicator sits half the 1px line gap outside its node, flush where the node meets the container. */
const LINE_GAP_HALF_PX = 0.5;

export interface DropRect
{
	left: number;
	top: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
}

export interface DropPoint
{
	x: number;
	y: number;
}

/** Upstream `g`. */
export function dropRect(left: number, top: number, width: number, height: number): DropRect
{
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
	};
}

export type TileDropTarget =
	|
	  {
			kind: "insert";
			stackPath: number[];
			index: number;
	  }
	|
	  {
			kind: "split";
			stackPath: number[];
			direction: Direction;
			index: number;
	  }
	|
	  {
			kind: "wrap";
			tileId: TileId;
			direction: Direction;
			index: 0 | 1;
	  };

export type TileDropResolution =
	|
	  {
			kind: "none";
	  }
	|
	  {
			kind: "rearrange";
			root: StackNode;
	  }
	|
	  {
			kind: "drop";
			target: TileDropTarget;
			root: StackNode;
	  };

/** The rects map key for the stack at `path`; a tile's key is its id. */
export function stackRectKey(path: readonly number[]): string
{
	return `stack:${path.join(".")}`;
}

function pathOfStackKey(id: string): number[]
{
	const path = id.slice("stack:".length);
	return path === "" ? [] : path.split(".").map(Number);
}

interface IdTile
{
	kind: "tile";
	tileId: TileId;
	flex: number;
}

interface IdStack
{
	kind: "stack";
	id: string;
	direction: Direction;
	flex: number;
	children: IdNode[];
}

type IdNode = IdTile | IdStack;

type IdTarget =
	|
	  {
			kind: "insert";
			stackId: string;
			index: number;
	  }
	|
	  {
			kind: "split";
			stackId: string;
			direction: Direction;
			index: number;
	  }
	|
	  {
			kind: "wrap";
			tileId: TileId;
			direction: Direction;
			index: 0 | 1;
	  };

function withIds(node: StackNode, path?: number[]): IdStack;
function withIds(node: LayoutNode, path?: number[]): IdNode;
function withIds(node: LayoutNode, path: number[] = []): IdNode
{
	if (node.kind === "tile")
		return {
			...node,
		};
	return {
		kind: "stack",
		id: stackRectKey(path),
		direction: node.direction,
		flex: node.flex,
		children: node.children.map((child, index) => withIds(child, [...path, index])),
	};
}

function withoutIds(node: IdStack): StackNode;
function withoutIds(node: IdNode): LayoutNode;
function withoutIds(node: IdNode): LayoutNode
{
	if (node.kind === "tile")
		return {
			...node,
		};
	return {
		kind: "stack",
		direction: node.direction,
		flex: node.flex,
		children: node.children.map((child) => withoutIds(child)),
	};
}

let createdStacks = 0;

/** Upstream `c`. */
function newStackId(): string
{
	createdStacks += 1;
	return `new:${createdStacks}`;
}

/** Upstream `i`. */
function nodeId(node: IdNode): string
{
	return node.kind === "stack" ? node.id : node.tileId;
}

function toIdTarget(target: TileDropTarget): IdTarget
{
	return target.kind === "wrap"
		? target
		: target.kind === "insert"
			?
				{
					kind: "insert",
					stackId: stackRectKey(target.stackPath),
					index: target.index,
				}
			:
				{
					kind: "split",
					stackId: stackRectKey(target.stackPath),
					direction: target.direction,
					index: target.index,
				};
}

function fromIdTarget(target: IdTarget): TileDropTarget
{
	return target.kind === "wrap"
		? target
		: target.kind === "insert"
			?
				{
					kind: "insert",
					stackPath: pathOfStackKey(target.stackId),
					index: target.index,
				}
			:
				{
					kind: "split",
					stackPath: pathOfStackKey(target.stackId),
					direction: target.direction,
					index: target.index,
				};
}

/** Upstream `d`. */
function tilePath(node: IdNode | LayoutNode, tileId: TileId, path: number[] = []): number[] | null
{
	if (node.kind === "tile") return node.tileId === tileId ? path : null;
	for (const [index, child] of node.children.entries())
	{
		const found = tilePath(child, tileId, [...path, index]);
		if (found !== null) return found;
	}
	return null;
}

/** Upstream `p`: the stack holding the node at `path`. */
function parentAt(root: IdNode, path: readonly number[]): IdStack | null
{
	if (path.length === 0) return null;
	let node: IdNode | undefined = root;
	for (const index of path.slice(0, -1))
	{
		if (node?.kind !== "stack") return null;
		node = node.children[index];
	}
	return node?.kind === "stack" ? node : null;
}

/** Upstream `l`. */
function findStack(node: IdNode, id: string): IdStack | null
{
	if (node.kind !== "stack") return null;
	if (node.id === id) return node;
	for (const child of node.children)
	{
		const found = findStack(child, id);
		if (found !== null) return found;
	}
	return null;
}

/** Upstream `u`. */
function stackParent(node: IdNode, id: string): IdStack | null
{
	if (node.kind !== "stack") return null;
	for (const child of node.children)
	{
		if (child.kind === "stack" && child.id === id) return node;
		const found = stackParent(child, id);
		if (found !== null) return found;
	}
	return null;
}

/** Upstream `a`. */
function cloneNode(node: IdStack): IdStack;
function cloneNode(node: IdNode): IdNode;
function cloneNode(node: IdNode): IdNode
{
	return node.kind === "tile"
		?
			{
				...node,
			}
		:
			{
				...node,
				children: node.children.map((child) => cloneNode(child)),
			};
}

/** Upstream `h`. */
function clamp(value: number, min: number, max: number): number
{
	return Math.min(Math.max(value, min), max);
}

/** Upstream `j`: drops empty stacks, flattens same-direction nesting and collapses single children. */
function normalize(node: IdNode): IdNode
{
	if (node.kind === "tile") return node;
	const kept: IdNode[] = [];
	for (const child of node.children)
	{
		const normalized = normalize(child);
		if (normalized.kind === "tile" || normalized.children.length > 0) kept.push(normalized);
	}
	const children = kept.flatMap((child) =>
		child.kind === "stack" && child.direction === node.direction ? child.children : [child],
	);
	const [only] = children;
	if (children.length === 1 && only !== undefined)
		return only.kind === "stack"
			?
				{
					...only,
					flex: node.flex,
				}
			:
				{
					kind: "tile",
					tileId: only.tileId,
					flex: node.flex,
				};
	return {
		...node,
		children,
	};
}

/** Upstream `M`: a root is always a stack. */
function asRoot(node: IdNode): IdStack
{
	return node.kind === "stack"
		? node
		:
			{
				kind: "stack",
				id: newStackId(),
				direction: "row",
				flex: 1,
				children: [node],
			};
}

/** Upstream `E`: the layout's shape, ignoring flexes and ids. */
function shapeKey(root: IdNode): string
{
	const key = (node: IdNode): string =>
		node.kind === "tile" ? `T:${node.tileId}` : `S[${node.direction}](${node.children.map(key).join(",")})`;
	return key(root);
}

function tile(tileId: TileId, flex: number): IdTile
{
	return {
		kind: "tile",
		tileId,
		flex,
	};
}

/** Upstream `A`: moves `tileId` to `target`, returning `root` itself when it cannot. */
function applyIdTarget(root: IdStack, tileId: TileId, target: IdTarget): IdStack
{
	const tree = cloneNode(root);
	const path = tilePath(tree, tileId);
	if (path === null) return root;
	const parent = parentAt(tree, path);
	const index = path.at(-1);
	if (parent === null || index === undefined) return root;
	const moved = parent.children[index];
	if (moved === undefined) return root;
	if (target.kind === "insert" && parent.id === target.stackId)
	{
		const rest = parent.children.filter((_, at) => at !== index);
		rest.splice(clamp(target.index, 0, rest.length), 0, moved);
		parent.children = rest;
		return asRoot(normalize(tree));
	}
	parent.children.splice(index, 1);
	if (target.kind === "wrap")
	{
		const anchorPath = tilePath(tree, target.tileId);
		const anchorParent = anchorPath === null ? null : parentAt(tree, anchorPath);
		const anchorIndex = anchorPath?.at(-1);
		const anchor = anchorIndex === undefined ? undefined : anchorParent?.children[anchorIndex];
		if (anchorParent === null || anchorIndex === undefined || anchor === undefined) return root;
		const added = tile(tileId, 1);
		anchorParent.children[anchorIndex] =
		{
			kind: "stack",
			id: newStackId(),
			direction: target.direction,
			flex: anchor.flex,
			children: target.index === 0 ? [added, anchor] : [anchor, added],
		};
		anchor.flex = 1;
		return asRoot(normalize(tree));
	}
	const into = findStack(tree, target.stackId);
	if (into === null) return root;
	if (target.kind === "split" && target.direction !== into.direction)
	{
		const added = tile(tileId, 1);
		const wrapped: IdStack =
		{
			kind: "stack",
			id: newStackId(),
			direction: target.direction,
			flex: into.flex,
			children: target.index === 0 ? [added, into] : [into, added],
		};
		into.flex = 1;
		const outer = stackParent(tree, target.stackId);
		if (outer === null) return asRoot(normalize(wrapped));
		const at = outer.children.findIndex((child) => child.kind === "stack" && child.id === target.stackId);
		outer.children[at] = wrapped;
		return asRoot(normalize(tree));
	}
	const shifted = into.id === parent.id && target.index > index ? target.index - 1 : target.index;
	const placed = tile(tileId, target.kind === "split" || moved.kind !== "tile" ? 1 : moved.flex);
	into.children.splice(clamp(shifted, 0, into.children.length), 0, placed);
	return asRoot(normalize(tree));
}

/** Moves `tileId` to an upstream drop target, as releasing a drag over it or pressing Enter on a preview does. */
export function applyTileDrop(state: PaneLayoutState, tileId: TileId, target: TileDropTarget): PaneLayoutState
{
	const root = withIds(state.root);
	const next = applyIdTarget(root, tileId, toIdTarget(target));
	if (next === root) return state;
	return {
		...state,
		root: withoutIds(next),
		focused: tileId,
	};
}

/** Upstream `m`: whether any column on the path from the root to the tile has more than one child. */
export function inMultiChildColumn(root: LayoutNode, tileId: TileId): boolean
{
	const path = tilePath(root, tileId);
	if (path === null) return false;
	let node: LayoutNode | undefined = root;
	for (const index of path)
	{
		if (node?.kind !== "stack") return false;
		if (node.direction === "column" && node.children.length > 1) return true;
		node = node.children[index];
	}
	return false;
}

function contains(point: DropPoint, rect: DropRect): boolean
{
	return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function perpendicular(direction: Direction): Direction
{
	return direction === "row" ? "column" : "row";
}

/** Upstream `x`. */
function thirdOf(size: number): number
{
	return Math.max(STRIP_PX, Math.floor(size / 3));
}

/** Upstream `S`: 24px strips on a tile's two cross edges. */
function crossStrips(rect: DropRect, direction: Direction): [DropRect, DropRect]
{
	return direction === "row"
		? [
				dropRect(rect.left, rect.top, STRIP_PX, rect.height),
				dropRect(rect.right - STRIP_PX, rect.top, STRIP_PX, rect.height),
			]
		: [
				dropRect(rect.left, rect.top, rect.width, STRIP_PX),
				dropRect(rect.left, rect.bottom - STRIP_PX, rect.width, STRIP_PX),
			];
}

/** Upstream `C`: 1/3 strips (a 24px top strip in a column) for a split of the source's own parent. */
function thirdStrips(rect: DropRect, direction: Direction): [DropRect, DropRect]
{
	if (direction === "row")
	{
		const width = thirdOf(rect.width);
		return [
			dropRect(rect.left, rect.top, width, rect.height),
			dropRect(rect.right - width, rect.top, width, rect.height),
		];
	}
	const height = thirdOf(rect.height);
	return [
		dropRect(rect.left, rect.top, rect.width, STRIP_PX),
		dropRect(rect.left, rect.bottom - height, rect.width, height),
	];
}

/** Upstream `w`: moves a strip off the start pointer so a drag does not begin over a target. */
function trimStart([first, second]: [DropRect, DropRect], direction: Direction, start: DropPoint): [DropRect, DropRect]
{
	if (direction === "column")
	{
		if (start.y < first.top || start.y > first.bottom) return [first, second];
		const height = Math.min(first.height, Math.max(0, second.top - first.bottom));
		return [dropRect(first.left, first.bottom, first.width, height), second];
	}
	const holds = (rect: DropRect) => start.x >= rect.left && start.x <= rect.right;
	const width = Math.min(first.width, second.left - first.right);
	if (width <= 0) return [first, second];
	return [
		holds(first) ? dropRect(first.right, first.top, width, first.height) : first,
		holds(second) ? dropRect(second.left - width, second.top, width, second.height) : second,
	];
}

type DropZone =
	|
	  {
			kind: "target";
			rect: DropRect;
			target: IdTarget;
			ownStrip?: true;
	  }
	|
	  {
			kind: "rearrange";
			rect: DropRect;
			stackId: string;
			direction: Direction;
	  };

interface TileEntry
{
	tileId: TileId;
	rect: DropRect;
	parentId: string;
	parentDirection: Direction;
	indexInParent: number;
}

interface StackEntry
{
	stack: IdStack;
	rect: DropRect;
	childRects: DropRect[];
}

/** Upstream `v` + `T`: every drop zone, first match wins. Null when the source is not measured. */
function dropZones(
	root: IdStack,
	source: TileId,
	rects: ReadonlyMap<string, DropRect>,
	start: DropPoint,
	fullHeight: ReadonlySet<TileId>,
): DropZone[] | null
{
	const tiles: TileEntry[] = [];
	const stacks: StackEntry[] = [];
	const walk = (node: IdNode, parent: IdStack | null, index: number) =>
	{
		if (node.kind === "tile")
		{
			const rect = rects.get(node.tileId);
			if (rect !== undefined && parent !== null)
				tiles.push(
					{
						tileId: node.tileId,
						rect,
						parentId: parent.id,
						parentDirection: parent.direction,
						indexInParent: index,
					},
				);
			return;
		}
		const rect = rects.get(node.id);
		if (rect === undefined) return;
		const childRects: DropRect[] = [];
		node.children.forEach((child, at) =>
		{
			walk(child, node, at);
			const childRect = rects.get(nodeId(child));
			if (childRect !== undefined) childRects.push(childRect);
		});
		stacks.push(
			{
				stack: node,
				rect,
				childRects,
			},
		);
	};
	walk(root, null, 0);
	const sourcePath = tilePath(root, source);
	const sourceParent = sourcePath === null ? null : parentAt(root, sourcePath);
	if (sourcePath !== null && (sourceParent === null || !rects.has(source))) return null;

	const zones: DropZone[] = [];
	const rootRect = rects.get(root.id);
	if (rootRect === undefined) return zones;
	const isRow = root.direction === "row";
	const band = (edge: "top" | "bottom" | "left" | "right", depth: number) =>
		edge === "top"
			? dropRect(rootRect.left, rootRect.top - OUTWARD_PX, rootRect.width, depth + OUTWARD_PX)
			: edge === "bottom"
				? dropRect(rootRect.left, rootRect.bottom - depth, rootRect.width, depth + OUTWARD_PX)
				: dropRect(
						edge === "left" ? rootRect.left - OUTWARD_PX : rootRect.right - depth,
						rootRect.top - OUTWARD_PX,
						depth + OUTWARD_PX,
						rootRect.height + OUTWARD_PX * 2,
					);
	const rootSplit = (edge: "top" | "bottom" | "left" | "right", index: number, direction: Direction) =>
	{
		const reach = band(edge, Math.max(ROOT_BAND_PX, STRIP_PX));
		zones.push(
			{
				kind: "target",
				rect: contains(start, reach) ? band(edge, 0) : band(edge, ROOT_BAND_PX),
				target:
				{
					kind: "split",
					stackId: root.id,
					index,
					direction,
				},
			},
		);
	};
	rootSplit("top", 0, "column");
	rootSplit("bottom", isRow ? 1 : root.children.length, "column");
	rootSplit("left", 0, "row");
	rootSplit("right", isRow ? root.children.length : 1, "row");

	const pair = sourceParent?.children.length === 2 ? sourceParent : null;
	for (const entry of tiles)
	{
		if (entry.tileId === source) continue;
		const direction = perpendicular(entry.parentDirection);
		const pairId = pair !== null && entry.parentId === pair.id ? pair.id : null;
		const inPair = pairId !== null;
		const strips = inPair ? thirdStrips(entry.rect, direction) : crossStrips(entry.rect, direction);
		const [first, second] =
			sourceParent !== null && !(inPair && direction === "row") && tilePath(sourceParent, entry.tileId) !== null
				? trimStart(strips, direction, start)
				: strips;
		const target = (index: 0 | 1): IdTarget =>
			pairId === null
				?
					{
						kind: "wrap",
						tileId: entry.tileId,
						direction,
						index,
					}
				:
					{
						kind: "split",
						stackId: pairId,
						direction,
						index,
					};
		zones.push(
			{
				kind: "target",
				rect: first,
				target: target(0),
			},
			{
				kind: "target",
				rect: second,
				target: target(1),
			},
		);
	}
	const sourceRect = sourceParent === null ? undefined : rects.get(source);
	if (sourceParent !== null && sourceRect !== undefined)
	{
		const direction = perpendicular(sourceParent.direction);
		thirdStrips(sourceRect, direction).forEach((rect, index) =>
		{
			if (!contains(start, rect))
				zones.push(
					{
						kind: "target",
						rect,
						target:
						{
							kind: "split",
							stackId: sourceParent.id,
							direction,
							index,
						},
						ownStrip: true,
					},
				);
		});
	}
	const parentRect = sourceParent === null ? undefined : rects.get(sourceParent.id);
	if (sourceParent !== null && parentRect !== undefined && sourceParent.children.length > 1)
		zones.push(
			{
				kind: "rearrange",
				rect: parentRect,
				stackId: sourceParent.id,
				direction: sourceParent.direction,
			},
		);
	for (const {stack, rect, childRects} of stacks)
	{
		if ((sourceParent !== null && stack.id === sourceParent.id) || childRects.length === 0) continue;
		const row = stack.direction === "row";
		let from = row ? rect.left : rect.top;
		childRects.forEach((child, index) =>
		{
			const middle = row ? child.left + child.width / 2 : child.top + child.height / 2;
			zones.push(
				{
					kind: "target",
					rect: row
						? dropRect(from, rect.top, middle - from, rect.height)
						: dropRect(rect.left, from, rect.width, middle - from),
					target:
					{
						kind: "insert",
						stackId: stack.id,
						index,
					},
				},
			);
			from = middle;
		});
		zones.push(
			{
				kind: "target",
				rect: row
					? dropRect(from, rect.top, rect.right - from, rect.height)
					: dropRect(rect.left, from, rect.width, rect.bottom - from),
				target:
				{
					kind: "insert",
					stackId: stack.id,
					index: childRects.length,
				},
			},
		);
	}
	for (const entry of tiles)
	{
		if (entry.tileId === source || (sourceParent !== null && entry.parentId === sourceParent.id)) continue;
		const row = entry.parentDirection === "row";
		const {rect} = entry;
		zones.push(
			{
				kind: "target",
				rect: row
					? dropRect(rect.left, rect.top, rect.width / 2, rect.height)
					: dropRect(rect.left, rect.top, rect.width, rect.height / 2),
				target:
				{
					kind: "insert",
					stackId: entry.parentId,
					index: entry.indexInParent,
				},
			},
			{
				kind: "target",
				rect: row
					? dropRect(rect.left + rect.width / 2, rect.top, rect.width / 2, rect.height)
					: dropRect(rect.left, rect.top + rect.height / 2, rect.width, rect.height / 2),
				target:
				{
					kind: "insert",
					stackId: entry.parentId,
					index: entry.indexInParent + 1,
				},
			},
		);
	}

	// Upstream de-duplicates by resulting shape: no-ops and source-stack permutations go, and of the rest the zone with
	// the largest overlap with the root wins, except root splits, own strips and splits of the source's pair.
	const apply = (target: IdTarget) => applyIdTarget(root, source, target);
	const noOps = new Set<string>();
	if (sourceParent !== null && sourceParent.children.length > 1)
		for (let index = 0; index < sourceParent.children.length; index++)
			noOps.add(
				shapeKey(
					apply(
						{
							kind: "insert",
							stackId: sourceParent.id,
							index,
						},
					),
				),
			);
	noOps.add(shapeKey(asRoot(normalize(root))));
	const overlap = (rect: DropRect) =>
		Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left)) *
		Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
	const keepsAll = (
		zone: Extract<
			DropZone,
			{
				kind: "target";
			}
		>,
	) =>
		(zone.target.kind === "split" && zone.target.stackId === root.id) ||
		zone.ownStrip === true ||
		(zone.target.kind === "split" && zone.target.stackId === pair?.id);
	const groupOf = (
		zone: Extract<
			DropZone,
			{
				kind: "target";
			}
		>,
		key: string,
	) =>
		zone.target.kind === "insert" && sourceParent !== null && findStack(sourceParent, zone.target.stackId) !== null
			? `nested:${key}`
			: key;
	const best = new Map<
		string,
		Extract<
			DropZone,
			{
				kind: "target";
			}
		>
	>();
	for (const zone of zones)
	{
		if (zone.kind === "rearrange") continue;
		const key = shapeKey(apply(zone.target));
		if (noOps.has(key) || keepsAll(zone)) continue;
		const group = groupOf(zone, key);
		const current = best.get(group);
		if (current === undefined || overlap(zone.rect) > overlap(current.rect)) best.set(group, zone);
	}
	const taken = new Set<string>();
	const kept: DropZone[] = [];
	for (const zone of zones)
	{
		if (zone.kind === "rearrange")
		{
			kept.push(zone);
			continue;
		}
		const key = shapeKey(apply(zone.target));
		if (noOps.has(key)) continue;
		if (keepsAll(zone))
		{
			kept.push(zone);
			continue;
		}
		const group = groupOf(zone, key);
		if (best.get(group) === zone && !taken.has(group))
		{
			taken.add(group);
			kept.push(zone);
		}
	}
	if (fullHeight.size === 0) return kept;
	return kept.filter((zone) =>
	{
		if (zone.kind === "rearrange") return true;
		const next = withoutIds(apply(zone.target));
		return ![...fullHeight].some((id) => inMultiChildColumn(next, id));
	});
}

/**
 * Upstream `k`: what a drag of `tileId` does with the pointer at `point`, given each tile's and stack's rect
 * (`stackRectKey`) and the drag's start, all in tile-container space. Inside the source's own stack, crossing a
 * sibling's midpoint reorders it live. `fullHeightTileIds` (upstream `tile.fullHeight`; no session tile sets it)
 * never lands in a multi-child column.
 */
export function resolveTileDrop(
	root: StackNode,
	tileId: TileId,
	rects: ReadonlyMap<string, DropRect>,
	point: DropPoint,
	start: DropPoint,
	fullHeightTileIds: ReadonlySet<TileId> = new Set(),
): TileDropResolution
{
	const none: TileDropResolution =
	{
		kind: "none",
	};
	if (Math.hypot(point.x - start.x, point.y - start.y) < FEEDBACK_THRESHOLD_PX) return none;
	const tree = withIds(root);
	const zones = dropZones(tree, tileId, rects, start, fullHeightTileIds);
	const zone = zones?.find((candidate) => contains(point, candidate.rect));
	if (zones === null || zone === undefined) return none;
	if (zone.kind === "target")
		return {
			kind: "drop",
			target: fromIdTarget(zone.target),
			root: withoutIds(applyIdTarget(tree, tileId, zone.target)),
		};
	const parent = findStack(tree, zone.stackId);
	const from = parent?.children.findIndex((child) => child.kind === "tile" && child.tileId === tileId) ?? -1;
	if (parent === null || from < 0) return none;
	const row = zone.direction === "row";
	const along = row ? point.x : point.y;
	let to = from;
	parent.children.forEach((child, index) =>
	{
		if (index === from) return;
		const rect = rects.get(nodeId(child));
		if (rect === undefined) return;
		const middle = row ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
		if (from > index && along < middle) to = Math.min(to, index);
		if (from < index && along > middle) to = Math.max(to, index);
	});
	if (to !== from)
		return {
			kind: "rearrange",
			root: withoutIds(
				applyIdTarget(
					tree,
					tileId,
					{
						kind: "insert",
						stackId: zone.stackId,
						index: to,
					},
				),
			),
		};
	const nested = zones.find(
		(candidate) =>
			candidate.kind === "target" &&
			candidate.target.kind === "insert" &&
			contains(point, candidate.rect) &&
			findStack(parent, candidate.target.stackId) !== null,
	);
	if (nested?.kind !== "target") return none;
	return {
		kind: "drop",
		target: fromIdTarget(nested.target),
		root: withoutIds(applyIdTarget(tree, tileId, nested.target)),
	};
}

export type KeyboardPreviewSide = "left" | "right" | "up" | "down";

export type KeyboardTileMove =
	|
	  {
			kind: "preview";
			target: TileDropTarget;
			side: KeyboardPreviewSide;
	  }
	|
	  {
			kind: "insert";
			target: TileDropTarget;
			position: number;
			total: number;
	  }
	| null;

/** Upstream `ke`: the keys the Move grip handles. */
export const KEYBOARD_MOVE_KEYS: ReadonlySet<string> = new Set([
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
]);

/**
 * Upstream's Move grip keys: arrows, Home and End along the tile's stack insert it at once; perpendicular arrows
 * preview a split of the whole parent stack. Null for any other key or a move that goes nowhere.
 */
export function keyboardTileMove(root: StackNode, tileId: TileId, key: string, rtl = false): KeyboardTileMove
{
	if (!KEYBOARD_MOVE_KEYS.has(key)) return null;
	const path = tilePath(root, tileId);
	const index = path?.at(-1);
	if (path === null || index === undefined) return null;
	const parentPath = path.slice(0, -1);
	let parent: LayoutNode = root;
	for (const at of parentPath)
	{
		const child: LayoutNode | undefined = parent.kind === "stack" ? parent.children[at] : undefined;
		if (child === undefined) return null;
		parent = child;
	}
	if (parent.kind !== "stack") return null;
	const row = parent.direction === "row";
	const split = (at: number): TileDropTarget => (
	{
		kind: "split",
		stackPath: parentPath,
		direction: perpendicular(parent.direction),
		index: at,
	});
	const preview = (at: number, side: KeyboardPreviewSide): KeyboardTileMove => (
	{
		kind: "preview",
		target: split(at),
		side,
	});
	if (!row && key === "ArrowLeft") return preview(rtl ? 1 : 0, "left");
	if (!row && key === "ArrowRight") return preview(rtl ? 0 : 1, "right");
	if (row && key === "ArrowUp") return preview(0, "up");
	if (row && key === "ArrowDown") return preview(1, "down");
	const last = parent.children.length - 1;
	const wanted =
		key === "Home"
			? 0
			: key === "End"
				? last
				: key === "ArrowUp" || (key === "ArrowLeft" && !rtl) || (key === "ArrowRight" && rtl)
					? index - 1
					: index + 1;
	const to = clamp(wanted, 0, last);
	if (to === index) return null;
	return {
		kind: "insert",
		target:
		{
			kind: "insert",
			stackPath: parentPath,
			index: to,
		},
		position: to + 1,
		total: last + 1,
	};
}

export type DropEdgePosition = "main-start" | "main-end" | "cross-start" | "cross-end";
export type DropEdge = "left" | "right" | "top" | "bottom";

/** Upstream `Ke`: a stack-relative indicator position as a physical edge, mirrored in RTL. */
export function dropIndicatorEdge(position: DropEdgePosition, direction: Direction, rtl = false): DropEdge
{
	const main = position === "main-start" || position === "main-end";
	const start = position === "main-start" || position === "cross-start";
	if ((direction === "row") === main) return start === rtl ? "right" : "left";
	return start ? "top" : "bottom";
}

function samePath(a: readonly number[], b: readonly number[]): boolean
{
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Upstream stack `ct`'s feedback: the divider before child `dividerIndex + 1` lights for an insert (or a same-direction
 * split) between children; an insert at either end, or a perpendicular split, draws an edge indicator.
 */
export function stackDropFeedback(
	stack: StackNode,
	path: readonly number[],
	target: TileDropTarget | null,
	rtl = false,
):
{
	dividerIndex: number | null;
	edge: DropEdge | null;
}
{
	if (target === null || target.kind === "wrap" || !samePath(target.stackPath, path))
		return {
			dividerIndex: null,
			edge: null,
		};
	const along = target.kind === "insert" || target.direction === stack.direction ? target.index : null;
	const position: DropEdgePosition | null =
		along === null
			? target.index === 0
				? "cross-start"
				: "cross-end"
			: along === 0
				? "main-start"
				: along === stack.children.length
					? "main-end"
					: null;
	return {
		dividerIndex: along !== null && position === null ? along - 1 : null,
		edge: position === null ? null : dropIndicatorEdge(position, stack.direction, rtl),
	};
}

/** Upstream tile `Q`'s wrap indicator: the edge of `tileId` a wrap target draws on, or null. */
export function wrapDropEdge(tileId: TileId, target: TileDropTarget | null, rtl = false): DropEdge | null
{
	if (target?.kind !== "wrap" || target.tileId !== tileId) return null;
	return dropIndicatorEdge(target.index === 0 ? "main-start" : "main-end", target.direction, rtl);
}

/** Which edges of the tile container the node at `path` reaches (upstream's `atEdge`). */
export function touchesContainerEdge(root: StackNode, path: readonly number[]): Record<DropEdge, boolean>
{
	const edges =
	{
		left: true,
		right: true,
		top: true,
		bottom: true,
	};
	let node: LayoutNode | undefined = root;
	for (const index of path)
	{
		if (node?.kind !== "stack") break;
		const last: number = node.children.length - 1;
		if (node.direction === "row")
		{
			edges.left &&= index === 0;
			edges.right &&= index === last;
		}
		else
		{
			edges.top &&= index === 0;
			edges.bottom &&= index === last;
		}
		node = node.children[index];
	}
	return edges;
}

/** Upstream `Z` in line mode: half the 1px gap outside the node, or flush on a container edge. */
export function dropIndicatorOutset(root: StackNode, path: readonly number[], edge: DropEdge): number
{
	return touchesContainerEdge(root, path)[edge] ? 0 : LINE_GAP_HALF_PX;
}
