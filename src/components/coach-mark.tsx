import {Popover} from "@base-ui/react/popover";
import {Hand, X} from "lucide-react";
import type {ReactNode} from "react";

/**
 * A one-time tip popover, like claude.ai/code's accent CoachMark: an accent-filled
 * card with an arrow pointing at `anchor`, an icon, the message and a Dismiss X,
 * optionally headed by a `title` and followed by an `action` button.
 * Dismiss or Escape calls `onDismiss` (the tip is done); any other close, such as
 * an outside click, calls `onClose` so the owner can show it again later.
 */
export function CoachMark({
	open,
	anchor,
	title,
	message,
	action,
	icon = <Hand aria-hidden="true" className="size-4 shrink-0" />,
	side = "right",
	onDismiss,
	onClose,
}: {
	open: boolean;
	anchor: Element | null;
	title?: string;
	message: string;
	action?: {label: string; onClick: () => void};
	icon?: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	onDismiss: () => void;
	onClose: () => void;
}) {
	return (
		<Popover.Root
			open={open}
			onOpenChange={(next, details) => {
				if (next) return;
				if (details.reason === "escape-key" || details.reason === "close-press") onDismiss();
				else onClose();
			}}
		>
			<Popover.Portal>
				<Popover.Positioner
					anchor={anchor}
					side={side}
					align="center"
					sideOffset={12}
					className="z-[110] [filter:drop-shadow(0_8px_24px_rgb(0_0_0/0.16))_drop-shadow(0_2px_6px_rgb(0_0_0/0.12))]"
				>
					<Popover.Popup
						data-cds="CoachMark"
						data-variant="accent"
						aria-label={title ?? message}
						aria-live="polite"
						initialFocus={false}
						finalFocus={false}
						className="max-w-[280px] cursor-default rounded-card bg-accent-100 p-4 text-sm font-normal text-white outline-none transition-[opacity,scale] delay-300 duration-200 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:delay-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:transition-none"
					>
						<Popover.Arrow className="data-[side=bottom]:top-[-12px] data-[side=left]:right-[-20px] data-[side=left]:-rotate-90 data-[side=right]:left-[-20px] data-[side=right]:rotate-90 data-[side=top]:bottom-[-12px] data-[side=top]:rotate-180">
							<svg
								aria-hidden="true"
								width="28"
								height="12"
								viewBox="0 0 28 12"
								className="block overflow-visible fill-accent-100"
							>
								<path d="M0 0H28V2C23.5 2 22.8 2.2 21.6 3.3L15.6 8.6C14.7 9.4 13.3 9.4 12.4 8.6L6.4 3.3C5.2 2.2 4.5 2 0 2Z" />
							</svg>
						</Popover.Arrow>
						<div className="flex items-start gap-2">
							<div className="flex min-w-[13rem] flex-1 flex-row items-start gap-2">
								{icon}
								{title === undefined ? (
									<p>{message}</p>
								) : (
									<div className="flex flex-col gap-1">
										<p className="font-medium">{title}</p>
										<p className="text-white/85">{message}</p>
									</div>
								)}
							</div>
							<Popover.Close
								aria-label="Dismiss"
								className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/15"
							>
								<X aria-hidden="true" className="size-3.5" />
							</Popover.Close>
						</div>
						{action && (
							<div className="mt-3 flex justify-end">
								<button
									type="button"
									onClick={action.onClick}
									className="h-7 rounded-md bg-white px-3 text-sm font-medium text-accent-100 hover:bg-white/90"
								>
									{action.label}
								</button>
							</div>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
