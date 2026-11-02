import type {ReactNode} from "react";

import {isStaleChunkError} from "../../lib/stale-chunk-reload";
import {ApprovalActionButton} from "../approval-card";
import {RenderErrorBoundary} from "../render-error-boundary";
import {PanePlaceholder} from "./pane-placeholder";

function reportPaneCrash(error: unknown)
{
	console.error("[side-pane]", error);
}

/**
 * Upstream `eB`: when the crash fallback goes away (Try again) while keyboard focus was on it and focus
 * then falls to the body, focus the fresh fallback's button, or else the pane body container.
 */
function handOffFocus(element: HTMLDivElement | null)
{
	if (element === null) return undefined;
	return () =>
	{
		const parent = element.parentElement;
		const document = element.ownerDocument;
		const active = document.activeElement;
		if (parent === null || active === null || !element.contains(active) || !active.matches(":focus-visible"))
			return;
		queueMicrotask(() =>
		{
			if (document.activeElement !== document.body || !parent.isConnected) return;
			const button = parent.querySelector<HTMLElement>(":scope > [data-side-pane-crash] button");
			if (button !== null)
			{
				button.focus(
					{
						preventScroll: true,
					},
				);
				return;
			}
			if (!parent.hasAttribute("tabindex")) parent.tabIndex = -1;
			parent.focus(
				{
					preventScroll: true,
				},
			);
		});
	};
}

/**
 * Upstream's EpitaxySidePane boundary (`$z` over `yW`, fallback `tB`): a pane body render crash shows
 * "Something went wrong" + Try again in place of the body only, so the header stays usable. Stale-chunk
 * errors are rethrown for the chunk fallbacks above. A changed `resetKey` (another target) clears it.
 * Custom-header panes pass their `header`, drawn above the fallback.
 */
export function PaneCrashBoundary({
	resetKey,
	header,
	children,
}: {
	resetKey: string;
	header?: ReactNode;
	children: ReactNode;
})
{
	return (
		<RenderErrorBoundary
			resetOn={resetKey}
			report={reportPaneCrash}
			fallback={(error, reset) =>
			{
				if (isStaleChunkError(error)) throw error;
				const crash = (
					<div ref={handOffFocus} className="contents" data-side-pane-crash="">
						<PanePlaceholder
							role="alert"
							icon="Warning"
							title="Something went wrong"
							actions={
								<ApprovalActionButton variant="secondary" onClick={reset}>
									Try again
								</ApprovalActionButton>
							}
						/>
					</div>
				);
				if (header === undefined) return crash;
				return (
					<>
						{header}
						<div className="relative flex min-h-0 flex-1 flex-col">{crash}</div>
					</>
				);
			}}
		>
			{children}
		</RenderErrorBoundary>
	);
}
