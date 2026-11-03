import {useEffect, useSyncExternalStore} from "react";
import type {WorkingMarkActivity} from "./working-mark-activity";

/** The activity's vendored loop sheet in `public/working-mark/`. */
export function sheetUrl(activity: WorkingMarkActivity): string {
	return `/working-mark/${activity}.webp`;
}

/** Sheets decoded this page load, and those still loading, so each downloads once. */
const decodedSheets = new Set<WorkingMarkActivity>();
const loadingSheets = new Set<WorkingMarkActivity>();
const sheetListeners = new Set<() => void>();

function subscribeSheets(onChange: () => void): () => void {
	sheetListeners.add(onChange);
	return () => {
		sheetListeners.delete(onChange);
	};
}

function loadSheet(activity: WorkingMarkActivity): void {
	if (decodedSheets.has(activity) || loadingSheets.has(activity)) return;
	const image = new Image();
	// Without decode() (jsdom has none) the sheet never counts as loaded, so the dot stays.
	if (typeof image.decode !== "function") return;
	loadingSheets.add(activity);
	image.src = sheetUrl(activity);
	image.decode().then(
		() => {
			loadingSheets.delete(activity);
			decodedSheets.add(activity);
			for (const listener of sheetListeners) listener();
		},
		() => {
			// A sheet that never decodes leaves the dot, as upstream's does.
			loadingSheets.delete(activity);
		},
	);
}

/** Forgets every decoded sheet, so each test starts from a cold page. */
export function resetWorkingMarkSheetsForTest(): void {
	decodedSheets.clear();
	loadingSheets.clear();
}

/** Whether the activity's sheet has decoded; the server and hydration render the dot. */
export function useSheetDecoded(activity: WorkingMarkActivity): boolean {
	const decoded = useSyncExternalStore(
		subscribeSheets,
		() => decodedSheets.has(activity),
		() => false,
	);
	useEffect(() => {
		loadSheet(activity);
	}, [activity]);
	return decoded;
}
