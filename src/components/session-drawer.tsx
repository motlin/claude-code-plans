import { X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { formatResourceCount, resourceCoverageNote } from "../lib/session-resources";

const DEFAULT_WIDTH = 360;
const MINIMUM_WIDTH = 280;
const MAXIMUM_WIDTH = 720;
const KEYBOARD_RESIZE_STEP = 10;

interface SessionDrawerProps {
  title: string;
  count: number;
  /** JSONL records before the loaded window, which `count` never saw. */
  unscannedRecordCount?: number;
  onClose: () => void;
  headerContent?: ReactNode;
  children: ReactNode;
}

interface ActiveResize {
  pointerId: number;
  resizeHandle: HTMLDivElement;
  startingClientX: number;
  startingWidth: number;
}

function clampWidth(width: number): number {
  return Math.min(MAXIMUM_WIDTH, Math.max(MINIMUM_WIDTH, width));
}

export function SessionDrawer({
  title,
  count,
  unscannedRecordCount = 0,
  onClose,
  headerContent,
  children,
}: SessionDrawerProps) {
  const coverageNote = resourceCoverageNote(unscannedRecordCount);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const titleId = useId();
  const bodyId = useId();
  const activeResizeReference = useRef<ActiveResize>(null);

  useEffect(() => {
    return () => {
      const activeResize = activeResizeReference.current;
      if (activeResize?.resizeHandle.hasPointerCapture(activeResize.pointerId)) {
        activeResize.resizeHandle.releasePointerCapture(activeResize.pointerId);
      }
      activeResizeReference.current = null;
    };
  }, []);

  function finishResize(pointerId: number, resizeHandle: HTMLDivElement): void {
    if (activeResizeReference.current?.pointerId !== pointerId) return;

    activeResizeReference.current = null;
    if (resizeHandle.hasPointerCapture(pointerId)) {
      resizeHandle.releasePointerCapture(pointerId);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activeResizeReference.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResizeReference.current = {
      pointerId: event.pointerId,
      resizeHandle: event.currentTarget,
      startingClientX: event.clientX,
      startingWidth: width,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeResize = activeResizeReference.current;
    if (activeResize?.pointerId !== event.pointerId) return;

    const distance = activeResize.startingClientX - event.clientX;
    setWidth(clampWidth(activeResize.startingWidth + distance));
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidth((currentWidth) => clampWidth(currentWidth + KEYBOARD_RESIZE_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidth((currentWidth) => clampWidth(currentWidth - KEYBOARD_RESIZE_STEP));
    } else if (event.key === "Home") {
      event.preventDefault();
      setWidth(MINIMUM_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setWidth(MAXIMUM_WIDTH);
    }
  }

  return (
    <aside
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border-300/15 bg-bg-200 text-text-100 shadow-xl"
      style={{ width }}
    >
      <div
        role="separator"
        aria-label="Resize session drawer"
        aria-controls={bodyId}
        aria-orientation="vertical"
        aria-valuemin={MINIMUM_WIDTH}
        aria-valuemax={MAXIMUM_WIDTH}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        tabIndex={0}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none transition-colors hover:bg-accent-100/40 focus-visible:bg-accent-100/40 focus-visible:outline-none"
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishResize(event.pointerId, event.currentTarget)}
        onPointerCancel={(event) => finishResize(event.pointerId, event.currentTarget)}
        onLostPointerCapture={(event) => {
          if (activeResizeReference.current?.pointerId === event.pointerId) {
            activeResizeReference.current = null;
          }
        }}
      />

      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border-300/15 px-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h2>
        {headerContent}
        <span
          aria-label={
            coverageNote === undefined ? `${count} items` : `${count} items in the loaded messages`
          }
          className="rounded-full bg-bg-300 px-2 py-0.5 text-xs font-medium text-text-300"
        >
          {formatResourceCount(count, unscannedRecordCount)}
        </span>
        <button
          type="button"
          aria-label={`Close ${title} drawer`}
          onClick={() => onClose()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-300/70 hover:text-text-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div
        id={bodyId}
        role="region"
        aria-label={`${title} contents`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {coverageNote !== undefined && (
          <p
            role="note"
            className="border-b border-border-300/15 bg-bg-300/40 px-4 py-2 text-[11px] text-text-400"
          >
            {coverageNote}
          </p>
        )}
        {children}
      </div>
    </aside>
  );
}
