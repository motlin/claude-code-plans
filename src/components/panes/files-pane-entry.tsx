import {useEffect} from "react";
import {deferredPane} from "./deferred-pane";
import type {FilesPaneProps} from "./files-pane";
import {registerPane} from "./pane-registry";

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
