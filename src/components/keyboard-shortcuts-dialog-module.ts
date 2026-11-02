import {deferredModule} from "./deferred-component";

// The shortcut list and its rows stay off the cold load until the dialog first opens or the page goes idle.
export const keyboardShortcutsDialogModule = deferredModule(async () =>
	import("./keyboard-shortcuts-dialog").then(({KeyboardShortcutsDialog}) => (
	{
		KeyboardShortcutsDialog,
	})),
);

export const loadKeyboardShortcutsDialog = keyboardShortcutsDialogModule.preload;
