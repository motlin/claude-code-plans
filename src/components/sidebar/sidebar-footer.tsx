import {AccountMenu} from "./account-menu";

/**
 * Upstream's `.df-bottom-tray > .df-footer-row`: the full-width account button, then the `.df-footer-aux`, which the
 * Code tab leaves empty (upstream dropped its "Code settings" gear). The cloud-only "Send feedback" row is omitted.
 */
export function SidebarFooter()
{
	return (
		<div data-testid="sidebar-footer" className="df-bottom-tray relative shrink-0">
			<div className="df-footer-row flex shrink-0 items-center gap-[var(--df-footer-gap)] p-2">
				<div className="min-w-0 flex-1">
					<AccountMenu />
				</div>
				<div className="df-footer-aux ms-auto me-0.5 flex shrink-0 items-center" />
			</div>
		</div>
	);
}
