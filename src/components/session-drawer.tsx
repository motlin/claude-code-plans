import { X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { useResizableWidth } from "../hooks/use-resizable-width";
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
  const resizeHandleProps = useResizableWidth({
    label: "Resize session drawer",
    min: MINIMUM_WIDTH,
    max: MAXIMUM_WIDTH,
    step: KEYBOARD_RESIZE_STEP,
    edge: "start",
    value: width,
    onChange: setWidth,
  });

  return (
    <aside
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-surface-0 text-primary shadow-xl"
      style={{ width }}
    >
      <div
        {...resizeHandleProps}
        aria-controls={bodyId}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none transition-colors hover:bg-accent-100/40 focus-visible:bg-accent-100/40 focus-visible:outline-none"
      />

      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h2>
        {headerContent}
        <span
          aria-label={
            coverageNote === undefined ? `${count} items` : `${count} items in the loaded messages`
          }
          className="rounded-full bg-fill-control px-2 py-0.5 text-xs font-medium text-secondary"
        >
          {formatResourceCount(count, unscannedRecordCount)}
        </span>
        <button
          type="button"
          aria-label={`Close ${title} drawer`}
          onClick={() => onClose()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-t6 transition-colors hover:bg-fill-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
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
            className="border-b border-border bg-fill-ghost-hover px-4 py-2 text-[11px] text-t6"
          >
            {coverageNote}
          </p>
        )}
        {children}
      </div>
    </aside>
  );
}
