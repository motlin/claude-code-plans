import {Popover as BasePopover} from "@base-ui/react/popover";
import type {ComponentProps, ReactNode} from "react";

/** Upstream's cds `Ql`: the Base UI root and trigger, with `PopoverContent` as the surface. */
export const Popover = {Root: BasePopover.Root, Trigger: BasePopover.Trigger};

export interface PopoverContentProps {
	children: ReactNode;
	side?: ComponentProps<typeof BasePopover.Positioner>["side"];
	align?: ComponentProps<typeof BasePopover.Positioner>["align"];
	sideOffset?: number;
	/** Lands on the anchored Popup. */
	className?: string;
	/**
	 * Upstream's `structurallyAnchored` (`nG`): the popup declines focus and is anchored to a text field, so it
	 * stays anchored even where the bottom-sheet gate would otherwise open a sheet.
	 */
	structurallyAnchored?: boolean;
}

/** The popover surface: anchored to its trigger through Portal → Positioner → Popup. */
export function PopoverContent({
	children,
	side = "bottom",
	align = "center",
	sideOffset = 6,
	className,
}: PopoverContentProps) {
	return (
		<BasePopover.Portal>
			<BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-[130]">
				<BasePopover.Popup {...(className === undefined ? {} : {className})}>{children}</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
