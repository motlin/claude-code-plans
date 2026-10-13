import {useEffect} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {deferredPane} from "./deferred-pane";
import {setPendingFilterFocus} from "./files-filter-focus";
import type {FilesPaneProps} from "./files-pane";
import {registerPane} from "./pane-registry";
import {usePaneHost} from "./tile-host";

const DeferredFilesPane = deferredPane("Files", async () => import("./files-pane").then((module) => module.FilesPane));

/** Downloads the Files pane renderer ahead of its first show. */
export const preloadFilesPane = DeferredFilesPane.preload;

/** Registers the `files` pane kind for this session while mounted; its tree and viewer load when the pane shows. */
export function useRegisterFilesPane({
	sessionId,
	cwd,
	windowFiles,
	windowStartIndex,
	jumpTargetWindow,
}: Omit<FilesPaneProps, "chrome">): void {
	useEffect(
		() =>
			registerPane("files", {
				title: "Files",
				header: "custom",
				render: (chrome) => (
					<DeferredFilesPane
						resetKey={sessionId}
						chrome={chrome}
						props={{sessionId, cwd, chrome, windowFiles, windowStartIndex, jumpTargetWindow}}
					/>
				),
			}),
		[sessionId, cwd, windowFiles, windowStartIndex, jumpTargetWindow],
	);
}

/** Binds ⇧⌘F: toggle the Files pane, focusing its filter when it opens. */
export function FilesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_files", () => {
		setPendingFilterFocus(!host.isOpen("files"));
		host.togglePane("files");
	});
	return null;
}
