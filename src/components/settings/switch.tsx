import type { KeyboardEvent } from "react";

import { useSettingsRowIds } from "./settings-row";

/*
 * The claude.ai/code Switch: a 36×20 track with 2px padding and a 16px knob,
 * accent fill when on. A focusable span with role=switch; Space and Enter
 * toggle it. Inside a SettingsRow it is labelled by the row title.
 */

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SwitchProps) {
  const row = useSettingsRowIds();
  const labelledBy = ariaLabel === undefined ? (ariaLabelledBy ?? row?.titleId) : undefined;

  const toggle = () => {
    if (!disabled) onCheckedChange(!checked);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <span
      role="switch"
      tabIndex={disabled ? -1 : 0}
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      data-checked={checked ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full p-[2px] outline-none transition-colors bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 focus-visible:ring-2 focus-visible:ring-accent-100/40"
    >
      <span
        aria-hidden="true"
        className={`block size-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </span>
  );
}
