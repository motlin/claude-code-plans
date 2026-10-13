import {useShortcut} from "../../hooks/use-shortcut";
import {setPendingFilterFocus} from "./files-filter-focus";
import {usePaneHost} from "./pane-host-context";

/** Binds ⇧⌘F: toggle the Files pane, focusing its filter when it opens. */
export function FilesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_files", () => {
		setPendingFilterFocus(!host.isOpen("files"));
		host.togglePane("files");
	});
	return null;
}
