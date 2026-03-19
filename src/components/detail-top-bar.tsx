import type {ReactNode} from 'react';

interface DetailTopBarProps {
	children: ReactNode;
}

/**
 * A consistent top bar for detail pages (plan, session, project, memory).
 * Uses negative top-margin to sit on the same row as the ModeToggle rendered in __root.tsx.
 */
export function DetailTopBar({children}: DetailTopBarProps) {
	return <div className="-mt-9 mb-4 flex min-h-9 items-center gap-2">{children}</div>;
}

const pillBase =
	'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors no-underline';

export const pillStyles = {
	primary: `${pillBase} bg-bg-200 text-text-200 hover:bg-bg-300/70`,
	outline: `${pillBase} border border-border-300/20 text-text-200 hover:bg-bg-200`,
} as const;
