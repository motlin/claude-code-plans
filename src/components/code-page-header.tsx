import type {ReactNode} from "react";

/**
 * claude.ai/code's compact list-page header (Scheduled tasks, Artifacts, Projects): a 24/32 serif
 * title at y=32 (y=48 below sm, past the sidebar trigger), then a row with the tabs on the left and the toolbar right-aligned on it.
 */
export function CodePageHeader({
	title,
	tabs,
	toolbar,
	children,
}: {
	title: string;
	tabs?: ReactNode;
	toolbar?: ReactNode;
	/** Extras under the header, such as a live status line. */
	children?: ReactNode;
}) {
	return (
		<header className="flex flex-col pb-4 sm:-mt-1">
			<h1 className="min-w-0 font-voice text-[24px]/[32px] font-medium text-primary">{title}</h1>
			{(tabs !== undefined || toolbar !== undefined) && (
				<div className="mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
					{tabs}
					{toolbar !== undefined && (
						<div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
							{toolbar}
						</div>
					)}
				</div>
			)}
			{children}
		</header>
	);
}
