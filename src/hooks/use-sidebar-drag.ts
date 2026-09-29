import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  autoScrollDelta,
  computeMidpoints,
  exceedsDragThreshold,
  shiftFor,
  slotFromPointer,
} from "../lib/sidebar-drag";

/**
 * Shared sidebar pointer-drag engine (pinning, reordering, custom groups), ported from
 * the claude.ai/code sidebar: a 4px threshold, a ghost clone that follows the pointer,
 * translateY shifts on `[data-drag-id]` rows, midpoint slots, edge auto-scroll, Escape
 * to cancel, and `[data-session-dragging]` on the root element while dragging.
 */

export type SidebarDropTarget =
  | { readonly type: "slot"; readonly listId: string; readonly slot: number }
  | { readonly type: "zone"; readonly zoneId: string };

export interface SidebarDrop {
  readonly srcId: string;
  readonly target: SidebarDropTarget;
}

export interface SidebarDragState {
  readonly srcId: string;
  readonly target: SidebarDropTarget | null;
}

export interface UseSidebarDragOptions {
  readonly onDrop: (drop: SidebarDrop) => void;
  /** Scrollable container that auto-scrolls when the pointer nears its edges. */
  readonly getScrollContainer?: () => HTMLElement | null;
  /** Element that carries `data-session-dragging`; defaults to `<html>`. */
  readonly getRoot?: () => HTMLElement | null;
  /** Parent for the ghost clone; defaults to `<body>`. */
  readonly getGhostContainer?: () => HTMLElement | null;
  /** Gap (px) between rows, added to the source row height to get the shift step. */
  readonly rowGap?: number;
}

export interface SidebarDragRowProps {
  readonly "data-drag-id": string;
  readonly draggable: false;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface UseSidebarDrag {
  readonly drag: SidebarDragState | null;
  readonly rowProps: (id: string) => SidebarDragRowProps;
  /** Ref for a list container; its `[data-drag-id]` descendants are slot rows in DOM order. */
  readonly listRef: (listId: string) => (element: HTMLElement | null) => void;
  /** Ref for a drop zone (a header or drop row); zones win over list slots. */
  readonly zoneRef: (zoneId: string) => (element: HTMLElement | null) => void;
}

const IGNORED_POINTERDOWN = "input, textarea, select, [data-row-action]";
const ROW_SELECTOR = "[data-drag-id]";

interface ListMeasure {
  readonly rows: readonly HTMLElement[];
  /** Row midpoints relative to the list's top edge, measured before any shift. */
  readonly offsets: readonly number[];
}

interface Pending {
  readonly srcId: string;
  readonly srcEl: HTMLElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
}

interface Active extends Pending {
  readonly ghost: HTMLElement;
  readonly rowStep: number;
  readonly measures: Map<HTMLElement, ListMeasure>;
  readonly shifted: Set<HTMLElement>;
  pointerX: number;
  pointerY: number;
  target: SidebarDropTarget | null;
  frame: number | null;
}

function contains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function sameTarget(a: SidebarDropTarget | null, b: SidebarDropTarget | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.type === "slot" && b.type === "slot") {
    return a.listId === b.listId && a.slot === b.slot;
  }
  if (a.type === "zone" && b.type === "zone") {
    return a.zoneId === b.zoneId;
  }
  return false;
}

function measureList(list: HTMLElement): ListMeasure {
  const rows = [...list.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const listTop = list.getBoundingClientRect().top;
  const midpoints = computeMidpoints(rows.map((row) => row.getBoundingClientRect()));
  return { rows, offsets: midpoints.map((midpoint) => midpoint - listTop) };
}

function createGhost(srcEl: HTMLElement, container: HTMLElement): HTMLElement {
  const rect = srcEl.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-drag-id");
  ghost.removeAttribute("id");
  ghost.setAttribute("data-drag-ghost", "");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "50",
    visibility: "visible",
    transform: "",
  });
  container.append(ghost);
  return ghost;
}

