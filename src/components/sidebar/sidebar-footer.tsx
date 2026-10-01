import {Search} from "lucide-react";
import {openCommandPalette} from "../../hooks/use-command-palette";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {Tooltip} from "../ui/tooltip";
import {AccountMenu} from "./account-menu";

/**
 * Upstream's `.df-bottom-tray`: a hairline-topped row with the account button on the left and
 * the ghost Search icon on the right. The cloud-only "Send feedback" button is omitted.
 * Upstream's collapsed peek drops the Search icon, so `search={false}` leaves only the account button.
 */
export function SidebarFooter({search = true}: {search?: boolean}) {
	return (
		<div
			data-testid="sidebar-footer"
			className="flex h-12 shrink-0 items-center justify-between gap-2 border-t-[0.5px] border-border p-2"
		>
			<AccountMenu />
			{search && (
				<div className="flex shrink-0 items-center">
					<SearchButton />
				</div>
			)}
		</div>
	);
}

function SearchButton() {
	const {keys, ariaKeyShortcuts} = useShortcutKeys("search");

	return (
		<Tooltip content="Search" shortcut={keys}>
			<button
				type="button"
				aria-label="Search"
				aria-keyshortcuts={ariaKeyShortcuts}
				onClick={() => openCommandPalette("search")}
				className="flex h-8 w-8 items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
			>
				<Search className="h-4 w-4" aria-hidden="true" />
			</button>
		</Tooltip>
	);
}
