import {ChevronDown, Loader2} from "lucide-react";
import {type CSSProperties, Fragment, type ReactNode, useRef, useState} from "react";

import {Menu, MenuContent, type MenuContentProps, MenuItem, MenuSeparator, MenuTrigger} from "./menu";
import {Shortcut} from "./shortcut";

/*
 * Upstream's cds SplitDropdownButton (`n4`): a joined primary button and a caret DropdownButton whose menu
 * is anchored to the caret. Clicking the primary while the menu is open only closes the menu, as upstream's
 * click shield does.
 */

export type SplitItem =
	| {
			label: ReactNode;
			icon?: ReactNode;
			/** A global shortcut hint drawn as keycaps, e.g. "cmd+enter". */
			shortcut?: string;
			onSelect: () => void;
			disabled?: boolean;
			separatorBefore?: boolean;
	  }
	| "separator";

export interface SplitDropdownButtonProps {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "default" | "sm" | "touch";
	label?: ReactNode;
	icon?: ReactNode;
	"aria-label"?: string;
	groupLabel?: string;
	menuLabel?: string;
	items: SplitItem[];
	onPrimaryClick: () => void;
	shortcut?: string;
	"aria-keyshortcuts"?: string;
	/** Sets the attribute only; the click still fires, so callers guard it (upstream's held Send). */
	"aria-disabled"?: boolean;
	busy?: boolean;
	disabled?: boolean;
	pressed?: boolean;
	side?: "top" | "bottom";
	align?: "start" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Where focus lands when the menu closes; the caret by default. */
	finalFocus?: MenuContentProps["finalFocus"];
	className?: string;
}

const ROOT_CLASS = "relative inline-flex w-fit shrink-0 items-stretch";
const ROOT_GROUP_CLASS = "group/split";
const BUTTON_CLASS = "relative outline-none focus-visible:shadow-focus disabled:opacity-40";
const PAINT_TRANSITION =
	"transition-[background-color,box-shadow,color] duration-[60ms] ease-[cubic-bezier(.165,.84,.44,1)]";
const SEAM_BASE_CLASS = "w-px shrink-0 self-stretch";
/* The seam line fades while either neighbour segment is hovered or holds the open menu. */
const SEAM_FADE_CLASS =
	"[[data-cds-segment]:hover+&>[data-seam-line]]:opacity-0 [&:has(+[data-cds-segment]:hover)>[data-seam-line]]:opacity-0 [[data-cds-segment]:has([aria-expanded=true])+&>[data-seam-line]]:opacity-0 [&:has(+[data-cds-segment]_[aria-expanded=true])>[data-seam-line]]:opacity-0";
/* Solid seams dim with their segments when both neighbours are disabled. */
const SOLID_SEAM_DISABLED_CLASS = "[[data-cds-segment]:has(:disabled)+&:has(+[data-cds-segment]_:disabled)]:opacity-40";

type JoinedVariant = "primary" | "secondary" | "danger";

/* Upstream's `ho` seam: a 1px strip in the segment fill with a half-height line. */
const JOINED_LOOKS: Record<JoinedVariant, {root: string; fill: string; seam: string; line: string}> = {
	primary: {
		root: "",
		fill: "bg-fill-primary text-on-primary font-medium hover:bg-fill-primary-hover aria-expanded:bg-fill-primary-hover",
		seam: `relative ${SEAM_BASE_CLASS} bg-fill-primary ${SEAM_FADE_CLASS} ${SOLID_SEAM_DISABLED_CLASS}`,
		line: "absolute inset-x-0 inset-y-1/4 bg-on-primary opacity-25",
	},
	secondary: {
		root: "shadow-field-drop after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
		fill: "bg-fill-secondary text-primary hover:bg-fill-secondary-hover aria-expanded:bg-fill-secondary-hover",
		seam: `relative ${SEAM_BASE_CLASS} bg-fill-secondary ${SEAM_FADE_CLASS}`,
		line: "absolute inset-x-0 inset-y-1/4 bg-border",
	},
	danger: {
		root: "",
		fill: "bg-fill-danger text-on-danger font-medium hover:bg-fill-danger-hover aria-expanded:bg-fill-danger-hover",
		seam: `relative ${SEAM_BASE_CLASS} bg-fill-danger ${SEAM_FADE_CLASS} ${SOLID_SEAM_DISABLED_CLASS}`,
		line: "absolute inset-x-0 inset-y-1/4 bg-on-danger opacity-25",
	},
};

/*
 * Upstream's ghost split: a transparent pair whose group ring lights on hover, while open or while pressed.
 * Each segment paints through an inset content-box layer, and the icon-only caret tucks under the primary
 * with a pointer target that reaches past its end.
 */
const GHOST_ROOT_CLASS =
	"shadow-[inset_0_0_0_1px_var(--split-ring,transparent)] transition-[box-shadow] duration-[60ms] ease-[cubic-bezier(.165,.84,.44,1)] [&:not([data-disabled])]:hover:[--split-ring:var(--color-border)] data-[popup-open]:[--split-ring:var(--color-border)] [&:not([data-disabled])]:has-[[aria-pressed=true]]:[--split-ring:var(--color-border)]";
