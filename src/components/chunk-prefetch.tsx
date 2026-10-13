import {useEffect} from "react";
import {useIdlePrefetch} from "../hooks/use-idle-prefetch";
import {warmOnIntent} from "../lib/idle-prefetch";
import {loadCommandPalette} from "./command-palette-entry";
import {loadSettingsDialog} from "./settings/settings-dialog-entry";

const SHELL_CHUNKS = [loadCommandPalette, loadSettingsDialog];
const INTENT = {
	targets: {palette: [loadCommandPalette], settings: [loadSettingsDialog]},
	modifier: SHELL_CHUNKS,
};

/**
 * Downloads the ⌘K palette and Settings chunks after the page goes idle, or sooner on hover or focus of a
 * `data-prefetch` control or a ⌘/Ctrl press, so their first open renders from cache.
 */
export function ChunkPrefetch() {
	useIdlePrefetch(SHELL_CHUNKS);
	useEffect(() => {
		if (import.meta.env.MODE === "test") return undefined;
		return warmOnIntent(document, INTENT);
	}, []);
	return null;
}
