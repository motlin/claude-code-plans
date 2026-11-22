import {type ComponentProps, useState} from "react";

import {writeClipboardText} from "../lib/clipboard";
import {SUPPRESS_NATIVE_MENU_POPUP_PROPS} from "../lib/native-context-menu";
import {openablePrUrl, prHostLabel} from "../lib/pr-url";
import {useToast} from "./toast-context";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

/**
 * Upstream `vr` (`Og`): a PR link's right-click menu, Open on {host} │ Copy link at the pointer, and its tooltip,
 * held shut while the menu is open. The trigger is a `contents` span that Base UI marks `data-popup-open` while
 * open, which re-expands a collapsed Changes header chip room. There is no local PR pane, so no "View pull request".
 */
export function PrLinkContextMenu({
	prUrl,
	linkTooltip,
	children,
}: {
	prUrl: string;
	linkTooltip: string;
	children: ComponentProps<typeof Tooltip>["children"];
})
{
	const [open, setOpen] = useState(false);
	const toast = useToast();
	const url = openablePrUrl(prUrl);
	return (
		<ContextMenu open={open} onOpenChange={setOpen} disabled={url === undefined}>
			<ContextMenuTrigger render={<span className="contents" />}>
				<Tooltip content={linkTooltip} closed={open}>
					{children}
				</Tooltip>
			</ContextMenuTrigger>
			{url !== undefined && (
				<MenuContent popupProps={SUPPRESS_NATIVE_MENU_POPUP_PROPS}>
					<MenuItem
						onSelect={() =>
						{
							window.open(url, "_blank", "noopener,noreferrer");
						}}
					>
						Open on {prHostLabel(url)}
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						onSelect={() =>
						{
							// Upstream `tm` stays silent when the copy fails.
							void writeClipboardText(url).then((copied) =>
							{
								if (copied)
									toast(
										{
											kind: "success",
											message: "Link copied to clipboard.",
										},
									);
							});
						}}
					>
						Copy link
					</MenuItem>
				</MenuContent>
			)}
		</ContextMenu>
	);
}
