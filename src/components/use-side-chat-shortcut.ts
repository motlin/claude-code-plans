import {useShortcut} from "../hooks/use-shortcut";
import {toggleSideChat} from "../lib/side-chat-store";
import {useToast} from "./toast-context";

/**
 * ⌘; on a session page. Declines the key (so other handlers may claim it)
 * when the session is not found, and refuses with a toast when focus is in a
 * secondary pane, as upstream does.
 */
export function useSideChatShortcut(sessionId: string, available: boolean): void {
	const toast = useToast();
	useShortcut("toggle_side_chat", () => {
		if (!available) return false;
		if (focusInSecondaryPane()) {
			toast({kind: "error", message: SECONDARY_PANE_MESSAGE});
			return true;
		}
		toggleSideChat(sessionId);
		return true;
	});
}

const SECONDARY_PANE_MESSAGE = "Side chat is only available in the primary pane.";

/**
 * Whether keyboard focus sits inside a tile-host pane rather than the main
 * chat. The docked side chat's own pane does not count.
 */
function focusInSecondaryPane(): boolean {
	const pane = document.activeElement?.closest<HTMLElement>("[data-pane-root]");
	return pane != null && pane.dataset["paneKind"] !== "side-chat";
}
