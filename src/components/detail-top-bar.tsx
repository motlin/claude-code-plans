import type { ReactNode } from "react";

interface DetailTopBarProps {
  children: ReactNode;
}

/**
 * A consistent top bar for detail pages (plan, session, project, memory).
 * Uses negative top-margin to sit on the same row as the ModeToggle rendered in __root.tsx.
 */
export function DetailTopBar({ children }: DetailTopBarProps) {
  return <div className="-mt-9 mb-4 flex min-h-9 items-center gap-2">{children}</div>;
}

const pillBase =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors no-underline";

export const pillStyles = {
  primary: `${pillBase} bg-surface-0 text-secondary hover:bg-fill-control`,
  outline: `${pillBase} border border-strong text-secondary hover:bg-surface-0`,
} as const;
