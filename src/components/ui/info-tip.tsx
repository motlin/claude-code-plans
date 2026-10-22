import {Popover} from "@base-ui/react/popover";
import type {ReactNode} from "react";

const DEFAULT_DELAY_MS = 300;

const TRIGGER_CLASS =
	"inline-flex shrink-0 items-center justify-center rounded-r5 p-1 -m-1 text-ink-muted outline-none transition-colors duration-150 hover:text-secondary focus-visible:text-secondary focus-visible:shadow-focus data-[popup-open]:text-secondary";

const POPUP_CLASS =
	"rounded-r5 bg-[var(--tooltip-bg)] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)] text-[13px]/[18px] font-normal max-w-[240px] whitespace-normal origin-[var(--transform-origin)] outline-none transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[instant]:duration-0";

/**
 * Upstream's cds InfoTip: an icon button that opens a small dark popover on hover (after `delay`) or on click.
 * Unlike Tooltip it is a real dialog, so a click moves focus into it and dismissing it returns focus to the icon.
 */
export function InfoTip({
	content,
	"aria-label": ariaLabel,
	icon,
	delay = DEFAULT_DELAY_MS,
	side = "top",
	className,
	tabIndex,
}: {
	content: ReactNode;
	"aria-label": string;
	icon: ReactNode;
	delay?: number;
	side?: "top" | "bottom" | "left" | "right";
	className?: string;
	tabIndex?: number;
}) {
	return (
		<Popover.Root>
			<Popover.Trigger
				type="button"
				data-info-tip=""
				aria-label={ariaLabel}
				openOnHover
				delay={delay}
				className={className === undefined ? TRIGGER_CLASS : `${TRIGGER_CLASS} ${className}`}
				{...(tabIndex === undefined ? {} : {tabIndex})}
			>
				{icon}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side={side} align="center" sideOffset={6} className="z-[120]">
					<Popover.Popup aria-label={ariaLabel} className={POPUP_CLASS}>
						<span className="block px-2 py-1.5 min-w-0 break-words">{content}</span>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
