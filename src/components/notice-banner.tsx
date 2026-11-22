import {X} from "lucide-react";
import {type ReactNode, useLayoutEffect, useRef, useState} from "react";

import {CDS_GHOST_HOVER} from "./ui/cds-button";
import {NOTICE_SURFACE_CLASS} from "./notice-banner-classes";

/* Upstream's cds spacing, verbatim; the CSS density scope picks the values. */
const BODY_GAP_X = "gap-x-md";

/** Upstream's composer start inset as `ih` maps it: `text` with no leading chin item, else `glyph`. */
export type ComposerKeyline = "glyph" | "text";

/* Upstream's keyline body offset (`jC`); the current `ah` has no density variants. */
const BODY_OFFSET: Record<ComposerKeyline, string> =
{
	glyph: "ms-[4px]",
	text: "ms-[2px]",
};
/* The calibrated end margin (Dismiss slot `we`, Dismiss-less action) and the uncalibrated one (`b9`). */
const KEYLINE_END = "-me-[2px]";
const UNCALIBRATED_END = "-me-[calc(var(--cds-pad-md)-6px)]";
/* Upstream `k5`: the inline action is a control-high row centred on the first text line. */
const ACTION_INLINE = "min-h-[var(--cds-h-control)] my-[calc((1lh-var(--cds-h-control))/2)]";
/* Upstream `ki`: a stacked keyline card un-stacks only once the root grows this far past its stacking width. */
const UNSTACK_HYSTERESIS_PX = 64;

/*
 * Upstream Banner's Dismiss: a cds ghost iconOnly Button (`h-control aspect-square w-control px-0`, the cds
 * radius, `text-secondary`), 28px square with an 8px radius in the dock's comfortable scope.
 */
const DISMISS_CLASS = `inline-flex h-control w-control aspect-square shrink-0 cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] px-0 text-secondary transition-colors ${CDS_GHOST_HOVER} hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`;

type CtaLayout = "inline" | "wrapped" | "stacked";

function rootClass(keyline: ComposerKeyline | null, layout: CtaLayout, dismissible: boolean): string
{
	const calibrated = keyline !== null;
	const classes = [
		"flex items-start gap-xs",
		calibrated ? "py-[calc(var(--cds-pad-md)+2px)]" : "!py-lg",
		"font-sans text-body font-normal break-words",
		calibrated ? "px-md" : "px-lg",
	];
	if (layout === "stacked" && !dismissible) classes.push("pt-[calc(var(--cds-pad-md)-2px)]");
	if (layout === "wrapped") classes.push("pb-lg");
	classes.push(calibrated ? "rounded-composer" : "rounded-card");
	return classes.join(" ");
}

function actionClass(keyline: ComposerKeyline | null, layout: CtaLayout, dismissible: boolean): string
{
	const classes = ["flex shrink-0 items-center gap-xs"];
	if (layout === "inline") classes.push(ACTION_INLINE, "-ms-[2px]");
	else classes.push("max-w-full flex-wrap");
	if (layout === "stacked") classes.push("basis-full");
	if (!dismissible) classes.push(keyline === null ? UNCALIBRATED_END : KEYLINE_END);
	return classes.join(" ");
}

function bodyClass(keyline: ComposerKeyline | null, layout: CtaLayout, dismissible: boolean): string
{
	// Upstream appends gap-y-xs after gap-y-sm when stacked; one row gap keeps the winner deterministic.
	const classes = [
		"flex min-w-0 flex-wrap items-start",
		layout === "stacked" ? "gap-y-xs" : "gap-y-sm",
		BODY_GAP_X,
		"flex-1",
	];
	if (layout === "stacked" && !dismissible) classes.push("me-[2px]");
	if (keyline !== null) classes.push(BODY_OFFSET[keyline]);
	return classes.join(" ");
}

/**
 * Upstream `ah`'s CTA measurement: a ResizeObserver on the root marks the card wrapped when the
 * action's top sits more than half a text line below the text's top. A wrapped keyline card records
 * the root width and stacks; it un-stacks only once the root grows `ki` (64px) past that width.
 */
