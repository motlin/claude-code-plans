import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useSettingsRowIds } from "./settings-row";

/*
 * The claude.ai/code SegmentedControl: a 32px radiogroup on a 5%-alpha track
 * with 1px padding and radius 8, 30px radios at px 12 with radius 6, and a
 * sliding thumb (surface fill, inset border ring, 1px shadow) under the
 * checked radio. Arrow keys move both the checked radio and focus (roving
 * tabindex); Home/End jump to the ends.
 */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Render icons only; each radio is then named by its aria-label. */
  iconOnly?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

interface ThumbRect {
  left: number;
  width: number;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  iconOnly = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: SegmentedControlProps<T>) {
  const row = useSettingsRowIds();
  const radioRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [thumb, setThumb] = useState<ThumbRect | null>(null);
  const checkedIndex = options.findIndex((option) => option.value === value);

  const measure = useCallback(() => {
    const radio = radioRefs.current[checkedIndex];
    if (radio === undefined || radio === null || radio.offsetWidth === 0) {
      setThumb(null);
      return;
    }
    setThumb({ left: radio.offsetLeft, width: radio.offsetWidth });
  }, [checkedIndex]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const radio of radioRefs.current) {
      if (radio !== null) observer.observe(radio);
    }
    return () => observer.disconnect();
  }, [measure, options.length]);

  const select = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onValueChange(option.value);
    radioRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    const last = options.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case " ":
      case "Enter":
        next = index;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined ? row?.titleId : undefined}
      aria-describedby={ariaDescribedBy ?? row?.descriptionId}
      className="relative inline-flex h-8 w-fit shrink-0 items-stretch rounded-r6 bg-[var(--settings-segmented-track)] p-px font-sans"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-clip rounded-r6"
      >
        <div
          className="absolute top-px bottom-px left-0 rounded-[calc(var(--radius-r6)-1px)] bg-[var(--settings-segmented-thumb)] shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_0_rgb(0_0_0/0.05)] transition-[transform,width] duration-150 ease-out motion-reduce:transition-none"
          style={
            thumb === null
              ? { visibility: "hidden" }
              : { width: thumb.width, transform: `translateX(${thumb.left}px)` }
          }
        />
      </div>
      {options.map((option, index) => {
        const checked = index === checkedIndex;
        const focusable = checked || (checkedIndex === -1 && index === 0);
        return (
          <span
            key={option.value}
            ref={(element) => {
              radioRefs.current[index] = element;
            }}
            role="radio"
            tabIndex={focusable ? 0 : -1}
            aria-checked={checked}
            aria-label={iconOnly ? option.label : undefined}
            title={iconOnly ? option.label : undefined}
            data-checked={checked ? "" : undefined}
            onClick={() => select(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`relative z-[1] inline-flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-r5 text-body font-normal outline-none select-none transition-shadow hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-100/40 data-[checked]:text-primary text-[var(--settings-muted)] ${
              iconOnly ? "w-9 [&_svg]:size-4" : "px-3"
            }`}
          >
            {option.icon === undefined ? null : option.icon}
            {iconOnly ? null : option.label}
          </span>
        );
      })}
    </div>
  );
}
