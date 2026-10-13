import type {ReactNode} from "react";
import type {PaneChrome} from "./pane-registry";

/**
 * Keep host controls available while an optional renderer loads or cannot be downloaded. Panes that draw their own
 * header pass `chrome`; the host draws the header of the rest.
 */
export function DeferredPaneStatus({
	title,
	chrome,
	children,
}: {
	title: string;
	chrome: PaneChrome | undefined;
	children: ReactNode;
}) {
	return (
		<>
			{chrome !== undefined && (
				<div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
					<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
						{title}
					</span>
					{chrome.moveHandle}
					<div className="relative flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-body text-ink-muted">
				{children}
			</div>
		</>
	);
}