function useCtaLayout(hasAction: boolean, calibrated: boolean)
{
	const rootRef = useRef<HTMLDivElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const actionRef = useRef<HTMLSpanElement>(null);
	const stackedWidth = useRef(0);
	const [wrapped, setWrapped] = useState(false);
	const stacked = calibrated && hasAction && wrapped;
	useLayoutEffect(() =>
	{
		if (!calibrated || !hasAction) stackedWidth.current = 0;
		if (!hasAction) return undefined;
		const root = rootRef.current;
		const Observer = root?.ownerDocument.defaultView?.ResizeObserver;
		if (root === null || Observer === undefined) return undefined;
		const measure = () =>
		{
			if (stacked)
			{
				if (root.offsetWidth > stackedWidth.current + UNSTACK_HYSTERESIS_PX) setWrapped(false);
				return;
			}
			const text = textRef.current;
			const action = actionRef.current;
			if (text === null || action === null) return;
			const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
			if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
			const isWrapped = action.getBoundingClientRect().top - text.getBoundingClientRect().top > lineHeight / 2;
			if (isWrapped && calibrated) stackedWidth.current = root.offsetWidth;
			setWrapped(isWrapped);
		};
		measure();
		const observer = new Observer(measure);
		observer.observe(root);
		return () =>
		{
			observer.disconnect();
		};
	}, [hasAction, calibrated, stacked]);
	let layout: CtaLayout = "inline";
	if (stacked) layout = "stacked";
	else if (hasAction && wrapped) layout = "wrapped";
	return {
		rootRef,
		textRef,
		actionRef,
		layout,
	};
}

/**
 * Upstream's cds `Banner` (shared-frame `ah`), neutral and without details: an icon slot and the
 * body on the first line, an optional action after the body text, then an optional ghost Dismiss X.
 * Dock cards always pass the composer's calibration (`rB()`), so the default is `ah`'s keyline branch:
 * pad-md+2px block padding, `px-md`, `rounded-composer`, the icon's `ms-[4px] -me-[4px]`, the keyline
 * body offset and a `-me-[2px]` Dismiss margin. The current `ah` reads no fizzy-lake part or density.
 * `keyline` defaults to `glyph`, the local composer having a leading "+" button; `keyline={null}` is
 * the uncalibrated Banner outside the composer (`px-lg`, `rounded-card`, `!py-lg`, the `b9` end margin). The region's list is the live region, so the card's role defaults to `none`.
 * `data-cta-layout` is measured (`inline` / `wrapped` / keyline `stacked`, which hides the neutral icon).
 */
export function NoticeBanner({
	icon,
	action,
	onDismiss,
	keyline = "glyph",
	role = "none",
	"data-testid": testId,
	children,
}: {
	icon: ReactNode;
	action?: ReactNode;
	onDismiss?: () => void;
	keyline?: ComposerKeyline | null;
	role?: "none" | "status" | "alert";
	"data-testid"?: string;
	children: ReactNode;
})
{
	const hasAction = action !== undefined && action !== null && typeof action !== "boolean";
	const dismissible = onDismiss !== undefined;
	const {rootRef, textRef, actionRef, layout} = useCtaLayout(hasAction, keyline !== null);
	const dismiss = keyline === null ? UNCALIBRATED_END : KEYLINE_END;
	const iconOffset = keyline === null ? "" : " ms-[4px] -me-[4px]";
	return (
		<div
			ref={rootRef}
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout={layout}
			data-action-align="first-line"
			data-composer-keyline={keyline ?? undefined}
			data-testid={testId}
			role={role}
			className={`${rootClass(keyline, layout, dismissible)} ${NOTICE_SURFACE_CLASS} @container`}
		>
			{icon !== null && layout !== "stacked" && (
				// Upstream `Se.neutral` is `text-secondary`.
				<span className={`flex min-h-[1lh] shrink-0 items-center${iconOffset} text-secondary`}>{icon}</span>
			)}
			<div className={bodyClass(keyline, layout, dismissible)}>
				<div ref={textRef} className="max-w-full min-w-0 flex-auto">
					{children}
				</div>
				{hasAction && (
					<span ref={actionRef} className={actionClass(keyline, layout, dismissible)}>
						{action}
					</span>
				)}
			</div>
			{dismissible && (
				<span className={`${dismiss} flex h-[1lh] shrink-0 items-center`}>
					<button type="button" aria-label="Dismiss" className={DISMISS_CLASS} onClick={onDismiss}>
						<X aria-hidden="true" className="size-4" />
					</button>
				</span>
			)}
		</div>
	);
}