const GHOST_LABELED_ROOT_CLASS =
	"[&>[data-cds-segment]:first-child_[data-part=paint]]:pe-0 [&>[data-cds-segment]:last-child_[data-part=paint]]:ps-0";
const GHOST_BUTTON_CLASS = "group/btn isolate inline-flex items-center";
const GHOST_PAINT_CLASS = `absolute inset-0 -z-[1] rounded-[inherit] p-[var(--split-inset)] bg-clip-content group-hover/btn:bg-fill-ghost-hover group-aria-expanded/btn:bg-fill-ghost-hover group-aria-pressed/btn:bg-accent-100/15 ${PAINT_TRANSITION}`;
const GHOST_ICON_PRIMARY_CLASS =
	"justify-center aria-pressed:text-accent-100 size-[var(--split-h)] group-data-[popup-open]/split:pointer-events-none";
const GHOST_ICON_CARET_CLASS =
	"justify-center h-[var(--split-h)] w-auto px-1 -ms-[var(--split-tuck)] pointer-events-none after:absolute after:inset-y-0 after:content-[''] after:pointer-events-auto after:start-[calc(var(--split-tuck)-1px)] after:-end-[calc(3px+var(--split-tuck))]";
const GHOST_LABELED_PRIMARY_CLASS = "aria-pressed:text-accent-100 h-[var(--split-h)] min-w-0 shrink";
const GHOST_LABELED_PRIMARY_PAD_CLASS = "ps-2 pe-[5px]";
const GHOST_LABELED_CARET_CLASS =
	"justify-center h-[var(--split-h)] w-auto ps-0 pe-1 after:absolute after:inset-y-0 after:start-0 after:-end-2 after:content-['']";
type SplitSize = NonNullable<SplitDropdownButtonProps["size"]>;

/* Upstream's control scale: compact 24px, sm 20px, and the coarse-pointer comfortable 28px. */
const SIZES: Record<SplitSize, {h: string; height: string; text: string; padX: string; radius: string; icon: string}> =
	{
		default: {
			h: "24px",
			height: "h-6",
			text: "text-[13px]/[19px]",
			padX: "px-2",
			radius: "rounded-r5",
			icon: "size-4",
		},
		sm: {
			h: "20px",
			height: "h-5",
			text: "text-[12px]/[17px]",
			padX: "px-1.5",
			radius: "rounded-r4",
			icon: "size-3",
		},
		touch: {
			h: "28px",
			height: "h-7",
			text: "text-[13px]/[19px]",
			padX: "px-2",
			radius: "rounded-r6",
			icon: "size-4",
		},
	};

function rootStyle(size: SplitSize, ghost: boolean): CSSProperties {
	const height: CSSProperties = {"--split-h": SIZES[size].h};
	if (!ghost) return height;
	return {
		...height,
		"--split-tuck": "calc((var(--split-h) - 20px) / 2)",
		"--split-inset": "min(calc(var(--split-tuck) / 2), 3px)",
	};
}

function GhostPaint() {
	return <span aria-hidden="true" data-part="paint" className={GHOST_PAINT_CLASS} />;
}

function joinClasses(...classes: (string | undefined | false)[]): string {
	return classes.filter((value) => typeof value === "string" && value !== "").join(" ");
}

function MenuItems({items}: {items: SplitItem[]}) {
	return items.map((item, index) => {
		const key = String(index);
		if (item === "separator") return <MenuSeparator key={key} />;
		return (
			<Fragment key={key}>
				{item.separatorBefore === true && <MenuSeparator />}
				<MenuItem
					onSelect={item.onSelect}
					{...(item.icon === undefined ? {} : {icon: item.icon})}
					{...(item.shortcut === undefined ? {} : {shortcut: item.shortcut})}
					{...(item.disabled === undefined ? {} : {disabled: item.disabled})}
				>
					{item.label}
				</MenuItem>
			</Fragment>
		);
	});
}

