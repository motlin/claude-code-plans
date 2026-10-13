import {useShortcut} from "../../hooks/use-shortcut";
import {usePaneHost} from "../panes/pane-host-context";

/** Binds ⌃⇧D whether the titlebar toggle is shown or folded. */
export function ChangesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_changes", () => {
		host.togglePane("changes");
	});
	return null;
}
