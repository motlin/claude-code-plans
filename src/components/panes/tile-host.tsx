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
import { Maximize2, Minimize2, X } from "lucide-react";

import { useShortcut, useShortcutKeys } from "../../hooks/use-shortcut";
import {
  closePane,
  collapsePane,
  defaultPaneLayout,
  expandPane,
  focusPane,
  loadPaneLayout,
  minTileSize,
  movePane,
  openPane,
  resizeDivider,
  savePaneLayout,
  type Direction,
  type LayoutNode,
  type MoveDirection,
  type PaneKind,
  type PaneLayoutState,
  type StackNode,
  type TileId,
} from "../../lib/pane-layout";
import { Tooltip } from "../ui/tooltip";
import { type PaneDefinition, usePaneDefinitions } from "./pane-registry";

/** Upstream `--tiles-gap`, mirrored by the reducer's gap maths. */
const TILE_GAP_PX = 12;
const RESIZE_STEP_PX = 16;
const RESIZE_STEP_LARGE_PX = 64;
/**
 * Side tiles stick to the top of the page scroller (the transcript scrolls
 * `<main>`, not the chat tile), so they are sized to the viewport.
 */
const SIDE_SLOT_CLASSES = "sticky top-2 self-start h-[var(--tile-host-height,calc(100dvh-16px))]";

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

interface InternalHost {
  definitions: ReadonlyMap<PaneKind, PaneDefinition>;
  update: (fn: LayoutUpdate) => void;
  expanded: PaneKind | null;
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
): [PaneLayoutState, (fn: LayoutUpdate) => void] {
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
    setEntry({ sessionId, layout });
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
        return next === prev.layout ? prev : { sessionId, layout: next };
      }),
    [sessionId, definitions],
  );

  const current = entry.sessionId === sessionId ? entry.layout : defaultPaneLayout();
  const layout = useMemo(() => pruneUnregistered(current, definitions), [current, definitions]);
  return [layout, update];
}

