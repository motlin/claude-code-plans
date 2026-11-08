import {X} from "lucide-react";
import type {ReactNode} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {GHOST_DISMISS_CLASS} from "./error-card-shell";

/*
 * Upstream's neutral surface (`$9.neutral`): surface-1 with the `--cds-banner-neutral-tint` (alpha-1)
 * layer. Under fizzy-lake `color` its `stacks:` overrides (`TP`) swap both for the page fill and ring
 * the card in `--cds-fizzy-lake-color-banner-line`.
 */
const SURFACE_CLASS = {
	fizzy: "bg-page shadow-card-ring text-primary [--card-ring-color:var(--banner-line)]",
	base: "bg-surface-1 bg-[linear-gradient(var(--color-alpha-1)_0_0)] shadow-card-ring text-primary",
};

/* Upstream's cds spacing, verbatim; the CSS density scope picks the values. */
const BODY_SPACING = "gap-y-sm gap-x-md";
/* `py-md`, and under fizzy-lake `panels` `py-[calc(var(--cds-pad-md)+2px)]`. */
const BLOCK_PADDING = {base: "py-md", panels: "py-[calc(var(--cds-pad-md)+2px)]"};

/** Upstream's composer start inset as `ih` maps it: `text` with no leading chin item, else `glyph`. */
export type ComposerKeyline = "glyph" | "text";

/* Upstream's keyline maps: the body offset (`jC`) and the Dismiss slot margin (`we`). */
const BODY_OFFSET: Record<ComposerKeyline, string> = {
	glyph: "ms-[6px] compact:ms-[6px] comfortable:ms-[4px]",
	text: "ms-[4px] compact:ms-[4px] comfortable:ms-[2px]",
};
const DISMISS_MARGIN: Record<ComposerKeyline, string> = {
	glyph: "-me-[4px]",
	text: "-me-[2px] compact:-me-[2px] comfortable:-me-[4px]",
};

/**
 * Upstream's cds `Banner` (shared-frame `ah`) for the neutral, no-details, no-action case that
 * the composer notice region's cards use: an icon slot and the body centred on the first line,
 * then an optional ghost Dismiss X. The region's list is the live region, so the card's role is
 * `none`. Dock cards always pass the composer's calibration (`rB()`), so this is `ah`'s keyline
 * branch: `px-md`, `rounded-composer`, the icon's `ms-[4px] -me-[4px]`, the keyline body offset
 * and Dismiss margin, and under fizzy-lake `panels` the pad-md+2px block padding and a `-me-[2px]`
 * Dismiss margin. `keyline` defaults to `glyph`, the local composer having a leading "+" button.
 */
export function NoticeBanner({
	icon,
	onDismiss,
	keyline = "glyph",
	"data-testid": testId,
	children,
}: {
	icon: ReactNode;
	onDismiss?: () => void;
	keyline?: ComposerKeyline;
	"data-testid"?: string;
	children: ReactNode;
}) {
	const color = useFizzyLake("color");
	const surface = color ? SURFACE_CLASS.fizzy : SURFACE_CLASS.base;
	const panels = useFizzyLake("panels");
	const py = panels ? BLOCK_PADDING.panels : BLOCK_PADDING.base;
	const dismiss = panels ? "-me-[2px]" : DISMISS_MARGIN[keyline];
	return (
		<div
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout="inline"
			data-action-align="first-line"
			data-composer-keyline={keyline}
			data-testid={testId}
			role="none"
			className={`flex items-start gap-xs ${py} font-sans text-body font-normal break-words px-md rounded-composer ${surface} @container`}
		>
			{icon !== null && (
				// Upstream `Se.neutral` is `stacks:text-secondary`: without fizzy color the icon inherits text-primary.
				<span
					className={`flex min-h-[1lh] shrink-0 items-center ms-[4px] -me-[4px]${color ? " text-secondary" : ""}`}
				>
					{icon}
				</span>
			)}
			<div className={`flex min-w-0 flex-wrap items-start ${BODY_SPACING} flex-1 ${BODY_OFFSET[keyline]}`}>
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