export function useSidebarDrag(options: UseSidebarDragOptions): UseSidebarDrag {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [drag, setDrag] = useState<SidebarDragState | null>(null);
  const lists = useRef(new Map<string, HTMLElement>());
  const zones = useRef(new Map<string, HTMLElement>());
  const listRefs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const zoneRefs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const pending = useRef<Pending | null>(null);
  const active = useRef<Active | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const resolveTarget = useCallback((state: Active): SidebarDropTarget | null => {
    const { pointerX: x, pointerY: y } = state;
    for (const [zoneId, zone] of zones.current) {
      if (contains(zone.getBoundingClientRect(), x, y)) {
        return { type: "zone", zoneId };
      }
    }
    for (const [listId, list] of lists.current) {
      const listRect = list.getBoundingClientRect();
      if (!contains(listRect, x, y)) {
        continue;
      }
      let measure = state.measures.get(list);
      if (measure === undefined) {
        measure = measureList(list);
        state.measures.set(list, measure);
      }
      const srcIdx = measure.rows.indexOf(state.srcEl);
      const midpoints = measure.offsets.map((offset) => listRect.top + offset);
      const slot = slotFromPointer(midpoints, y, srcIdx === -1 ? null : srcIdx);
      return slot === null ? null : { type: "slot", listId, slot };
    }
    return null;
  }, []);

  const applyShifts = useCallback((state: Active) => {
    const next = new Map<HTMLElement, number>();
    const { target } = state;
    if (target?.type === "slot") {
      const list = lists.current.get(target.listId);
      const measure = list === undefined ? undefined : state.measures.get(list);
      if (measure !== undefined) {
        const srcIdx = measure.rows.indexOf(state.srcEl);
        measure.rows.forEach((row, index) => {
          const shift = shiftFor(index, srcIdx === -1 ? null : srcIdx, target.slot, state.rowStep);
          if (shift !== 0) {
            next.set(row, shift);
          }
        });
      }
    }
    for (const row of state.shifted) {
      if (!next.has(row)) {
        row.style.transform = "";
        state.shifted.delete(row);
      }
    }
    for (const [row, shift] of next) {
      row.style.transform = `translateY(${shift}px)`;
      state.shifted.add(row);
    }
  }, []);

  const update = useCallback(
    (state: Active) => {
      state.ghost.style.transform = `translate(${state.pointerX - state.startX}px, ${state.pointerY - state.startY}px)`;
      const target = resolveTarget(state);
      if (sameTarget(target, state.target)) {
        return;
      }
      state.target = target;
      applyShifts(state);
      setDrag({ srcId: state.srcId, target });
    },
    [applyShifts, resolveTarget],
  );

  const autoScroll = useCallback(
    (state: Active) => {
      state.frame = null;
      const container = optionsRef.current.getScrollContainer?.();
      if (container == null || active.current !== state) {
        return;
      }
      const delta = autoScrollDelta(state.pointerY, container.getBoundingClientRect());
      if (delta === 0) {
        return;
      }
      container.scrollTop += delta;
      update(state);
      state.frame = requestAnimationFrame(() => autoScroll(state));
    },
    [update],
  );

  const finish = useCallback((drop: boolean) => {
    const state = active.current;
    pending.current = null;
    active.current = null;
    detach.current?.();
    detach.current = null;
    if (state === null) {
      return;
    }
    if (state.frame !== null) {
      cancelAnimationFrame(state.frame);
    }
    for (const row of state.shifted) {
      row.style.transform = "";
    }
    state.ghost.remove();
    state.srcEl.style.visibility = "";
    (optionsRef.current.getRoot?.() ?? document.documentElement).removeAttribute(
      "data-session-dragging",
    );
    setDrag(null);

    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", suppressClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", suppressClick, { capture: true }), 0);

    if (drop && state.target !== null) {
      optionsRef.current.onDrop({ srcId: state.srcId, target: state.target });
    }
  }, []);

  const start = useCallback(
    (from: Pending, x: number, y: number) => {
      const opts = optionsRef.current;
      const ghost = createGhost(from.srcEl, opts.getGhostContainer?.() ?? document.body);
      const state: Active = {
        ...from,
        ghost,
        rowStep: from.srcEl.getBoundingClientRect().height + (opts.rowGap ?? 1),
        measures: new Map(),
        shifted: new Set(),
        pointerX: x,
        pointerY: y,
        target: null,
        frame: null,
      };
      pending.current = null;
      active.current = state;
      from.srcEl.style.visibility = "hidden";
      (opts.getRoot?.() ?? document.documentElement).setAttribute("data-session-dragging", "");
      setDrag({ srcId: from.srcId, target: null });
      update(state);
      return state;
    },
    [update],
  );

  const attach = useCallback(() => {
    const onMove = (event: PointerEvent) => {
      const from = pending.current;
      let state = active.current;
      if (state === null && from !== null && event.pointerId === from.pointerId) {
        if (!exceedsDragThreshold(event.clientX - from.startX, event.clientY - from.startY)) {
          return;
        }
        state = start(from, event.clientX, event.clientY);
      }
      if (state === null || event.pointerId !== state.pointerId) {
        return;
      }
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      update(state);
      if (state.frame === null) {
        state.frame = requestAnimationFrame(() => autoScroll(state));
      }
    };
    const onUp = (event: PointerEvent) => {
      const owner = active.current ?? pending.current;
      if (owner !== null && event.pointerId !== owner.pointerId) {
        return;
      }
      if (active.current === null) {
        pending.current = null;
        detach.current?.();
        detach.current = null;
        return;
      }
      finish(true);
    };
    const onCancel = () => finish(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current !== null) {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [autoScroll, finish, start, update]);

  useEffect(() => () => finish(false), [finish]);

  const rowProps = useCallback(
    (id: string): SidebarDragRowProps => ({
      "data-drag-id": id,
      draggable: false,
      onPointerDown: (event) => {
        if (event.button !== 0 || active.current !== null || pending.current !== null) {
          return;
        }
        if (event.target instanceof Element && event.target.closest(IGNORED_POINTERDOWN)) {
          return;
        }
        pending.current = {
          srcId: id,
          srcEl: event.currentTarget,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
        };
        attach();
      },
    }),
    [attach],
  );

  const listRef = useCallback((listId: string) => {
    let ref = listRefs.current.get(listId);
    if (ref === undefined) {
      ref = (element) => {
        if (element === null) {
          lists.current.delete(listId);
        } else {
          lists.current.set(listId, element);
        }
      };
      listRefs.current.set(listId, ref);
    }
    return ref;
  }, []);

  const zoneRef = useCallback((zoneId: string) => {
    let ref = zoneRefs.current.get(zoneId);
    if (ref === undefined) {
      ref = (element) => {
        if (element === null) {
          zones.current.delete(zoneId);
        } else {
          zones.current.set(zoneId, element);
        }
      };
      zoneRefs.current.set(zoneId, ref);
    }
    return ref;
  }, []);

  return { drag, rowProps, listRef, zoneRef };
}
