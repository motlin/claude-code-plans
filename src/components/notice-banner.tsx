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

/* Upstream's cds spacing, verbatim; the CSS density scope picks the values. */
const ROW_SPACING = "gap-xs px-lg";
const BODY_SPACING = "gap-y-sm gap-x-md";
/* `P9` and, under fizzy-lake `panels`, `!py-lg` with `b9`. */
const SPACING = {
	base: {py: "py-md", dismiss: "-me-[calc(var(--cds-pad-md)-2px)]"},
	panels: {py: "!py-lg", dismiss: "-me-[calc(var(--cds-pad-md)-6px)]"},
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
	const {py, dismiss} = panels ? SPACING.panels : SPACING.base;
	return (
		<div
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout="inline"
			data-action-align="first-line"
			role="none"
			className={`flex items-start ${ROW_SPACING} ${py} font-sans text-body font-normal break-words rounded-card ${surface} @container`}
		>
			<span className="flex min-h-[1lh] shrink-0 items-center text-secondary">{icon}</span>
			<div className={`flex min-w-0 flex-wrap items-start ${BODY_SPACING} flex-1`}>
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
