import type {ReactNode} from "react";
import {Icon} from "../ui/icon";

/** Upstream cds secondary Button, size base. */
export const CUSTOMIZE_SECONDARY_BUTTON_CLASS =
	"inline-flex h-8 shrink-0 items-center px-3 rounded-r6 bg-fill-secondary shadow-field-drop text-body font-medium text-primary transition-colors hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream cds Notice `variant:"warning"`: glyph, message, then its action button. */
export function CustomizeWarningNotice({message, action}: {message: ReactNode; action: ReactNode})
{
	return (
		<div
			role="alert"
			className="flex items-start gap-2 rounded-card bg-[var(--upstream-bg-warning)] px-3 py-3 text-body text-upstream-warning shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--upstream-warning)_30%,transparent)]"
		>
			<Icon name="Warning" customSize={20} />
			<div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
				<div className="max-w-full min-w-0 flex-auto">{message}</div>
				{action}
			</div>
		</div>
	);
}

/** Neutral card for a list with nothing in it yet, or a view that is not built yet. */
export function CustomizeNotice({title, body}: {title: string; body: string})
{
	return (
		<div className="flex flex-col gap-1 rounded-card bg-fill-ghost-hover p-4">
			<h3 className="m-0 text-[15px]/[20px] font-[580] text-primary">{title}</h3>
			<p className="m-0 text-body text-secondary">{body}</p>
		</div>
	);
}

/** Upstream's 64px paper-plane Pictogram (line art in a 500×500 box). */
function PaperPlanePictogram()
{
	return (
		<svg
			width={64}
			height={64}
			viewBox="0 0 500 500"
			fill="none"
			stroke="currentColor"
			strokeWidth={14}
			strokeLinejoin="round"
			strokeLinecap="round"
		>
			<path d="M60 230 440 70 360 420 250 320Z" />
			<path d="M440 70 250 320 230 420 200 290Z" />
			<path d="M60 230 200 290" />
		</svg>
	);
}

interface FirstRunCardProps
{
	title: string;
	body: string;
	action: string;
	onAction: () => void;
}

/**
 * Upstream `tabbed-list-first-run` Card at comfortable density: neutral fill,
 * `p-lg` body, the copy and a primary Discover button beside the pictogram.
 */
export function CustomizeFirstRunCard({title, body, action, onAction}: FirstRunCardProps)
{
	return (
		<div
			data-testid="tabbed-list-first-run"
			className="flex shrink-0 flex-col rounded-card bg-fill-ghost-hover p-4"
		>
			<div className="flex items-center gap-7">
				<div className="flex min-w-0 flex-1 flex-col items-start gap-4">
					<div className="flex flex-col gap-2">
						<h3 className="m-0 text-[15px]/[20px] font-[580] text-primary">{title}</h3>
						<p className="m-0 text-body text-secondary">{body}</p>
					</div>
					<button
						type="button"
						onClick={onAction}
						className="inline-flex h-8 shrink-0 items-center rounded-r6 bg-fill-primary px-3 text-body font-medium text-on-primary transition-colors hover:bg-fill-primary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
					>
						{action}
					</button>
				</div>
				<div aria-hidden="true" className="hidden shrink-0 pe-6 text-primary sm:block">
					<PaperPlanePictogram />
				</div>
			</div>
		</div>
	);
}
