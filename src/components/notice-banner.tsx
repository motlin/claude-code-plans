import {X} from "lucide-react";
import type {ReactNode} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {GHOST_DISMISS_CLASS} from "./error-card-shell";

/*
 * Upstream's neutral surface (`$9.neutral`); under fizzy-lake `color` its `stacks:` overrides
 * (`TP`) swap the surface-1 tint for the page fill inside the same hairline card ring.
 */
const SURFACE_CLASS = {
	fizzy: "bg-page shadow-card-ring text-primary",
	base: "bg-surface-1 shadow-card-ring text-primary",
};

/**
 * Upstream's cds `Banner` (shared-frame `ah`) for the neutral, no-details, no-action case that
 * the composer notice region's cards use: an icon slot and the body centred on the first line,
 * then an optional ghost Dismiss X. The region's list is the live region, so the card's role is
 * `none`. Spacing maps the default-density cds tokens (gap-xs 6, py-md 8, px-lg 12, gap-y-sm 8,
 * gap-x-md 12, the Dismiss slot's `-me-[calc(pad-md-2px)]` 6).
 */
export function NoticeBanner({
	icon,
	onDismiss,
	children,
}: {
	icon: ReactNode;
	onDismiss?: () => void;
	children: ReactNode;
}) {
	const surface = useFizzyLake("color") ? SURFACE_CLASS.fizzy : SURFACE_CLASS.base;
	return (
		<div
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout="inline"
			data-action-align="first-line"
			role="none"
			className={`flex items-start gap-1.5 py-2 font-sans text-body font-normal break-words px-3 rounded-card ${surface} @container`}
		>
			<span className="flex min-h-[1lh] shrink-0 items-center text-secondary">{icon}</span>
			<div className="flex min-w-0 flex-wrap items-start gap-y-2 gap-x-3 flex-1">
				<div className="max-w-full min-w-0 flex-auto">{children}</div>
			</div>
			{onDismiss !== undefined && (
				<span className="-me-1.5 flex h-[1lh] shrink-0 items-center">
					<button type="button" aria-label="Dismiss" className={GHOST_DISMISS_CLASS} onClick={onDismiss}>
						<X aria-hidden="true" className="size-4" />
					</button>
				</span>
			)}
		</div>
	);
}
