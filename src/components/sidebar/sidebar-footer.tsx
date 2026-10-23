import {AccountMenu} from "./account-menu";

/**
 * Upstream's `.df-bottom-tray`: a hairline-topped row holding the full-width account button.
 * The Search icon moved to the field above New, and the cloud-only "Send feedback" button is omitted.
 */
export function SidebarFooter() {
	return (
		<div
			data-testid="sidebar-footer"
			className="flex h-12 shrink-0 items-center gap-2 border-t-[0.5px] border-border p-2"
		>
			<AccountMenu />
		</div>
	);
}
