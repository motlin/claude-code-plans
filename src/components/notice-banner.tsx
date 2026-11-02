import {X} from "lucide-react";
import type {ReactNode} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {GHOST_DISMISS_CLASS} from "./error-card-shell";
import {type Density, useScopeDensity} from "./ui/density-context";

/*
 * Upstream's neutral surface (`$9.neutral`); under fizzy-lake `color` its `stacks:` overrides
 * (`TP`) swap the surface-1 tint for the page fill inside the same hairline card ring.
 */
const SURFACE_CLASS = {
	fizzy: "bg-page shadow-card-ring text-primary",
	base: "bg-surface-1 shadow-card-ring text-primary",
};

interface BannerSizing {
	gap: string;
	py: string;
	panelsPy: string;
	px: string;
	body: string;
	dismiss: string;
	panelsDismiss: string;
}

/* Compact: pad-md 8, pad-lg 12, gap-xs 6, gap-sm 8, gap-md 12. Comfortable: 12, 16, 8, 12, 16. */
const BANNER_DENSITY: Record<Density, BannerSizing> = {
	compact: {
		gap: "gap-1.5",
		py: "py-2",
		panelsPy: "py-3",
		px: "px-3",
		body: "gap-y-2 gap-x-3",
		dismiss: "-me-1.5",
		panelsDismiss: "-me-0.5",
	},
	comfortable: {
		gap: "gap-2",
		py: "py-3",
		panelsPy: "py-4",
		px: "px-4",
		body: "gap-y-3 gap-x-4",
		dismiss: "-me-2.5",
		panelsDismiss: "-me-1.5",
	},
};

/**
 * Upstream's cds `Banner` (shared-frame `ah`) for the neutral, no-details, no-action case that
 * the composer notice region's cards use: an icon slot and the body centred on the first line,
 * then an optional ghost Dismiss X. The region's list is the live region, so the card's role is
 * `none`. Spacing maps the scope's cds tokens: gap-xs, py-md, px-lg, gap-y-sm, gap-x-md and the
 * Dismiss slot's `-me-[calc(pad-md-2px)]` (`P9`). Under fizzy-lake `panels` upstream swaps in
 * `!py-lg` and the `-me-[calc(pad-md-6px)]` Dismiss margin (`b9`).
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
	const panels = useFizzyLake("panels");
	const sizing = BANNER_DENSITY[useScopeDensity()];
	const py = panels ? sizing.panelsPy : sizing.py;
	const dismiss = panels ? sizing.panelsDismiss : sizing.dismiss;
	return (
		<div
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout="inline"
			data-action-align="first-line"
			role="none"
			className={`flex items-start ${sizing.gap} ${py} font-sans text-body font-normal break-words ${sizing.px} rounded-card ${surface} @container`}
		>
			<span className="flex min-h-[1lh] shrink-0 items-center text-secondary">{icon}</span>
			<div className={`flex min-w-0 flex-wrap items-start ${sizing.body} flex-1`}>
				<div className="max-w-full min-w-0 flex-auto">{children}</div>
			</div>
			{onDismiss !== undefined && (
				<span className={`${dismiss} flex h-[1lh] shrink-0 items-center`}>
					<button type="button" aria-label="Dismiss" className={GHOST_DISMISS_CLASS} onClick={onDismiss}>
						<X aria-hidden="true" className="size-4" />
					</button>
				</span>
			)}
		</div>
	);
}
