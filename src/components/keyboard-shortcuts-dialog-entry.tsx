import {useSyncExternalStore} from "react";
import {useShortcut} from "../hooks/use-shortcut";
import {deferredComponent} from "./deferred-component";
import {KeyboardShortcutsBodySkeleton, KeyboardShortcutsLoadingFrame} from "./keyboard-shortcuts-dialog-frame";
import {keyboardShortcutsDialogModule} from "./keyboard-shortcuts-dialog-module";
import
{
	getKeyboardShortcutsOpen,
	getServerKeyboardShortcutsOpen,
	setKeyboardShortcutsOpen,
	subscribeKeyboardShortcutsOpen,
} from "./keyboard-shortcuts-open";

// Upstream lazy-loads only the list body (`ShortcutsModalBody`, `loading: OV`) inside an eager modal, so a failed
// download shows the inline ErrorView in the open dialog; the local chunk holds the whole dialog, so the shell is
// drawn here around the skeleton and the ErrorView.
const KeyboardShortcutsDialog = deferredComponent(
	keyboardShortcutsDialogModule,
	"KeyboardShortcutsDialog",
	{
		loading: KeyboardShortcutsBodySkeleton,
		frame: KeyboardShortcutsLoadingFrame,
	},
);

/**
 * Binds ⌘/ and mounts the Keyboard shortcuts dialog from its first open on; until then a closed dialog renders
 * nothing. Once mounted, the dialog binds ⌘/ itself.
 */
export function DeferredKeyboardShortcutsDialog()
{
	const open = useSyncExternalStore(
		subscribeKeyboardShortcutsOpen,
		getKeyboardShortcutsOpen,
		getServerKeyboardShortcutsOpen,
	);
	const mounted = open || keyboardShortcutsDialogModule.loaded() !== undefined;
	useShortcut(
		"shortcuts_modal",
		(event) =>
		{
			event.stopImmediatePropagation();
			event.stopPropagation();
			setKeyboardShortcutsOpen(true);
		},
		{
			allowInModal: true,
			disabled: mounted,
		},
	);
	return mounted ? <KeyboardShortcutsDialog /> : null;
}
