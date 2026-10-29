import {Ellipsis, MousePointer2} from "lucide-react";
import {useId, useState} from "react";

import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast-context";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {Skeleton} from "../ui/skeleton";
import {Switch} from "../ui/switch";
import {Tooltip} from "../ui/tooltip";

/*
 * Upstream's desktop Remote Control setting row (`RA` in the flat-rail Environment card): the Cursor icon, a
 * label that clicks its xs switch, and, while bridged, a hover-revealed "…" menu (also on right-click) to open
 * the bridged session or copy its link.
 */

const ROW_CLASS = "group/setting flex min-h-6.5 w-full min-w-0 items-center gap-2 px-1 text-[13px]/[19px]";
const ICON_SLOT_CLASS = "flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4";
const LABEL_CLASS = "min-w-0 flex-1 cursor-pointer truncate text-primary";
/* Upstream `Ae`: hidden until the row is hovered or focused, its menu is open, or on touch. */
const OPTIONS_WRAPPER_CLASS =
	"pointer-events-none flex shrink-0 opacity-0 group-focus-within/setting:pointer-events-auto group-focus-within/setting:opacity-100 group-hover/setting:pointer-events-auto group-hover/setting:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";
const OPTIONS_TRIGGER_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary data-[popup-open]:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export type RemoteControlState = "on" | "off";

export interface RemoteControlRowProps {
	state: RemoteControlState;
	/** The bridged session's claude.ai link; the options menu needs it. */
	url: string | null;
	onToggle?: ((on: boolean) => void) | undefined;
	toggleDisabled?: boolean | undefined;
}

function RemoteControlIcon() {
	return (
		<span className={ICON_SLOT_CLASS}>
			<MousePointer2 aria-hidden />
		</span>
	);
}

export function RemoteControlRow({state, url, onToggle, toggleDisabled = false}: RemoteControlRowProps) {
	const switchId = useId();
	const toast = useToast();
	const [menuOpen, setMenuOpen] = useState(false);
	const optionsUrl = state === "on" ? url : null;
	return (
		<div
			data-rail-remote-control=""
			className={ROW_CLASS}
			{...(optionsUrl === null
				? {}
				: {
						onContextMenu: (event: React.MouseEvent) => {
							event.preventDefault();
							setMenuOpen(true);
						},
					})}
		>
			<RemoteControlIcon />
			<label data-rail-row-label="" htmlFor={switchId} className={LABEL_CLASS}>
				Remote Control
			</label>
			{optionsUrl !== null && (
				<span className={OPTIONS_WRAPPER_CLASS}>
					<Menu open={menuOpen} onOpenChange={setMenuOpen}>
						<Tooltip content="Remote Control options" suppressAfterPopup>
							<MenuTrigger aria-label="Remote Control options" className={OPTIONS_TRIGGER_CLASS}>
								<Ellipsis aria-hidden className="size-4" />
							</MenuTrigger>
						</Tooltip>
						<MenuContent side="bottom" align="end">
							<MenuItem
								onSelect={() => {
									window.open(optionsUrl, "_blank", "noopener,noreferrer");
								}}
							>
								Open in claude.ai
							</MenuItem>
							<MenuItem
								onSelect={() => {
									// Upstream `Mv` stays silent when the copy fails.
									void writeClipboardText(optionsUrl).then((copied) => {
										if (copied) toast({kind: "success", message: "Link copied"});
									});
								}}
							>
								Copy link
							</MenuItem>
						</MenuContent>
					</Menu>
				</span>
			)}
			<Switch id={switchId} checked={state === "on"} disabled={toggleDisabled} onCheckedChange={onToggle} />
		</div>
	);
}

/** Upstream `Hk` pending: the row's name over a 28px skeleton while the bridge state loads. */
export function RemoteControlRowPending() {
	return (
		<div data-rail-remote-control-pending="" className={ROW_CLASS}>
			<RemoteControlIcon />
			<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-primary">
				Remote Control
			</span>
			<Skeleton className="h-3 w-7 rounded" />
		</div>
	);
}
