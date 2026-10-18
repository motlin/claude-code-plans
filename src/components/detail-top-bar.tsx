import type {ReactNode} from "react";

interface DetailTopBarProps {
	children: ReactNode;
}

/**
 * A consistent top bar for detail pages (plan, session, project, memory).
 * Uses negative top-margin to sit on the same row as the header rendered in __root.tsx (48px below sm);
 * below sm it starts past the fixed Show-sidebar trigger so back links stay uncovered.
 */
export function DetailTopBar({children}: DetailTopBarProps) {
	return <div className="-mt-9 mb-4 flex min-h-9 items-center gap-2 max-sm:-mt-12 max-sm:ps-8">{children}</div>;
}