function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
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
  isRoot,
  host,
}: {
  stack: StackNode;
  path: readonly number[];
  index: number;
  sizePx: number;
  stackRef: RefObject<HTMLDivElement | null>;
  isRoot: boolean;
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
            (((prefixFlex / total) * available + minTileSize(before, stack.direction)) /
              available) *
              100,
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
    host.update((state) => resizeDivider(state, { path, index, deltaPx, sizePx: measured }));
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
      } ${isRoot ? SIDE_SLOT_CLASSES : ""}`}
    >
      <span
        aria-hidden
        className={`rounded-full bg-fill-control opacity-0 transition-opacity duration-[120ms] group-hover/divider:opacity-100 group-focus-visible/divider:bg-accent-100 group-focus-visible/divider:opacity-100 group-active/divider:bg-fill-primary group-active/divider:opacity-100 ${
          isRow ? "h-14 w-[3px]" : "h-[3px] w-14"
        }`}
      />
    </div>
  );
}

const MOVE_KEYS: Readonly<Record<string, MoveDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};

function PaneSurface({
  kind,
  definition,
  host,
}: {
  kind: PaneKind;
  definition: PaneDefinition;
  host: InternalHost;
}) {
  const expandKeys = useShortcutKeys("expand_collapse_pane");
  const closeKeys = useShortcutKeys("close_pane");
  const isExpanded = host.expanded === kind;
  const moveHintId = `pane-move-hint-${kind}`;

  function onMoveKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const direction = MOVE_KEYS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    host.update((state) => movePane(state, kind, direction));
  }

  const moveHandle = isExpanded ? null : (
    <button
      type="button"
      aria-label="Move"
      aria-describedby={moveHintId}
      onKeyDown={onMoveKeyDown}
      className="group/move absolute top-0 left-1/2 flex h-4 w-11 -translate-x-1/2 cursor-move items-center justify-center outline-none"
    >
      <span className="h-[3px] w-8 rounded-full bg-fill-control opacity-0 transition-opacity group-hover/move:opacity-100 group-focus-visible/move:bg-accent-100 group-focus-visible/move:opacity-100" />
      <span id={moveHintId} className="sr-only">
        Arrow keys move the tile.
      </span>
    </button>
  );

  const controls = (
    <>
      <Tooltip content={isExpanded ? "Collapse" : "Expand"} shortcut={expandKeys.keys}>
        <button
          type="button"
          aria-label={isExpanded ? "Collapse" : "Expand"}
          aria-keyshortcuts={expandKeys.ariaKeyShortcuts}
          onClick={() =>
            host.update((state) => (isExpanded ? collapsePane(state) : expandPane(state, kind)))
          }
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
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
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
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
      aria-label={definition.title}
      className="relative isolate flex h-full min-w-0 flex-col rounded-card bg-surface-2 shadow-panel-sm"
    >
      {definition.header === "custom" ? (
        definition.render({ moveHandle, controls })
      ) : (
        <>
          <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
            <span data-pane-title className="truncate pl-1 text-body text-secondary select-none">
              {definition.title}
            </span>
            {moveHandle}
            <div className="relative flex shrink-0 items-center gap-0.5">{controls}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
            <div className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]">
              {definition.render({ moveHandle, controls })}
            </div>
          </div>
        </>
      )}
    </section>
  );
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
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const isRoot = path.length === 0;
  const sizePx = stack.direction === "row" ? size.width : size.height;

  const expandedDefinition =
    isRoot && host.expanded !== null ? host.definitions.get(host.expanded) : undefined;
  const items: ReactNode[] = [];
  if (expandedDefinition !== undefined && host.expanded !== null) {
    // Keep the chat tile mounted at the same key so the transcript survives expand/collapse.
    items.push(
      <ChatTile key="chat" hidden host={host}>
        {chat}
      </ChatTile>,
      <TileSlot
        key="overlay"
        tileId={host.expanded}
        host={host}
        className={`min-w-0 flex-1 ${SIDE_SLOT_CLASSES}`}
        data-pane-overlay
      >
        <PaneSurface kind={host.expanded} definition={expandedDefinition} host={host} />
      </TileSlot>,
    );
  } else {
    stack.children.forEach((child, index) => {
      if (index > 0) {
        items.push(
          <Divider
            key={`divider:${nodeKey(stack.children[index - 1] ?? child)}|${nodeKey(child)}`}
            stack={stack}
            path={path}
            index={index - 1}
            sizePx={sizePx}
            stackRef={ref}
            isRoot={isRoot}
            host={host}
          />,
        );
      }
      items.push(
        child.kind === "tile" && child.tileId === "chat" ? (
          <ChatTile key="chat" style={{ flex: `${child.flex} 1 0` }} host={host}>
            {chat}
          </ChatTile>
        ) : (
          <NodeView
            key={nodeKey(child)}
            node={child}
            path={[...path, index]}
            host={host}
            chat={chat}
            isRootChild={isRoot}
          />
        ),
      );
    });
  }

  return (
    <div
      ref={ref}
      data-tile-stack={stack.direction}
      className={`flex min-h-0 min-w-0 ${stack.direction === "row" ? "flex-row" : "h-full flex-col"} ${
        isRoot ? "items-start" : ""
      }`}
      style={isRoot ? undefined : { flex: `${stack.flex} 1 0` }}
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
  const style = { flex: `${node.flex} 1 0` };
  const slotClass = `min-h-0 min-w-0 ${isRootChild ? SIDE_SLOT_CLASSES : ""}`;
  if (node.kind === "stack") {
    return (
      <div className={`flex ${slotClass}`} style={style}>
        <StackView stack={node} path={path} host={host} chat={chat} />
      </div>
    );
  }
  const definition = isPaneKind(node.tileId) ? host.definitions.get(node.tileId) : undefined;
  if (definition === undefined || !isPaneKind(node.tileId)) return null;
  return (
    <TileSlot tileId={node.tileId} host={host} className={slotClass} style={style}>
      <PaneSurface kind={node.tileId} definition={definition} host={host} />
    </TileSlot>
  );
}

function TileSlot({
  tileId,
  host,
  className,
  style,
  hidden,
  children,
  ...data
}: {
  tileId: TileId;
  host: InternalHost;
  className?: string;
  style?: CSSProperties | undefined;
  hidden?: boolean;
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
      {...data}
    >
      {children}
    </div>
  );
}

function ChatTile({
  style,
  hidden = false,
  host,
  children,
}: {
  style?: CSSProperties;
  hidden?: boolean;
  host: InternalHost;
  children: ReactNode;
}) {
  return (
    <TileSlot tileId="chat" host={host} className="min-w-0" style={style} hidden={hidden}>
      {children}
    </TileSlot>
  );
}

/**
 * Session tiling pane host modelled on claude.ai/code: the chat tile plus the
 * registered side panes laid out by the pure reducers in `lib/pane-layout`.
 * ⌘\ closes the focused pane; ⇧⌘\ expands or collapses it, falling back to
 * `onExpandWithoutPane` when no pane is open.
 */
export function TileHost({
  sessionId,
  onExpandWithoutPane,
  children,
}: {
  sessionId: string;
  onExpandWithoutPane?: () => void;
  children: ReactNode;
}) {
  const definitions = usePaneDefinitions();
  const [layout, update] = usePersistedLayout(sessionId, definitions);
  const openKinds = useMemo(() => tileIdsOf(layout.root).filter(isPaneKind), [layout.root]);

  const internal = useMemo<InternalHost>(
    () => ({ definitions, update, expanded: layout.expanded }),
    [definitions, update, layout.expanded],
  );

  const api = useMemo<PaneHostApi>(
    () => ({
      layout,
      isOpen: (kind) => openKinds.includes(kind),
      openPane: (kind) => update((state) => openPane(state, kind)),
      closePane: (kind) => update((state) => closePane(state, kind)),
      togglePane: (kind) =>
        update((state) =>
          tileIdsOf(state.root).includes(kind) ? closePane(state, kind) : openPane(state, kind),
        ),
    }),
    [layout, openKinds, update],
  );

  useShortcut("close_pane", () => {
    if (!isPaneKind(layout.focused)) return false;
    const focused = layout.focused;
    update((state) => closePane(state, focused));
    return true;
  });

  useShortcut("expand_collapse_pane", () => {
    if (layout.expanded !== null) {
      update(collapsePane);
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
