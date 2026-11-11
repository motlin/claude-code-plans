import type {ReactNode} from "react";
import {PaneHeaderRow} from "./pane-header-row";
import type {PaneChrome} from "./pane-registry";

/** The host's default header row, drawn for a custom-header pane while its own renderer is unavailable. */
export function PaneChromeHeader({title, chrome}: {title: string; chrome: PaneChrome}) {
	return (
		<PaneHeaderRow
			label={title}
			title={
				<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
					{title}
				</span>
			}
			actions={chrome.controls}
			moveHandle={chrome.moveHandle}
		/>
	);
}

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
			{chrome !== undefined && <PaneChromeHeader title={title} chrome={chrome} />}
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-body text-ink-muted">
				{children}
			</div>
		</>
	);
}
