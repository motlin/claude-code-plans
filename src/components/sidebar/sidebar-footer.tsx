import {useOpenSettings} from "../settings/open-settings";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {AccountMenu} from "./account-menu";

/**
 * Upstream's `.df-bottom-tray > .df-footer-row`: the content-width account button, then the `.df-footer-aux`
 * holding the Code tab's "Code settings" gear. The cloud-only "Send feedback" row is omitted.
 */
export function SidebarFooter()
{
	return (
		<div data-testid="sidebar-footer" className="df-bottom-tray relative shrink-0">
			<div className="df-footer-row flex shrink-0 items-center gap-[var(--df-footer-gap)] p-2">
				<div className="min-w-0 flex-1">
					<AccountMenu />
				</div>
				<div className="df-footer-aux ms-auto me-0.5 flex shrink-0 items-center">
					<CodeSettingsButton />
				</div>
			</div>
		</div>
	);
}

/** Upstream's `aW`: a ghost icon-only gear that opens Settings on its Code section (`#settings/claude-code`). */
function CodeSettingsButton()
{
	const openSettings = useOpenSettings();
	return (
		<Tooltip content="Code settings" side="top">
			<button
				type="button"
				aria-label="Code settings"
				data-prefetch="settings"
				className="df-chrome-btn group/btn relative inline-flex size-7 shrink-0 items-center justify-center rounded-r6 align-top text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]"
				onClick={() =>
				{
					openSettings("claude-code");
				}}
			>
				<span aria-hidden="true" className="absolute inset-0 -z-[1] rounded-[inherit]">
					<span
						data-cds-part="paint"
						className="absolute inset-0 rounded-[inherit] transition-[background-color] group-hover/btn:bg-fill-ghost-hover"
					/>
				</span>
				<Icon name="Settings" size="md" />
			</button>
		</Tooltip>
	);
}
