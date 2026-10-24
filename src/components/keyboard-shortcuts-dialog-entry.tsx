import {useSyncExternalStore} from "react";
import {useShortcut} from "../hooks/use-shortcut";
import {deferredComponent, deferredModule} from "./deferred-component";
import {
	getKeyboardShortcutsOpen,
	getServerKeyboardShortcutsOpen,
	setKeyboardShortcutsOpen,
	subscribeKeyboardShortcutsOpen,
} from "./keyboard-shortcuts-open";

// The shortcut list and its rows stay off the cold load until the dialog first opens or the page goes idle.
const dialogModule = deferredModule(async () =>
	import("./keyboard-shortcuts-dialog").then(({KeyboardShortcutsDialog}) => ({KeyboardShortcutsDialog})),
);

export const loadKeyboardShortcutsDialog = dialogModule.preload;
const KeyboardShortcutsDialog = deferredComponent(dialogModule, "KeyboardShortcutsDialog");

/**
 * Binds ⌘/ and mounts the Keyboard shortcuts dialog from its first open on; until then a closed dialog renders
 * nothing. Once mounted, the dialog binds ⌘/ itself.
 */
export function DeferredKeyboardShortcutsDialog() {
	const open = useSyncExternalStore(
		subscribeKeyboardShortcutsOpen,
		getKeyboardShortcutsOpen,
		getServerKeyboardShortcutsOpen,
	);
	const mounted = open || dialogModule.loaded() !== undefined;
	useShortcut(
		"shortcuts_modal",
		(event) => {
			event.stopImmediatePropagation();
			event.stopPropagation();
			setKeyboardShortcutsOpen(true);
		},
		{allowInModal: true, disabled: mounted},
	);
	return mounted ? <KeyboardShortcutsDialog /> : null;
}
