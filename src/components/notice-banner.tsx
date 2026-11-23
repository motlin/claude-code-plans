import {X} from "lucide-react";
import {type ReactNode, useLayoutEffect, useRef, useState} from "react";

import {CDS_GHOST_HOVER} from "./ui/cds-button";
import {Icon} from "./ui/icon";
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
/* Upstream's inline action: a control-high row centred on the first text line, pushed to the end. */
const ACTION_INLINE = "min-h-control my-[calc((1lh-var(--cds-h-control))/2)] ms-auto";
/* Upstream's wrapped/stacked action lets its cds Buttons grow to wrap their label. */
const ACTION_CHILD_BUTTONS =
	"cds-child-Button:h-auto cds-child-Button:min-h-control cds-child-Button:shrink cds-child-Button:py-[calc((var(--cds-h-control)-1lh)/2)] cds-child-Button:text-balance cds-child-Button:wrap-anywhere cds-child-Button:whitespace-normal";

/* Upstream `ah`'s text column: an action caps it at 37.5rem; `[text-wrap:pretty]` is unconditional. */
const TEXT_WITH_ACTION = "min-w-0 flex-auto max-w-[min(100%,calc(37.5rem*var(--cds-rem-scale,1)))] [text-wrap:pretty]";
const TEXT_ALONE = "max-w-full min-w-0 flex-auto [text-wrap:pretty]";

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
	if (layout === "inline") classes.push(ACTION_INLINE);
	else
	{
		// A Dismiss beside the wrapped action lends it the control width it overhangs.
		classes.push(
			"flex-wrap",
			dismissible ? "max-w-[calc(100%+var(--cds-h-control))]" : "max-w-full",
			ACTION_CHILD_BUTTONS,
		);
	}
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
 * the widest root width it stacked at; growing past it locks the root's height and re-measures inline.
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
		const root = rootRef.current;
		if (!hasAction)
		{
			root?.style.removeProperty("min-height");
			return undefined;
		}
		const Observer = root?.ownerDocument.defaultView?.ResizeObserver;
		if (root === null || Observer === undefined) return undefined;
		/** Returns whether the card is (still) stacked, so the locked min-height must stay. */
		const measure = (): boolean =>
		{
			if (stacked)
			{
				const grew = root.offsetWidth > stackedWidth.current;
				if (grew)
				{
					// Hold the stacked height while the inline re-measure renders, so the card does not jump.
					root.style.minHeight = getComputedStyle(root).height;
					stackedWidth.current = root.offsetWidth;
					setWrapped(false);
				}
				return grew;
			}
			const text = textRef.current;
			const action = actionRef.current;
			if (text === null || action === null) return false;
			const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
			if (!Number.isFinite(lineHeight) || lineHeight <= 0) return false;
			const isWrapped = action.getBoundingClientRect().top - text.getBoundingClientRect().top > lineHeight / 2;
			const stacks = isWrapped && calibrated;
			stackedWidth.current = stacks ? Math.max(stackedWidth.current, root.offsetWidth) : 0;
			setWrapped(isWrapped);
			return stacks;
		};
		if (!measure()) root.style.removeProperty("min-height");
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
 * the uncalibrated Banner outside the composer (`px-lg`, `rounded-card`, `!py-lg`, the `b9` end margin). The region's list is the live region, so the card's role defaults to `none`,
 * which (like `ah`) renders no role attribute.
 * `data-cta-layout` is measured (`inline` / `wrapped` / keyline `stacked`). Omitting `icon` gives upstream's
 * neutral default Info glyph, which (like `ah`) hides when stacked; a passed icon stays, and `null` has no slot.
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
	/** Omitted: the neutral default glyph, hidden when stacked. */
	icon?: ReactNode;
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
	// Upstream `ah`: `r !== null && (!stacked || iconPassed || variant !== "neutral")`.
	const glyph = icon === undefined ? layout === "stacked" ? null : <Icon name="Info" size="auto" /> : icon;
	return (
		<div
			ref={rootRef}
			data-cds="Banner"
			data-prose-box=""
			data-icon-layout="first-line"
			data-cta-layout={layout}
			data-action-align="first-line"
			data-banner-variant="neutral"
			data-composer-keyline={keyline ?? undefined}
			data-testid={testId}
			role={role === "none" ? undefined : role}
			className={`${rootClass(keyline, layout, dismissible)} ${NOTICE_SURFACE_CLASS} @container`}
		>
			{glyph !== null && (
				// Upstream `Se.neutral` is `text-secondary`.
				<span className={`flex min-h-[1lh] shrink-0 items-center${iconOffset} text-secondary`}>{glyph}</span>
			)}
			<div className={bodyClass(keyline, layout, dismissible)}>
				<div ref={textRef} className={hasAction ? TEXT_WITH_ACTION : TEXT_ALONE}>
					{children}
				</div>
				{hasAction && (
					<span ref={actionRef} data-cds-part="action" className={actionClass(keyline, layout, dismissible)}>
						{action}
					</span>
				)}
			</div>
			{dismissible && (
				<span data-cds-part="dismiss" className={`${dismiss} flex h-[1lh] shrink-0 items-center`}>
					<button type="button" aria-label="Dismiss" className={DISMISS_CLASS} onClick={onDismiss}>
						<X aria-hidden="true" className="size-4" />
					</button>
				</span>
			)}
		</div>
	);
}
