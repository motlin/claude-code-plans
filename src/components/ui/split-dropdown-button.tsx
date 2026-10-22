import {ChevronDown, Loader2} from "lucide-react";
import {Fragment, type ReactNode, useRef, useState} from "react";

import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./menu";
import {Shortcut} from "./shortcut";

/*
 * Upstream's cds SplitDropdownButton (`n4`): a joined primary button and a caret DropdownButton whose menu
 * is anchored to the caret. Clicking the primary while the menu is open only closes the menu, as upstream's
 * click shield does.
 */

export type SplitItem =
	| {label: ReactNode; icon?: ReactNode; onSelect: () => void; disabled?: boolean; separatorBefore?: boolean}
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
	className?: string;
}

const ROOT_CLASS = "relative inline-flex w-fit shrink-0 items-stretch rounded-r5 group/split";
const BUTTON_CLASS = "relative outline-none focus-visible:shadow-focus disabled:opacity-40";

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
					{...(item.disabled === undefined ? {} : {disabled: item.disabled})}
				>
					{item.label}
				</MenuItem>
			</Fragment>
		);
	});
}

export function SplitDropdownButton({
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
	const rootClass = className ? `${ROOT_CLASS} ${className}` : ROOT_CLASS;
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
			{...(open ? {"data-popup-open": ""} : {})}
			{...(disabled ? {"data-disabled": ""} : {})}
		>
			<div data-cds-segment="" className="contents">
				<div className="contents">
					<button
						type="button"
						data-cds="Button"
						className={`${BUTTON_CLASS} inline-flex min-w-0 shrink items-center`}
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
			<span aria-hidden="true" />
			<div data-cds-segment="" className="contents">
				<Menu open={open} onOpenChange={setOpen}>
					<MenuTrigger
						type="button"
						data-cds="Button"
						data-cds-icon-only=""
						aria-label={menuLabel}
						disabled={disabled}
						className={`${BUTTON_CLASS} inline-flex items-center justify-center`}
					>
						<ChevronDown aria-hidden="true" className={size === "sm" ? "size-3" : "size-4"} />
					</MenuTrigger>
					<MenuContent side={side} align={align} sideOffset={6}>
						<MenuItems items={items} />
					</MenuContent>
				</Menu>
			</div>
		</div>
	);
}
