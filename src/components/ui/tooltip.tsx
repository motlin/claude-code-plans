import { cloneElement, type ReactElement, useEffect, useId, useRef, useState } from "react";

import { Shortcut } from "./shortcut";

const OPEN_DELAY_MS = 300;

const TOOLTIP_CLASS =
  "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 inline-flex min-h-6 max-w-[240px] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-sm";

/**
 * Minimal claude.ai/code tooltip: always dark, side top, offset 4, 300ms open
 * delay, with an optional text-variant shortcut after the label.
 */
export function Tooltip({
  content,
  shortcut,
  className,
  children,
}: {
  content: string;
  shortcut?: string;
  className?: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function show() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function hide() {
    clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span
      className={className ? `relative inline-flex ${className}` : "relative inline-flex"}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={hide}
    >
      {open ? cloneElement(children, { "aria-describedby": id }) : children}
      {open && (
        <span role="tooltip" id={id} className={TOOLTIP_CLASS}>
          {content}
          {shortcut !== undefined && (
            <Shortcut
              keys={shortcut}
              variant="text"
              className="text-[12px] [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]"
            />
          )}
        </span>
      )}
    </span>
  );
}