export function SplitDropdownButton({
	variant = "secondary",
	size = "default",
	label,
	icon,
	"aria-label": ariaLabel,
	groupLabel,
	menuLabel = "More options",
	items,
	onPrimaryClick,
	shortcut,
	"aria-keyshortcuts": ariaKeyShortcuts,
	"aria-disabled": ariaDisabled,
	busy = false,
	disabled = false,
	pressed,
	side = "bottom",
	align = "end",
	open: controlledOpen,
	onOpenChange,
	finalFocus,
	className,
}: SplitDropdownButtonProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	/* The outside press closes the menu before the click lands, so remember it was open at pointerdown. */
	const openAtPointerDown = useRef(false);

	const setOpen = (next: boolean) => {
		if (controlledOpen === undefined) setInternalOpen(next);
		onOpenChange?.(next);
	};

	const handlePrimaryClick = () => {
		const wasOpen = open || openAtPointerDown.current;
		openAtPointerDown.current = false;
		if (wasOpen) {
			if (open) setOpen(false);
			return;
		}
		if (busy) return;
		onPrimaryClick();
	};

	const name = groupLabel ?? (typeof label === "string" ? label : (ariaLabel ?? menuLabel));
	const joined = variant === "ghost" ? undefined : JOINED_LOOKS[variant];
	const iconOnly = label === undefined;
	const scale = SIZES[size];
	const rootBase = joinClasses(ROOT_CLASS, scale.radius, ROOT_GROUP_CLASS);
	const rootClass = joined
		? joinClasses(rootBase, joined.root, className)
		: joinClasses(rootBase, GHOST_ROOT_CLASS, !iconOnly && GHOST_LABELED_ROOT_CLASS, className);
	const ghostButtonClass = joinClasses(GHOST_BUTTON_CLASS, scale.radius);
	const primaryClass = joined
		? joinClasses(
				BUTTON_CLASS,
				"inline-flex items-center",
				scale.height,
				scale.padX,
				scale.text,
				scale.radius,
				"rounded-e-none min-w-0 shrink",
				joined.fill,
				PAINT_TRANSITION,
			)
		: joinClasses(
				BUTTON_CLASS,
				ghostButtonClass,
				iconOnly
					? GHOST_ICON_PRIMARY_CLASS
					: joinClasses(GHOST_LABELED_PRIMARY_CLASS, scale.text, GHOST_LABELED_PRIMARY_PAD_CLASS),
			);
	const caretClass = joined
		? joinClasses(
				BUTTON_CLASS,
				"inline-flex items-center justify-center",
				scale.height,
				"w-auto px-1",
				scale.radius,
				"rounded-s-none",
				joined.fill,
				PAINT_TRANSITION,
			)
		: joinClasses(BUTTON_CLASS, ghostButtonClass, iconOnly ? GHOST_ICON_CARET_CLASS : GHOST_LABELED_CARET_CLASS);
	/* Upstream mutes the caret icon only on the enabled secondary/ghost looks. */
	const caretIconClass = joinClasses(
		scale.icon,
		(variant === "secondary" || variant === "ghost") && !disabled && "text-ink-muted",
	);
	const labelSpan =
		label === undefined ? null : (
			<span className={`min-w-0 truncate [unicode-bidi:plaintext]${busy ? " opacity-0" : ""}`}>{label}</span>
		);

	return (
		<div
			data-cds="SplitDropdownButton"
			role="group"
			aria-label={name}
			className={rootClass}
			style={rootStyle(size, !joined)}
			{...(open ? {"data-popup-open": ""} : {})}
			{...(disabled ? {"data-disabled": ""} : {})}
		>
			<div data-cds-segment="" className="contents">
				<div className="contents">
					<button
						type="button"
						data-cds="Button"
						className={primaryClass}
						disabled={disabled}
						onPointerDown={() => {
							openAtPointerDown.current = open;
						}}
						onClick={handlePrimaryClick}
						{...(label === undefined && ariaLabel !== undefined ? {"aria-label": ariaLabel} : {})}
						{...(ariaKeyShortcuts === undefined ? {} : {"aria-keyshortcuts": ariaKeyShortcuts})}
						{...(busy ? {"aria-busy": "true", "aria-disabled": "true"} : {})}
						{...(!busy && ariaDisabled !== undefined ? {"aria-disabled": ariaDisabled} : {})}
						{...(pressed === undefined ? {} : {"aria-pressed": pressed})}
					>
						{!joined && <GhostPaint />}
						{icon !== undefined && <span className={busy ? "opacity-0" : undefined}>{icon}</span>}
						{labelSpan}
						{shortcut !== undefined && label !== undefined && (
							<span aria-hidden="true" className="ms-1 inline-flex pointer-coarse:hidden">
								<Shortcut keys={shortcut} />
							</span>
						)}
						{busy && (
							<span aria-hidden="true" className="absolute inset-0 grid place-items-center">
								<Loader2 className="size-3 animate-spin" />
							</span>
						)}
					</button>
				</div>
			</div>
			<span aria-hidden="true" className={joined ? joined.seam : SEAM_BASE_CLASS}>
				{joined && <span data-seam-line="" className={joined.line} />}
			</span>
			<div data-cds-segment="" className="contents">
				<Menu open={open} onOpenChange={setOpen}>
					<MenuTrigger
						type="button"
						data-cds="Button"
						data-cds-icon-only=""
						aria-label={menuLabel}
						disabled={disabled}
						className={caretClass}
					>
						{!joined && <GhostPaint />}
						<ChevronDown aria-hidden="true" className={caretIconClass} />
					</MenuTrigger>
					<MenuContent
						side={side}
						align={align}
						sideOffset={6}
						{...(finalFocus === undefined ? {} : {finalFocus})}
					>
						<MenuItems items={items} />
					</MenuContent>
				</Menu>
			</div>
		</div>
	);
}
